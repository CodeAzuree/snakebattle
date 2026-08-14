import { EXPERIENCE_NOTES_MAX_LENGTH, type GrowthState } from "@/lib/growthStorage";
import { compactSummary, outputShape, summarizeSpec, truncate } from "./context";
import { callKimiJson } from "./kimi";
import { describeSkill, type SkillContext } from "./types";

const CONSOLIDATE_EVERY_GENERATIONS = 3;
const CONSOLIDATE_LOG_THRESHOLD = 6;

const SCHEMA = {
  type: "object",
  properties: { notes: { type: "string" } },
  required: ["notes"],
  additionalProperties: false,
} as const;

export function shouldConsolidateMemory(state: GrowthState): boolean {
  if (state.reflectionLog.length >= CONSOLIDATE_LOG_THRESHOLD) return true;
  return state.generation > 0 && state.generation % CONSOLIDATE_EVERY_GENERATIONS === 0;
}

function buildSystemPrompt(): string {
  return [
    "你是一条贪吃蛇 AI 的「记忆模块」。",
    "把它这段时间的对局与进化历史，压缩成一份写给未来自己看的长期经验笔记。",
    "",
    `不超过 ${EXPERIENCE_NOTES_MAX_LENGTH} 字，每条结论都要说明"某个策略字段调到什么范围会带来什么后果"，`,
    "并且必须真的来自下面这些历史数据，不要凭空编造、也不要照抄任何示例句式。",
    "不要复述比分与单局细节，不要写鼓励自己的话。",
    "",
    "【输出格式】只输出 JSON，且必须严格照这个结构，键名一个字都不能改：",
    outputShape(SCHEMA),
  ].join("\n");
}

function buildUserPrompt(state: GrowthState): string {
  return [
    `【已有笔记】${state.experienceNotes || "（还没有）"}`,
    `【现役策略】${JSON.stringify(summarizeSpec(state.spec))}`,
    `【进化历史】${JSON.stringify(
      state.reflectionLog.slice(-6).map((entry) => ({
        是否采纳: entry.accepted,
        结论: entry.reason,
        候选适应度: entry.candidateFitness,
        当时现役适应度: entry.baselineFitness,
      }))
    )}`,
    `【最近对局】${JSON.stringify(state.matchHistory.slice(-4).map(compactSummary))}`,
    "",
    "请输出合并后的新版经验笔记，替换掉旧的那份。",
  ].join("\n");
}

export async function runMemory(state: GrowthState, ctx: SkillContext): Promise<string> {
  const skill = describeSkill("memory");
  const stream = ctx.stream("memory");
  stream(`正在把 ${state.reflectionLog.length} 条进化结论压成一份长期笔记\n`);

  const raw = await callKimiJson<{ notes?: unknown }>({
    apiKey: ctx.apiKey,
    model: ctx.model,
    system: buildSystemPrompt(),
    user: buildUserPrompt(state),
    schemaName: "snake_memory",
    schema: SCHEMA,
    timeoutMs: Math.min(skill.budgetMs, Math.max(5_000, ctx.remainingMs())),
    signal: ctx.signal,
    temperature: 0.3,
    onDelta: stream,
    validate: (value) => typeof (value as { notes?: unknown })?.notes === "string",
  });

  const notes = truncate(raw.notes, EXPERIENCE_NOTES_MAX_LENGTH);
  if (notes) ctx.emit({ type: "note", skill: "memory", text: notes });
  return notes || state.experienceNotes;
}
