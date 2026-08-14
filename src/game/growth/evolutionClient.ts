import type { GrowthState } from "@/lib/growthStorage";
import type { EvolutionEvent, EvolutionStep } from "./skills/types";

/** 单步兜底超时：服务端诊断/进化约 50 秒，这里留出网络余量 */
export const STEP_TIMEOUT_MS: Record<EvolutionStep, number> = {
  diagnose: 65_000,
  propose: 80_000,
  rediagnose: 65_000,
  persona: 60_000,
  memory: 55_000,
};

export interface StepRequest {
  step: EvolutionStep;
  state: GrowthState;
  context?: unknown;
}

/**
 * 消费 /api/ai-reflect 某一步的 NDJSON 流。
 * 返回该步的 step-result 事件；过程事件通过 onEvent 实时回调。
 */
export async function runEvolutionStep(
  request: StepRequest,
  onEvent: (event: EvolutionEvent) => void,
  signal?: AbortSignal
): Promise<Extract<EvolutionEvent, { type: "step-result" }>> {
  const response = await fetch("/api/ai-reflect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? `进化请求失败（${response.status}）`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Extract<EvolutionEvent, { type: "step-result" }> | null = null;

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as EvolutionEvent;
      onEvent(event);
      if (event.type === "step-result") result = event;
      if (event.type === "error") throw new Error(event.message);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) flushLine(line);
  }
  flushLine(buffer);

  if (!result) throw new Error("这一步没有返回结果。");
  return result;
}
