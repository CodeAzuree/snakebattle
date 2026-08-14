import { describeSpecDiff } from "@/game/ai/strategy";
import { describePostmortem } from "@/game/growth/backtestPostmortem";
import type { GrowthState } from "@/lib/growthStorage";
import { GAME_BACKGROUND, identityBlock, outputShape, strategyManual, truncate } from "./context";
import { sanitizeDiagnosis } from "./diagnose";
import { callKimiJson } from "./kimi";
import {
  describeSkill,
  type Diagnosis,
  type RejectionFeedback,
  type SkillContext,
} from "./types";

const FAILURE_CAUSE_MAX = 160;

const SCHEMA = {
  type: "object",
  properties: {
    failureCause: { type: "string" },
    problems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          issue: { type: "string" },
          evidence: { type: "string" },
          rootCause: { type: "string" },
          hypothesis: { type: "string" },
          expectedEffect: { type: "string" },
          priority: { type: "string" },
        },
        required: ["issue", "evidence", "rootCause", "hypothesis", "expectedEffect", "priority"],
        additionalProperties: false,
      },
    },
    focus: { type: "string" },
  },
  required: ["failureCause", "problems", "focus"],
  additionalProperties: false,
} as const;

function buildSystemPrompt(): string {
  return [
    "你是一条贪吃蛇 AI 的「复盘诊断模块」。",
    GAME_BACKGROUND,
    "",
    strategyManual(),
    "",
    "上一版进化提案没通过沙盒回测。你这一步只负责重新看病，不负责开药。",
    "先写清未通过原因，再给出一份替换掉旧清单的新问题清单。",
    "",
    "【适应度怎么算】总分 = 自己的得分 + 净胜分×0.5 + 存活占比×20 + 胜负奖励（赢 8 / 平 2） − 开局送死罚 8。",
    "空间变大、转向变少如果没换成得分或存活，总分照样会掉——那不叫变强。",
    "",
    "对 failureCause 的要求：",
    "- 必须落到「哪个改动导致哪项指标退化」，例如「把 pathMode 改成 spaceFill 之后，对蛇王的 3 局开局撞墙从 0 变成 2」。",
    "- 禁止只复述「适应度下降了」或把拒因原文抄一遍。",
    "",
    "对 problems 的要求：",
    "- 这是一份全新清单，会整份替换旧的。",
    "- 旧清单里仍然成立的问题请保留（可改证据）。",
    "- 已被回测证伪的假设必须丢掉，不要再当作 hypothesis。",
    "- 回测新暴露的问题（某个对手、某项适应度分项、某类死因）必须补上。",
    "- 每一条 hypothesis 不得重复被否决的那组改动。",
    "",
    "【输出格式】只输出 JSON，且必须严格照这个结构，键名一个字都不能改：",
    outputShape(SCHEMA),
  ].join("\n");
}

function buildUserPrompt(
  state: GrowthState,
  previous: Diagnosis,
  rejection: RejectionFeedback
): string {
  const postmortem = rejection.postmortem
    ? describePostmortem(rejection.postmortem).join("\n")
    : `否决原因：${rejection.reasons.join("；")}`;
  const specDiff =
    rejection.postmortem?.specDiff ?? describeSpecDiff(state.spec, rejection.spec);

  return [
    identityBlock(state),
    `【被否决的改动】${specDiff.join("；") || "（无字段差异，可能是静态检查未通过）"}`,
    `【回测复盘】\n${postmortem}`,
    `【旧诊断清单，供你决定保留或丢掉】${JSON.stringify(previous)}`,
    "",
    "请给出未通过原因，以及替换后的新问题清单。",
  ].join("\n");
}

export async function runRediagnose(
  state: GrowthState,
  previous: Diagnosis,
  rejection: RejectionFeedback,
  ctx: SkillContext
): Promise<{ diagnosis: Diagnosis; failureCause: string }> {
  const skill = describeSkill("diagnose");
  const stream = ctx.stream("diagnose");
  const hint = rejection.postmortem
    ? describePostmortem(rejection.postmortem)[0]
    : rejection.reasons[0];
  stream(`上一版没过测试，正在根据回测复盘重新看病${hint ? `（${hint}）` : ""}\n`);

  const raw = await callKimiJson<unknown>({
    apiKey: ctx.apiKey,
    model: ctx.model,
    system: buildSystemPrompt(),
    user: buildUserPrompt(state, previous, rejection),
    schemaName: "snake_rediagnosis",
    schema: SCHEMA,
    timeoutMs: Math.min(skill.budgetMs, Math.max(5_000, ctx.remainingMs())),
    signal: ctx.signal,
    temperature: 0.4,
    onDelta: stream,
    validate: (value) => {
      const input = value as { failureCause?: unknown; problems?: unknown };
      return (
        typeof input?.failureCause === "string" &&
        input.failureCause.trim().length > 0 &&
        Array.isArray(input.problems) &&
        input.problems.length > 0
      );
    },
  });

  const failureCause = truncate((raw as { failureCause?: unknown }).failureCause, FAILURE_CAUSE_MAX);
  const diagnosis = sanitizeDiagnosis(raw);

  if (failureCause) {
    ctx.emit({ type: "note", skill: "diagnose", text: `未通过原因：${failureCause}` });
  }
  for (const problem of diagnosis.problems) {
    ctx.emit({
      type: "note",
      skill: "diagnose",
      text: `[${problem.priority}] ${problem.issue}`,
    });
    if (problem.rootCause) {
      ctx.emit({ type: "note", skill: "diagnose", text: `  根因：${problem.rootCause}` });
    }
    if (problem.hypothesis) {
      ctx.emit({ type: "note", skill: "diagnose", text: `  假设：${problem.hypothesis}` });
    }
  }
  if (diagnosis.focus) {
    ctx.emit({ type: "note", skill: "diagnose", text: `本轮重点：${diagnosis.focus}` });
  }

  return { diagnosis, failureCause };
}
