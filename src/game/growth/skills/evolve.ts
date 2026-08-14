import {
  describeSpecDiff,
  FEATURE_KEYS,
  sanitizeStrategySpec,
  type StrategySpec,
} from "@/game/ai/strategy";
import { describePostmortem } from "@/game/growth/backtestPostmortem";
import type { GrowthState } from "@/lib/growthStorage";
import {
  GAME_BACKGROUND,
  identityBlock,
  outputShape,
  strategyManual,
  truncate,
} from "./context";
import { callKimiJson } from "./kimi";
import {
  describeSkill,
  type Diagnosis,
  type RejectionFeedback,
  type SkillContext,
  type SpecProposal,
} from "./types";

export const MAX_WEIGHT_CHANGES = 3;
export const MAX_RULE_CHANGES = 2;

const REASONING_MAX = 200;
const RATIONALE_MAX = 80;

const WEIGHT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(FEATURE_KEYS.map((key) => [key, { type: "number" }])),
  required: FEATURE_KEYS,
  additionalProperties: false,
} as const;

const SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    proposedSpec: {
      type: "object",
      properties: {
        specVersion: { type: "number" },
        pathMode: { type: "string" },
        weights: WEIGHT_SCHEMA,
        scoreExpression: { type: ["string", "null"] },
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              when: {
                type: "object",
                properties: {
                  kind: { type: "string" },
                  value: { type: "number" },
                },
                required: ["kind", "value"],
                additionalProperties: false,
              },
              then: { type: "string" },
            },
            required: ["when", "then"],
            additionalProperties: false,
          },
        },
        safety: {
          type: "object",
          properties: {
            avoidImmediateDeath: { type: "boolean" },
            requireEscapeRoute: { type: "boolean" },
            tailSafety: { type: "boolean" },
            minAreaMargin: { type: "number" },
          },
          required: ["avoidImmediateDeath", "requireEscapeRoute", "tailSafety", "minAreaMargin"],
          additionalProperties: false,
        },
        mistakeProbability: { type: "number" },
        notes: { type: "string" },
      },
      required: [
        "pathMode",
        "weights",
        "scoreExpression",
        "rules",
        "safety",
        "mistakeProbability",
        "notes",
      ],
      additionalProperties: false,
    },
  },
  required: ["reasoning", "rationale", "proposedSpec"],
  additionalProperties: false,
} as const;

function buildSystemPrompt(): string {
  return [
    "你是一条贪吃蛇 AI 的「进化模块」。",
    GAME_BACKGROUND,
    "",
    strategyManual(),
    "",
    "诊断模块已经列好了问题清单，你这一步负责开药：给出下一版完整 StrategySpec。约束如下：",
    `- 单轮最多改 1 个 pathMode、${MAX_WEIGHT_CHANGES} 个权重、${MAX_RULE_CHANGES} 条规则；safety / mistakeProbability 可各改一项。改太多会被测试直接判不合格。`,
    "- 每一项改动都必须对应问题清单里的某一条，写进 rationale，格式如「pathMode greedy→bfsShortest：对应问题 1」。",
    "- 不想改的字段原样返回旧值。先看清现役值，不要把已经开启的开关又写成关闭。",
    "- 如果上一版被否决，必须换思路，不要只是把同样的改动做得更极端。",
    "",
    "你的提案不会被直接采信。系统会用候选规格与现役规格在混合对手池（贪心/BFS/蛇王）上各跑多局回测，",
    "只有适应度不低于现役、且开局送死不增加，才会上线。",
    "",
    "【输出格式】只输出 JSON，且必须严格照这个结构，键名一个字都不能改（proposedSpec 少一个键都会被丢弃）：",
    outputShape(SCHEMA),
  ].join("\n");
}

function buildUserPrompt(
  state: GrowthState,
  diagnosis: Diagnosis,
  rejection?: RejectionFeedback
): string {
  const blocks = [
    identityBlock(state),
    `【诊断结论】${JSON.stringify(diagnosis)}`,
  ];

  if (rejection) {
    const postmortem = rejection.postmortem
      ? describePostmortem(rejection.postmortem).join("\n")
      : `否决原因：${rejection.reasons.join("；")}`;
    const specDiff =
      rejection.postmortem?.specDiff ?? describeSpecDiff(state.spec, rejection.spec);
    blocks.push(
      [
        "【上一版提案已被进化测试否决，这是第二次以上的尝试】",
        rejection.failureCause ? `未通过原因：${rejection.failureCause}` : "",
        `被否决的改动：${specDiff.join("；") || "（无）"}`,
        `回测：候选适应度 ${rejection.candidateFitness ?? "未测"} / 现役 ${rejection.baselineFitness}`,
        postmortem,
        "必须换思路：不要再提同一组改动，也不要把同样的改动做得更极端。",
        "可以改 pathMode、换一条规则、或只动与新问题清单直接相关的一两个权重。",
      ]
        .filter((line) => line.length > 0)
        .join("\n")
    );
  }

  blocks.push("请给出完整的下一版 StrategySpec。");
  return blocks.join("\n\n");
}

export async function runEvolve(
  state: GrowthState,
  diagnosis: Diagnosis,
  ctx: SkillContext,
  rejection?: RejectionFeedback
): Promise<SpecProposal> {
  const skill = describeSkill("evolve");
  const stream = ctx.stream("evolve");
  stream(
    rejection
      ? `上一版被否决（${rejection.reasons[0] ?? "未通过回测"}），正在换一个思路\n`
      : `正在针对 ${diagnosis.problems.length} 条诊断结论开药\n`
  );

  const raw = await callKimiJson<{
    reasoning?: unknown;
    rationale?: unknown;
    proposedSpec?: unknown;
  }>({
    apiKey: ctx.apiKey,
    model: ctx.model,
    system: buildSystemPrompt(),
    user: buildUserPrompt(state, diagnosis, rejection),
    schemaName: "snake_spec_proposal",
    schema: SCHEMA,
    timeoutMs: Math.min(skill.budgetMs, Math.max(5_000, ctx.remainingMs())),
    signal: ctx.signal,
    temperature: rejection ? 0.8 : 0.6,
    onDelta: stream,
    // proposedSpec 缺失时 sanitize 会整份回落成现役规格，回测于是"通过"，
    // 面板显示进化生效而适应度一动不动。这种情况必须当失败重来，不能放行。
    validate: (value) => {
      const spec = (value as { proposedSpec?: unknown })?.proposedSpec;
      return Boolean(spec) && typeof spec === "object";
    },
  });

  const { spec, adjustedFields } = sanitizeStrategySpec(raw.proposedSpec, state.spec);
  const reasoning = truncate(raw.reasoning, REASONING_MAX);
  const rationale = Array.isArray(raw.rationale)
    ? raw.rationale
        .map((item) => truncate(item, RATIONALE_MAX))
        .filter((item) => item.length > 0)
        .slice(0, 6)
    : [];

  if (reasoning) ctx.emit({ type: "note", skill: "evolve", text: reasoning });
  for (const item of rationale) {
    ctx.emit({ type: "note", skill: "evolve", text: `· ${item}` });
  }
  if (adjustedFields.length > 0) {
    ctx.emit({
      type: "note",
      skill: "evolve",
      text: `越界字段已被护栏收敛：${adjustedFields.slice(0, 6).join("、")}`,
    });
  }

  return { reasoning, spec, adjustedFields, rationale };
}

export function countSpecEdits(before: StrategySpec, after: StrategySpec) {
  const weightChanges = FEATURE_KEYS.filter(
    (key) => Math.abs(before.weights[key] - after.weights[key]) > 0.01
  ).length;
  const pathChanged = before.pathMode !== after.pathMode ? 1 : 0;
  const maxRules = Math.max(before.rules.length, after.rules.length);
  let ruleChanged = 0;
  for (let i = 0; i < maxRules; i++) {
    if (JSON.stringify(before.rules[i] ?? null) !== JSON.stringify(after.rules[i] ?? null)) {
      ruleChanged += 1;
    }
  }
  return { pathChanged, weightChanges, ruleChanged };
}
