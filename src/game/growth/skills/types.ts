import type { StrategySpec } from "@/game/ai/strategy";
import type { BacktestPostmortem } from "@/game/growth/backtestPostmortem";
import type { PersonaLineOverride } from "@/game/persona/lines";
import type { BacktestMatch, GenomeEvaluation } from "@/game/simulate";
import type { GrowthState, PersonaProfile } from "@/lib/growthStorage";

/**
 * 「？？？」的技能清单。
 *
 * 它不是一次性的黑箱调用，而是一个有固定成长路径的 Agent：
 * 先诊断、再提案、必须过测试、然后才谈人格，最后整理记忆。
 * 编排改由客户端分步请求，每步独立超时，彻底摆脱单次函数时长上限。
 */
export type SkillId = "diagnose" | "evolve" | "verify" | "persona" | "memory";

export type EvolutionStep = "diagnose" | "propose" | "rediagnose" | "persona" | "memory";

export interface SkillDescriptor {
  id: SkillId;
  name: string;
  purpose: string;
  budgetMs: number;
  usesLLM: boolean;
}

export const SKILL_REGISTRY: SkillDescriptor[] = [
  {
    id: "diagnose",
    name: "诊断",
    purpose: "读最近几局的复盘数据，列出问题清单、根因与本轮重点，不改策略",
    budgetMs: 50_000,
    usesLLM: true,
  },
  {
    id: "evolve",
    name: "进化",
    purpose: "针对诊断出的问题提出一版候选策略规格，每项改动都要对应一条问题",
    budgetMs: 50_000,
    usesLLM: true,
  },
  {
    id: "verify",
    name: "进化测试",
    purpose: "静态护栏 + 混合对手池沙盒回测 + 回归检查，不达标就退回重提",
    budgetMs: 12_000,
    usesLLM: false,
  },
  {
    id: "persona",
    name: "人格",
    purpose: "根据真正生效的能力变化，累积台词并更新人格档案",
    budgetMs: 45_000,
    usesLLM: true,
  },
  {
    id: "memory",
    name: "记忆整理",
    purpose: "把历史压缩成长期经验笔记，避免代数越多提示词越贵越糊",
    // 单次 22 秒封顶 + 一次重试，预算要装得下两次，否则重试只剩几秒等于没有
    budgetMs: 40_000,
    usesLLM: true,
  },
];

export const SKILL_TOTAL = SKILL_REGISTRY.length;

export function describeSkill(id: SkillId): SkillDescriptor {
  return SKILL_REGISTRY.find((skill) => skill.id === id) ?? SKILL_REGISTRY[0];
}

/** 进化流水线向外推送的过程事件；服务端逐条序列化成 NDJSON，客户端实时渲染 */
export type EvolutionEvent =
  | { type: "stage"; skill: SkillId; index: number; total: number; label: string }
  | { type: "note"; skill: SkillId; text: string }
  /** 模型边生成边推的可读片段，前端直接追加显示，这才是真正的流式输出 */
  | { type: "thinking"; skill: SkillId; delta: string }
  | { type: "progress"; skill: SkillId; done: number; total: number; label: string }
  | { type: "attempt"; attempt: number; max: number; reason: string }
  | { type: "skipped"; skill: SkillId; reason: string }
  | { type: "step-result"; step: EvolutionStep; payload: StepPayload }
  | { type: "done"; result: EvolutionResult }
  | { type: "error"; message: string };

export type StepPayload =
  | { step: "diagnose"; diagnosis: Diagnosis }
  | { step: "propose"; proposal: SpecProposal; verify: VerifyOutcome; accepted: boolean }
  | { step: "rediagnose"; diagnosis: Diagnosis; failureCause: string }
  | { step: "persona"; persona: PersonaUpdate }
  | { step: "memory"; notes: string };

export type EvolutionStatus = "accepted" | "rejected" | "failed";

export interface EvolutionResult {
  status: EvolutionStatus;
  /** 策略规格是否真的动了。通过回测不等于变强：提案可能与现役完全一致 */
  strategyChanged: boolean;
  /** 结果区正文：它自己说这轮发生了什么。headline 等技术描述收在详情里 */
  selfReport: string;
  headline: string;
  changes: string[];
  reasoning: string;
  candidateFitness: number | null;
  baselineFitness: number | null;
  attempts: number;
  state: GrowthState;
}

export interface SkillContext {
  apiKey: string;
  model: string;
  signal?: AbortSignal;
  emit: (event: EvolutionEvent) => void;
  remainingMs: () => number;
  /** 生成 callKimiJson 的 onDelta：把模型的实时输出挂到指定技能名下 */
  stream: (skill: SkillId) => (delta: string) => void;
}

export interface DiagnosedProblem {
  issue: string;
  evidence: string;
  rootCause: string;
  hypothesis: string;
  expectedEffect: string;
  priority: "high" | "medium" | "low";
}

export interface Diagnosis {
  problems: DiagnosedProblem[];
  focus: string;
}

export interface RejectionFeedback {
  spec: StrategySpec;
  reasons: string[];
  candidateFitness: number | null;
  baselineFitness: number;
  evaluation: GenomeEvaluation | null;
  baseline: GenomeEvaluation;
  postmortem: BacktestPostmortem | null;
  failureCause: string;
  /** 现役回测的每局复盘。有它就能跳过重测基准，仍能给下一版做对手归因 */
  baselineMatches: BacktestMatch[];
}

export interface SpecProposal {
  reasoning: string;
  spec: StrategySpec;
  adjustedFields: string[];
  rationale: string[];
}

export interface PersonaUpdate {
  name: string;
  tagline: string;
  growthStage: string;
  /** 它自己对这轮进化的第一人称播报，只给 UI 用，不进反思日志 */
  selfReport: string;
  lines: PersonaLineOverride;
  personaProfile: PersonaProfile;
}

export interface VerifyOutcome {
  passed: boolean;
  reasons: string[];
  evaluation: GenomeEvaluation;
  baseline: GenomeEvaluation;
  postmortem: BacktestPostmortem | null;
  baselineMatches: BacktestMatch[];
}
