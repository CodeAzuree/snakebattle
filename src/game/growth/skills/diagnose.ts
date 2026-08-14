import type { MatchSummary } from "@/game/replay";
import type { GrowthState } from "@/lib/growthStorage";
import {
  GAME_BACKGROUND,
  compactSummary,
  identityBlock,
  outputShape,
  strategyManual,
  truncate,
} from "./context";
import { callKimiJson } from "./kimi";
import { describeSkill, type Diagnosis, type DiagnosedProblem, type SkillContext } from "./types";

const MAX_PROBLEMS = 4;
const ISSUE_MAX = 60;
const EVIDENCE_MAX = 80;
const ROOT_CAUSE_MAX = 100;
const HYPOTHESIS_MAX = 80;
const EFFECT_MAX = 60;
const FOCUS_MAX = 60;

const SCHEMA = {
  type: "object",
  properties: {
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
  required: ["problems", "focus"],
  additionalProperties: false,
} as const;

function normalizePriority(raw: unknown): DiagnosedProblem["priority"] {
  const text = typeof raw === "string" ? raw.toLowerCase() : "";
  if (text.includes("high") || text.includes("高")) return "high";
  if (text.includes("low") || text.includes("低")) return "low";
  return "medium";
}

const PRIORITY_ORDER: Record<DiagnosedProblem["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sanitizeDiagnosis(raw: unknown): Diagnosis {
  const input = (raw ?? {}) as { problems?: unknown; focus?: unknown };
  const problems = Array.isArray(input.problems)
    ? input.problems
        .map((item) => {
          const entry = (item ?? {}) as Record<string, unknown>;
          return {
            issue: truncate(entry.issue, ISSUE_MAX),
            evidence: truncate(entry.evidence, EVIDENCE_MAX),
            rootCause: truncate(entry.rootCause, ROOT_CAUSE_MAX),
            hypothesis: truncate(entry.hypothesis, HYPOTHESIS_MAX),
            expectedEffect: truncate(entry.expectedEffect, EFFECT_MAX),
            priority: normalizePriority(entry.priority),
          };
        })
        .filter((item) => item.issue.length > 0)
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
        .slice(0, MAX_PROBLEMS)
    : [];

  return { problems, focus: truncate(input.focus, FOCUS_MAX) };
}

function buildSystemPrompt(): string {
  return [
    "你是一条贪吃蛇 AI 的「诊断模块」。",
    GAME_BACKGROUND,
    "",
    strategyManual(),
    "",
    "你这一步**只负责看病，不负责开药**：读完最近这几局的复盘数据，找出最值得修的问题。",
    "对每一条问题必须写清：",
    "- issue：现象，不超过 60 字",
    "- evidence：直接引用数据（死因、死亡现场、抢食记录、空间占比、浪费转向等）",
    "- rootCause：根因，必须落到策略规格的某个字段或算法选择上",
    "- hypothesis：下一轮该怎么改（例如「把 pathMode 从 greedy 换成 bfsShortest」）",
    "- expectedEffect：改完之后哪项指标应该变好",
    "- priority：high / medium / low",
    `最多列 ${MAX_PROBLEMS} 条，至少列 1 条。不要在这一步给出完整 StrategySpec，也不要输出台词。`,
    "",
    "【输出格式】只输出 JSON，且必须严格照这个结构，键名一个字都不能改：",
    outputShape(SCHEMA),
  ].join("\n");
}

function buildUserPrompt(state: GrowthState, matches: MatchSummary[]): string {
  const log = state.reflectionLog.slice(-5).map((entry) => ({
    是否采纳: entry.accepted,
    结论: entry.reason,
    适应度变化: `${entry.baselineFitness ?? "?"} → ${entry.candidateFitness ?? "?"}`,
    变更: entry.changes,
  }));

  return [
    identityBlock(state),
    `【本轮待复盘的 ${matches.length} 局】${JSON.stringify(matches.map(compactSummary))}`,
    `【最近几次进化的结论（含否决）】${JSON.stringify(log)}`,
    "",
    "请给出这几局暴露出来的问题清单。注意：",
    "1. 区分「策略缺陷」与「单局运气」：只在多局重复出现、或与某个规格字段有明确因果关系的现象才值得列为问题。",
    "2. 死亡现场里 avoidableDeath=true 且 safeDirections>0 说明它不是被围死，是自己走进了死角。",
    "3. 已经被否决过的改法不要再当作 hypothesis 原样提出。",
  ].join("\n");
}

export async function runDiagnose(
  state: GrowthState,
  matches: MatchSummary[],
  ctx: SkillContext
): Promise<Diagnosis> {
  const skill = describeSkill("diagnose");
  const stream = ctx.stream("diagnose");
  const deaths = matches.map((match) => match.aiDeath).filter(Boolean);
  stream(
    `正在读最近 ${matches.length} 局${deaths.length > 0 ? `（死因：${deaths.join("、")}）` : ""}\n`
  );

  const raw = await callKimiJson<unknown>({
    apiKey: ctx.apiKey,
    model: ctx.model,
    system: buildSystemPrompt(),
    user: buildUserPrompt(state, matches),
    schemaName: "snake_diagnosis",
    schema: SCHEMA,
    timeoutMs: Math.min(skill.budgetMs, Math.max(5_000, ctx.remainingMs())),
    signal: ctx.signal,
    temperature: 0.3,
    onDelta: stream,
    validate: (value) => {
      const problems = (value as { problems?: unknown })?.problems;
      return Array.isArray(problems) && problems.length > 0;
    },
  });

  const diagnosis = sanitizeDiagnosis(raw);
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
  return diagnosis;
}
