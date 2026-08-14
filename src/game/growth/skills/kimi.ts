import { createJsonTextExtractor } from "./streamText";

/**
 * Moonshot 有两套互不通用的服务：国内平台（platform.moonshot.cn，密钥只能打 api.moonshot.cn）
 * 与国际站（platform.moonshot.ai，密钥只能打 api.moonshot.ai）。用错了会直接 401，
 * 所以基址做成可配置，默认国内站。
 */
const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";

/**
 * 默认用 kimi-k2.7-code-highspeed：实测约 8 秒、归因质量明显高于 8k 快模型。
 * kimi-k2.7-code（无 highspeed）单次约 80 秒，不可用。
 * kimi-k* 系列只接受 temperature=1，首次调用不带 temperature，避免每次先吃一次 400。
 */
export const DEFAULT_KIMI_MODEL = "kimi-k2.7-code-highspeed";

function chatEndpoint(): string {
  const base = process.env.MOONSHOT_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return `${base.replace(/\/+$/, "")}/chat/completions`;
}

export interface KimiJsonRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** json_schema 模式下的结构名与结构体；模型不支持时会自动降级成 json_object */
  schemaName: string;
  schema: object;
  /** 本次调用的时间上限，与外部 signal 取最早触发者 */
  timeoutMs: number;
  signal?: AbortSignal;
  temperature?: number;
  /**
   * 提供时改用流式请求，边生成边把「人话」增量吐出来。
   * 不提供则退回一次性请求（离线脚本用不到过程展示）。
   */
  onDelta?: (text: string) => void;
  /**
   * 校验返回的结构是否可用。不通过会被当成一次失败并重试下一档，
   * 而不是把一份键名对不上的 JSON 交给 sanitize 静默回落成默认值。
   */
  validate?: (value: unknown) => boolean;
}

/**
 * 降级序列：不同模型对结构化输出与采样温度的支持差别很大
 * （例如 kimi-k3 只接受默认温度），逐级放宽约束直到能拿到 JSON。
 */
interface CallVariant {
  useJsonSchema: boolean;
  useTemperature: boolean;
}

/**
 * kimi-k2.7-code-highspeed 对 json_schema 经常拖到 20s+ 甚至挂死，
 * 而超时原先被当成致命错误、不会降级。这类模型直接走 json_object，
 * 结构化校验仍由各 skill 的 sanitize 兜住。
 */
function variantsFor(model: string): CallVariant[] {
  if (model.startsWith("kimi-k")) {
    return [{ useJsonSchema: false, useTemperature: false }];
  }
  return [
    { useJsonSchema: true, useTemperature: true },
    { useJsonSchema: true, useTemperature: false },
    { useJsonSchema: false, useTemperature: false },
  ];
}

/**
 * 只剩一档可用时（kimi-k* 只走 json_object），把它再排一次。
 *
 * 模型偶尔会单次挂死，而降级序列只有一项就等于没有任何重试机会——
 * 一次抽风就让整步失败。同一档重试一次比把超时调长有效得多：
 * 典型响应只要 8 秒，挂到 20 秒的那次基本不会再回来。
 */
function attemptPlan(model: string): CallVariant[] {
  const variants = variantsFor(model);
  return variants.length === 1 ? [variants[0], variants[0]] : variants;
}

/** json_schema 单次最多挂 12 秒，超时立刻改打 json_object，避免一次卡住吃光整步预算 */
const JSON_SCHEMA_ATTEMPT_MS = 12_000;
/** 非流式请求看不见进度，只能按固定时长封顶，给后面的重试留出预算 */
const BLIND_ATTEMPT_MS = 22_000;
/**
 * 流式请求改判「有没有在吐字」：连续这么久没有新 token 才算挂死。
 * 比固定封顶准得多——生成得慢但一直在产出的调用不该被砍掉。
 */
const IDLE_TIMEOUT_MS = 15_000;
const MIN_ATTEMPT_MS = 3_000;

function attemptTimeoutMs(
  variant: CallVariant,
  remaining: number,
  hasNext: boolean,
  streaming: boolean
): number {
  if (variant.useJsonSchema) {
    return Math.min(JSON_SCHEMA_ATTEMPT_MS, Math.max(MIN_ATTEMPT_MS, remaining));
  }
  if (streaming || !hasNext) return Math.max(MIN_ATTEMPT_MS, remaining);
  return Math.min(BLIND_ATTEMPT_MS, Math.max(MIN_ATTEMPT_MS, remaining));
}

class AbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortedError";
  }
}

function isUserCancel(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const message = (error as Error)?.message ?? "";
  return message.includes("请求已被取消");
}

/**
 * 剥掉可能存在的 Markdown 代码块包裹。即使显式要求了 JSON 输出，
 * 部分模型版本仍会习惯性地套一层 ```json。
 */
function parseJson<T>(content: string): T {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

/** 鉴权类错误重试多少次都一样，遇到就立刻放弃，别把时间预算耗在这上面 */
function isFatal(error: unknown): boolean {
  const message = (error as Error)?.message ?? "";
  return /Kimi 40[13]/.test(message) || message.includes("Invalid Authentication");
}

/**
 * 消费 SSE 流，累积出完整内容，同时把可读片段实时喂给 onDelta。
 * 每收到一块就重置空闲计时器：慢不是问题，不吐字才是。
 */
async function readSseContent(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  resetIdle: () => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const extract = createJsonTextExtractor();
  let buffer = "";
  let content = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    resetIdle();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      let piece: string | undefined;
      try {
        const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        piece = chunk.choices?.[0]?.delta?.content;
      } catch {
        continue; // 心跳或被截断的行，忽略
      }
      if (!piece) continue;
      content += piece;
      const readable = extract(piece);
      if (readable) onDelta(readable);
    }
  }
  return content;
}

async function requestOnce(
  request: KimiJsonRequest,
  variant: CallVariant,
  timeoutMs: number
): Promise<string> {
  const streaming = Boolean(request.onDelta);
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(new AbortedError("本次调用超时")), timeoutMs);
  // 流式下改成空闲计时：只要还在吐字就一直续期，停了 15 秒才判挂死
  const resetIdle = () => {
    if (!streaming) return;
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new AbortedError("模型停止响应")), IDLE_TIMEOUT_MS);
  };
  const forwardAbort = () => controller.abort(new AbortedError("请求已被取消"));
  request.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const response = await fetch(chatEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: request.model,
        ...(streaming ? { stream: true } : {}),
        ...(variant.useTemperature && request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: variant.useJsonSchema
          ? {
              type: "json_schema",
              json_schema: { name: request.schemaName, strict: true, schema: request.schema },
            }
          : { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Kimi ${response.status}: ${detail.slice(0, 200)}`);
    }

    if (streaming && response.body) {
      resetIdle();
      const content = await readSseContent(response.body, request.onDelta!, resetIdle);
      if (!content) throw new Error("Kimi 返回内容为空");
      return content;
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("Kimi 返回内容为空");
    return content;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * 调用大模型并拿到一份结构化 JSON。
 *
 * 优先用 json_schema；不支持、超时或报错时降级成 json_object。
 * 玩家取消与鉴权失败立刻放弃；单档超时会改试下一档，不会整步直接失败。
 */
export async function callKimiJson<T>(request: KimiJsonRequest): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  const attempts = attemptPlan(request.model);

  for (let i = 0; i < attempts.length; i++) {
    const variant = attempts[i];
    const remaining = request.timeoutMs - (Date.now() - started);
    if (remaining < MIN_ATTEMPT_MS) break;
    const hasNext = i < attempts.length - 1;
    const budget = attemptTimeoutMs(variant, remaining, hasNext, Boolean(request.onDelta));
    try {
      const parsed = parseJson<T>(await requestOnce(request, variant, budget));
      if (request.validate && !request.validate(parsed)) {
        throw new Error("返回的 JSON 结构不符合要求");
      }
      return parsed;
    } catch (error) {
      if (isFatal(error) || isUserCancel(error, request.signal)) throw error;
      lastError = error;
      if (!hasNext) break;
    }
  }

  throw lastError;
}
