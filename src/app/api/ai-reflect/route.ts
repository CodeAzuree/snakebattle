import {
  createSkillContext,
  runDiagnoseStep,
  runMemoryStep,
  runPersonaStep,
  runProposeStep,
  runRediagnoseStep,
} from "@/game/growth/skills/pipeline";
import { describeSkill, type EvolutionEvent, type EvolutionStep } from "@/game/growth/skills/types";
import {
  evolutionReadiness,
  pendingMatchSummaries,
  sanitizeGrowthState,
  type GrowthState,
} from "@/lib/growthStorage";

/** 单步请求：诊断/进化各约 50 秒，提案另含回测。整轮由客户端串起来。 */
export const maxDuration = 90;

const STEPS: EvolutionStep[] = ["diagnose", "propose", "rediagnose", "persona", "memory"];

function isStep(value: unknown): value is EvolutionStep {
  return typeof value === "string" && (STEPS as string[]).includes(value);
}

/**
 * 分步进化接口。
 *
 * 每步一次独立请求、各自流式返回。回测与提案同处 propose 一步，
 * 「必须先赢过现役」这条护栏仍然由服务端把关。
 */
export async function POST(request: Request) {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "服务端未配置 MOONSHOT_API_KEY，无法进行进化。" },
      { status: 503 }
    );
  }

  let body: { step?: unknown; state?: unknown; context?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  if (!isStep(body.step)) {
    return Response.json({ error: "未知的进化步骤。" }, { status: 400 });
  }

  const state = sanitizeGrowthState(body.state);
  const matches = pendingMatchSummaries(state);
  if (body.step === "diagnose" || body.step === "propose") {
    if (!evolutionReadiness(state).ready || matches.length === 0) {
      return Response.json({ error: "复盘素材还不够，先再让它输掉或打平几局。" }, { status: 400 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: EvolutionEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const ctx = createSkillContext({
        apiKey,
        model: process.env.MOONSHOT_MODEL,
        signal: request.signal,
        emit: send,
        budgetMs: budgetFor(body.step as EvolutionStep),
      });

      try {
        await runStep(body.step as EvolutionStep, state, body.context, matches, ctx, send);
      } catch (error) {
        // 只报这一步出了什么事，不加"整轮失败"的判断——那是客户端编排的事
        send({ type: "error", message: (error as Error).message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function budgetFor(step: EvolutionStep): number {
  if (step === "diagnose" || step === "rediagnose") return describeSkill("diagnose").budgetMs;
  if (step === "propose") {
    return describeSkill("evolve").budgetMs + describeSkill("verify").budgetMs;
  }
  if (step === "persona") return describeSkill("persona").budgetMs;
  return describeSkill("memory").budgetMs;
}

async function runStep(
  step: EvolutionStep,
  state: GrowthState,
  context: unknown,
  matches: ReturnType<typeof pendingMatchSummaries>,
  ctx: ReturnType<typeof createSkillContext>,
  send: (event: EvolutionEvent) => void
) {
  const extra = (context ?? {}) as Record<string, unknown>;

  if (step === "diagnose") {
    const diagnosis = await runDiagnoseStep(state, matches, ctx);
    send({ type: "step-result", step: "diagnose", payload: { step: "diagnose", diagnosis } });
    return;
  }

  if (step === "propose") {
    const diagnosis = extra.diagnosis as Parameters<typeof runProposeStep>[1];
    if (!diagnosis?.problems) {
      throw new Error("提案步骤缺少诊断结论。");
    }
    const result = await runProposeStep(state, diagnosis, ctx, extra.rejection as never);
    send({
      type: "step-result",
      step: "propose",
      payload: { step: "propose", ...result },
    });
    return;
  }

  if (step === "rediagnose") {
    const diagnosis = extra.diagnosis as Parameters<typeof runRediagnoseStep>[1];
    const rejection = extra.rejection as Parameters<typeof runRediagnoseStep>[2];
    if (!diagnosis?.problems) {
      throw new Error("重新诊断缺少上一份问题清单。");
    }
    if (!rejection?.reasons) {
      throw new Error("重新诊断缺少回测否决信息。");
    }
    const result = await runRediagnoseStep(state, diagnosis, rejection, ctx);
    send({
      type: "step-result",
      step: "rediagnose",
      payload: { step: "rediagnose", ...result },
    });
    return;
  }

  if (step === "persona") {
    const persona = await runPersonaStep(
      state,
      {
        effectiveChanges: Array.isArray(extra.effectiveChanges)
          ? extra.effectiveChanges.filter((item): item is string => typeof item === "string")
          : [],
        accepted: extra.accepted === true,
        generation: typeof extra.generation === "number" ? extra.generation : state.generation,
      },
      ctx
    );
    send({ type: "step-result", step: "persona", payload: { step: "persona", persona } });
    return;
  }

  const memory = await runMemoryStep(state, ctx);
  send({ type: "step-result", step: "memory", payload: { step: "memory", notes: memory.notes } });
}
