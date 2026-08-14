import { type AdaptiveGenome } from "@/game/ai/adaptive";
import {
  NOVICE_SPEC,
  migrateGenomeToSpec,
  sanitizeStrategySpec,
  type StrategySpec,
} from "@/game/ai/strategy";
import type { PersonaLineOverride } from "@/game/persona/lines";
import type { MatchSummary } from "@/game/replay";
import type { GenomeEvaluation } from "@/game/simulate";

export const GROWTH_STORAGE_KEY = "snakebattle.mysteryGrowth.v1";

/**
 * 攒够多少场「值得复盘」的对局才允许进化一次。
 *
 * 只计它输掉或打平的局：赢了说明现役策略够用，没必要强制复盘。
 * 这同时是成本护栏：想触发一次大模型调用，必须先真的暴露出问题。
 */
export const MATCHES_PER_EVOLUTION = 3;
/** 数据长度的提前触发线：败绩/平局局数没满但这些局累计时长够长，同样算攒够了素材 */
export const MIN_PENDING_SECONDS = 180;

/** 存档里保留的最近对局摘要数量 */
export const MAX_MATCH_HISTORY = 20;
/** 存档里保留的最近反思结论数量 */
export const MAX_REFLECTION_LOG = 10;
/** 长期经验笔记的长度上限，避免代数增长把 prompt 撑爆 */
export const EXPERIENCE_NOTES_MAX_LENGTH = 200;

export const NAME_MAX_LENGTH = 8;
export const TAGLINE_MAX_LENGTH = 20;
export const LINE_MAX_LENGTH = 28;
export const MAX_LINES_PER_POOL = 6;
export const PERSONA_PROFILE_FIELD_MAX = 60;

export const DEFAULT_MYSTERY_NAME = "？？？";
export const DEFAULT_MYSTERY_TAGLINE = "……（它还没学会说话）";

export interface ReflectionLogEntry {
  at: number;
  /** 提案是否通过沙盒回测并被采纳 */
  accepted: boolean;
  /** 大模型这轮的自述结论，或系统给出的拒绝原因 */
  reason: string;
  /** 回测得到的候选适应度与当时的现役适应度 */
  candidateFitness: number | null;
  baselineFitness: number | null;
  /** 人类可读的变更摘要，同时用于结算页的"成长播报" */
  changes: string[];
}

/**
 * 人格档案：写一次、之后每轮都回喂。
 * 没有它，模型每轮都在从零发明一个声音，台词永远攒不成个性。
 */
export interface PersonaProfile {
  voice: string;
  quirks: string;
  selfImage: string;
  attitude: string;
}

export const EMPTY_PERSONA_PROFILE: PersonaProfile = {
  voice: "",
  quirks: "",
  selfImage: "",
  attitude: "",
};

export interface GrowthState {
  version: 3;
  /** 展示名，大模型可以在进化中改掉 */
  name: string;
  tagline: string;
  spec: StrategySpec;
  /** 现役策略在沙盒回测里的适应度，null 表示还没测过 */
  bestFitness: number | null;
  /** 现役策略的完整回测指标：进化测试要拿它做回归对比 */
  bestEvaluation: GenomeEvaluation | null;
  /** 大模型给当前阶段起的名字，如"只会横冲直撞" */
  growthStage: string;
  /** 已被采纳的进化次数 */
  generation: number;
  lines: PersonaLineOverride;
  personaProfile: PersonaProfile;
  matchCount: number;
  /** 上一次进化时的 matchCount，与当前值之差就是"还没被复盘过的对局数" */
  lastEvolvedMatchCount: number;
  /** 记忆整理技能压缩出的长期经验笔记，替代逐条历史进入 prompt */
  experienceNotes: string;
  matchHistory: MatchSummary[];
  reflectionLog: ReflectionLogEntry[];
  lastReflectAt: number | null;
}

/**
 * 出厂存档：一条什么都不会、连话都说不利索的新手蛇。
 * 台词池刻意留得非常稀疏，让"后来它开始会说话了"本身成为成长的可见证据。
 */
export function createNoviceGrowthState(): GrowthState {
  return {
    version: 3,
    name: DEFAULT_MYSTERY_NAME,
    tagline: DEFAULT_MYSTERY_TAGLINE,
    spec: { ...NOVICE_SPEC, weights: { ...NOVICE_SPEC.weights }, safety: { ...NOVICE_SPEC.safety } },
    bestFitness: null,
    bestEvaluation: null,
    growthStage: "第 0 代 · 空白",
    generation: 0,
    lines: {},
    personaProfile: { ...EMPTY_PERSONA_PROFILE },
    matchCount: 0,
    lastEvolvedMatchCount: 0,
    experienceNotes: "",
    matchHistory: [],
    reflectionLog: [],
    lastReflectAt: null,
  };
}

function sanitizeText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

/** 改名校验：空串/超长一律忽略，保留原名，避免大模型把展示名玩坏 */
export function sanitizeName(raw: unknown, fallback: string): string {
  return sanitizeText(raw, NAME_MAX_LENGTH) ?? fallback;
}

export function sanitizeTagline(raw: unknown, fallback: string): string {
  return sanitizeText(raw, TAGLINE_MAX_LENGTH) ?? fallback;
}

function sanitizeLinePool(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pool = raw
    .map((line) => sanitizeText(line, LINE_MAX_LENGTH))
    .filter((line): line is string => line !== null)
    .slice(0, MAX_LINES_PER_POOL);
  return pool.length > 0 ? pool : undefined;
}

const LINE_POOL_KEYS = [
  "deadend",
  "blocking",
  "blocked",
  "streak",
  "streakBig",
  "bigLead",
  "bigDeficit",
] as const;

export const LANGUAGE_SCENE_KEYS = [
  ...LINE_POOL_KEYS,
  "ending.win",
  "ending.lose",
  "ending.draw",
] as const;

/** 台词覆盖校验：逐池裁剪，非法池整体丢弃并回落到静态台词 */
export function sanitizeLines(raw: unknown): PersonaLineOverride {
  const input = (raw ?? {}) as Record<string, unknown>;
  const result: PersonaLineOverride = {};

  for (const key of LINE_POOL_KEYS) {
    const pool = sanitizeLinePool(input[key]);
    if (pool) result[key] = pool;
  }

  const endingRaw = (input.ending ?? {}) as Record<string, unknown>;
  const win = sanitizeLinePool(endingRaw.win);
  const lose = sanitizeLinePool(endingRaw.lose);
  const draw = sanitizeLinePool(endingRaw.draw);
  if (win || lose || draw) {
    result.ending = { ...(win && { win }), ...(lose && { lose }), ...(draw && { draw }) };
  }

  return result;
}

/**
 * 台词去重用的指纹：剥掉标点、空白与省略号。
 *
 * 严格相等挡不住「……有点烦人。」和「有点烦人」这种同义改写，
 * 而池子只有 6 个位置，被近义句占满就等于个性再也长不出来。
 */
function lineFingerprint(line: string): string {
  const stripped = line.replace(/[\s。，、！？；：…·~～!?,.;:'"「」『』（）()\-—]/g, "");
  // 出厂期的台词本身就只有「……」「…？」这类噪声，剥完是空的，这时回落到原串比较
  return stripped.length > 0 ? stripped : line.trim();
}

function uniquePool(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of lines) {
    const key = lineFingerprint(line);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(line);
    if (result.length >= MAX_LINES_PER_POOL) break;
  }
  return result;
}

/**
 * 把新一轮写出的台词并进旧库：逐池累积、去重、截到上限。
 * 整包替换会让台词永远无法沉淀，这是「多次进化后没有鲜明个性」的直接原因。
 */
export function mergePersonaLines(
  current: PersonaLineOverride,
  incoming: PersonaLineOverride
): PersonaLineOverride {
  const merged: PersonaLineOverride = { ...current };
  for (const key of LINE_POOL_KEYS) {
    const next = incoming[key];
    if (!next || next.length === 0) continue;
    merged[key] = uniquePool([...(current[key] ?? []), ...next]);
  }
  const incomingEnding = incoming.ending;
  if (incomingEnding) {
    const currentEnding = current.ending ?? {};
    merged.ending = { ...currentEnding };
    for (const key of ["win", "lose", "draw"] as const) {
      const next = incomingEnding[key];
      if (!next || next.length === 0) continue;
      merged.ending[key] = uniquePool([...(currentEnding[key] ?? []), ...next]);
    }
  }
  return merged;
}

export function sanitizePersonaProfile(
  raw: unknown,
  fallback: PersonaProfile = EMPTY_PERSONA_PROFILE
): PersonaProfile {
  const input = (raw ?? {}) as Record<string, unknown>;
  return {
    voice: sanitizeText(input.voice, PERSONA_PROFILE_FIELD_MAX) ?? fallback.voice,
    quirks: sanitizeText(input.quirks, PERSONA_PROFILE_FIELD_MAX) ?? fallback.quirks,
    selfImage: sanitizeText(input.selfImage, PERSONA_PROFILE_FIELD_MAX) ?? fallback.selfImage,
    attitude: sanitizeText(input.attitude, PERSONA_PROFILE_FIELD_MAX) ?? fallback.attitude,
  };
}

function mergePersonaProfile(current: PersonaProfile, incoming: PersonaProfile): PersonaProfile {
  return {
    voice: incoming.voice || current.voice,
    quirks: incoming.quirks || current.quirks,
    selfImage: incoming.selfImage || current.selfImage,
    attitude: incoming.attitude || current.attitude,
  };
}

export { mergePersonaProfile };

/**
 * 台词场面完整度：已学会开口的发言场景数 / 全部场景数。
 * 让人格成长变成可验证的指标，而不是主观感受。
 */
export function languageCompleteness(state: GrowthState): { filled: number; total: number } {
  const total = LANGUAGE_SCENE_KEYS.length;
  let filled = 0;
  for (const key of LINE_POOL_KEYS) {
    if ((state.lines[key] ?? []).length > 0) filled += 1;
  }
  if ((state.lines.ending?.win ?? []).length > 0) filled += 1;
  if ((state.lines.ending?.lose ?? []).length > 0) filled += 1;
  if ((state.lines.ending?.draw ?? []).length > 0) filled += 1;
  return { filled, total };
}

function sanitizeNumber(raw: unknown, fallback: number | null): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

/** 回测指标只有整套字段都合法才有比较意义，缺一项就整体丢弃、下次重新测 */
function sanitizeEvaluation(raw: unknown): GenomeEvaluation | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const keys = [
    "averageFitness",
    "averageScoreDiff",
    "wins",
    "games",
    "earlyDeaths",
  ] as const;
  const values = keys.map((key) => sanitizeNumber(input[key], null));
  if (values.some((value) => value === null)) return null;
  const [averageFitness, averageScoreDiff, wins, games, earlyDeaths] = values as number[];
  return { averageFitness, averageScoreDiff, wins, games, earlyDeaths };
}

function looksLikeGenome(raw: unknown): raw is AdaptiveGenome {
  if (!raw || typeof raw !== "object") return false;
  return "safetyMargin" in raw && "lookaheadEnabled" in raw;
}

/**
 * 把任意来源（localStorage、导入的 JSON、服务端响应）的数据收敛成合法存档。
 * 存档是可以被玩家手工编辑/导入的，所以这里不能信任任何字段。
 */
export function sanitizeGrowthState(raw: unknown): GrowthState {
  const base = createNoviceGrowthState();
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Record<string, unknown>;

  const history = Array.isArray(input.matchHistory)
    ? (input.matchHistory.filter((item) => item && typeof item === "object") as MatchSummary[])
    : [];
  const log = Array.isArray(input.reflectionLog)
    ? (input.reflectionLog.filter(
        (item) => item && typeof item === "object"
      ) as ReflectionLogEntry[])
    : [];

  const matchCount = Math.max(0, Math.floor(sanitizeNumber(input.matchCount, 0) ?? 0));
  const lastEvolvedMatchCount = Math.min(
    matchCount,
    Math.max(0, Math.floor(sanitizeNumber(input.lastEvolvedMatchCount, matchCount) ?? matchCount))
  );

  const version = sanitizeNumber(input.version, 3) ?? 3;
  let spec: StrategySpec;
  let bestEvaluation: GenomeEvaluation | null = sanitizeEvaluation(input.bestEvaluation);
  let bestFitness = sanitizeNumber(input.bestFitness, null);

  if (input.spec && typeof input.spec === "object") {
    spec = sanitizeStrategySpec(input.spec, NOVICE_SPEC).spec;
  } else if (looksLikeGenome(input.genome)) {
    // v2 存档：把标量基因映射成策略规格，旧适应度不可比，强制下一轮重测
    spec = migrateGenomeToSpec(input.genome);
    bestEvaluation = null;
    bestFitness = null;
  } else {
    spec = base.spec;
    if (version < 3) {
      bestEvaluation = null;
      bestFitness = null;
    }
  }

  return {
    version: 3,
    name: sanitizeName(input.name, base.name),
    tagline: sanitizeTagline(input.tagline, base.tagline),
    spec,
    bestFitness,
    bestEvaluation,
    growthStage: sanitizeText(input.growthStage, 16) ?? base.growthStage,
    generation: Math.max(0, Math.floor(sanitizeNumber(input.generation, 0) ?? 0)),
    lines: sanitizeLines(input.lines),
    personaProfile: sanitizePersonaProfile(input.personaProfile),
    matchCount,
    lastEvolvedMatchCount,
    experienceNotes: sanitizeText(input.experienceNotes, EXPERIENCE_NOTES_MAX_LENGTH) ?? "",
    matchHistory: history.slice(-MAX_MATCH_HISTORY),
    reflectionLog: log.slice(-MAX_REFLECTION_LOG),
    lastReflectAt: sanitizeNumber(input.lastReflectAt, null),
  };
}

export function loadGrowthState(): GrowthState {
  if (typeof window === "undefined") return createNoviceGrowthState();
  try {
    const raw = window.localStorage.getItem(GROWTH_STORAGE_KEY);
    if (!raw) return createNoviceGrowthState();
    return sanitizeGrowthState(JSON.parse(raw));
  } catch {
    return createNoviceGrowthState();
  }
}

export function saveGrowthState(state: GrowthState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GROWTH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储写满或隐私模式禁用时静默失败：成长记录丢失不影响本局游戏
  }
}

export function resetGrowthState(): GrowthState {
  const fresh = createNoviceGrowthState();
  saveGrowthState(fresh);
  return fresh;
}

export function exportGrowthState(state: GrowthState): string {
  return JSON.stringify(state, null, 2);
}

export function importGrowthState(json: string): GrowthState | null {
  try {
    return sanitizeGrowthState(JSON.parse(json));
  } catch {
    return null;
  }
}

/** 把本局摘要追加进存档，并维持历史长度上限 */
export function appendMatchSummary(state: GrowthState, summary: MatchSummary): GrowthState {
  return {
    ...state,
    matchCount: state.matchCount + 1,
    matchHistory: [...state.matchHistory, summary].slice(-MAX_MATCH_HISTORY),
  };
}

/**
 * 把回测适应度折算成选角页的"挑战强度"条（0-100）。
 * 这条蛇没有预设难度档位，强度完全来自它自己练出来的成绩。
 */
export function estimateChallengeLevel(state: GrowthState): number {
  if (state.bestFitness === null) return 5;
  const normalized = ((state.bestFitness + 10) / 70) * 100;
  return Math.round(Math.min(100, Math.max(5, normalized)));
}

/**
 * 一场对局是否算复盘素材。
 *
 * result 是从玩家视角记的：player = 玩家赢 = 它输；ai = 它赢；draw = 平。
 * 只有暴露出问题的局（它输或平）才值得拿去诊断。
 */
export function isReviewMatch(summary: Pick<MatchSummary, "result">): boolean {
  return summary.result === "player" || summary.result === "draw";
}

function pendingWindow(state: GrowthState): MatchSummary[] {
  const since = Math.min(
    state.matchHistory.length,
    Math.max(0, state.matchCount - state.lastEvolvedMatchCount)
  );
  return since > 0 ? state.matchHistory.slice(-since) : [];
}

/** 自上次进化以来、还没被复盘过的败绩与平局——它们才是这次进化的输入素材 */
export function pendingMatchSummaries(state: GrowthState): MatchSummary[] {
  return pendingWindow(state).filter(isReviewMatch);
}

export interface EvolutionReadiness {
  ready: boolean;
  /** 已积累但尚未复盘的败绩/平局数 */
  pending: number;
  required: number;
  /** 这些对局累计的时长，用于"局数没满但数据够长"的提前触发 */
  pendingSeconds: number;
  requiredSeconds: number;
}

/**
 * 进化门禁：攒够 MATCHES_PER_EVOLUTION 场败绩或平局，或者这些局累计时长够长。
 * 它连胜时 pending 不加，也不会锁住「开始对战」——现役策略够用，不必强制进化。
 */
export function evolutionReadiness(state: GrowthState): EvolutionReadiness {
  const pendingMatches = pendingMatchSummaries(state);
  const pending = pendingMatches.length;
  const pendingSeconds = Number(
    pendingMatches.reduce((sum, summary) => sum + (summary.durationSec ?? 0), 0).toFixed(1)
  );

  return {
    ready: pending >= MATCHES_PER_EVOLUTION || pendingSeconds >= MIN_PENDING_SECONDS,
    pending,
    required: MATCHES_PER_EVOLUTION,
    pendingSeconds,
    requiredSeconds: MIN_PENDING_SECONDS,
  };
}

/** 一轮进化结束（无论提案是否被采纳）后调用：这批对局已经被消费掉了 */
export function markEvolved(state: GrowthState, now: number = Date.now()): GrowthState {
  return { ...state, lastEvolvedMatchCount: state.matchCount, lastReflectAt: now };
}
