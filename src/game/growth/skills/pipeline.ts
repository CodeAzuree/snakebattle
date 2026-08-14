import { describeSpecDiff } from "@/game/ai/strategy";
import { hydrateSpecEvaluation } from "@/game/growth/backtestPostmortem";
import type { MatchSummary } from "@/game/replay";
import { toGenomeEvaluation, type GenomeEvaluation, type SpecEvaluation } from "@/game/simulate";
import {
  MAX_REFLECTION_LOG,
  markEvolved,
  mergePersonaLines,
  mergePersonaProfile,
  type GrowthState,
  type ReflectionLogEntry,
} from "@/lib/growthStorage";
import { runDiagnose } from "./diagnose";
import { runEvolve } from "./evolve";
import { DEFAULT_KIMI_MODEL } from "./kimi";
import { runMemory, shouldConsolidateMemory } from "./memory";
import { runPersona } from "./persona";
import { runRediagnose } from "./rediagnose";
import { measureBaseline, runVerify } from "./verify";
import {
  describeSkill,
  type Diagnosis,
  type EvolutionResult,
  type PersonaUpdate,
  type RejectionFeedback,
  type SkillContext,
  type SpecProposal,
  type VerifyOutcome,
} from "./types";

export const MAX_PROPOSAL_ATTEMPTS = 3;

export function toRejection(
  proposal: SpecProposal,
  verify: VerifyOutcome,
  failureCause = ""
): RejectionFeedback {
  return {
    spec: proposal.spec,
    reasons: verify.reasons,
    candidateFitness: verify.evaluation.averageFitness,
    baselineFitness: verify.baseline.averageFitness,
    evaluation: verify.evaluation,
    baseline: verify.baseline,
    postmortem: verify.postmortem,
    failureCause,
    baselineMatches: verify.baselineMatches,
  };
}

export function createSkillContext(input: {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  emit: SkillContext["emit"];
  budgetMs: number;
}): SkillContext {
  const deadline = Date.now() + input.budgetMs;
  return {
    apiKey: input.apiKey,
    model: input.model || DEFAULT_KIMI_MODEL,
    signal: input.signal,
    emit: input.emit,
    remainingMs: () => Math.max(0, deadline - Date.now()),
    stream: (skill) => (delta) => input.emit({ type: "thinking", skill, delta }),
  };
}

export async function runDiagnoseStep(
  state: GrowthState,
  matches: MatchSummary[],
  ctx: SkillContext
): Promise<Diagnosis> {
  ctx.emit({
    type: "stage",
    skill: "diagnose",
    index: 1,
    total: 5,
    label: describeSkill("diagnose").name,
  });
  return runDiagnose(state, matches, ctx);
}

export async function runRediagnoseStep(
  state: GrowthState,
  previous: Diagnosis,
  rejection: RejectionFeedback,
  ctx: SkillContext
): Promise<{ diagnosis: Diagnosis; failureCause: string }> {
  ctx.emit({
    type: "stage",
    skill: "diagnose",
    index: 1,
    total: 5,
    label: describeSkill("diagnose").name,
  });
  return runRediagnose(state, previous, rejection, ctx);
}

function reuseBaseline(rejection?: RejectionFeedback): SpecEvaluation | undefined {
  if (!rejection) return undefined;
  return hydrateSpecEvaluation(rejection.baseline, rejection.baselineMatches);
}

export async function runProposeStep(
  state: GrowthState,
  diagnosis: Diagnosis,
  ctx: SkillContext,
  rejection?: RejectionFeedback
): Promise<{ proposal: SpecProposal; verify: VerifyOutcome; accepted: boolean }> {
  ctx.emit({
    type: "stage",
    skill: "evolve",
    index: 2,
    total: 5,
    label: describeSkill("evolve").name,
  });
  const proposal = await runEvolve(state, diagnosis, ctx, rejection);

  ctx.emit({
    type: "stage",
    skill: "verify",
    index: 3,
    total: 5,
    label: describeSkill("verify").name,
  });
  const baseline = reuseBaseline(rejection) ?? (await measureBaseline(state.spec, ctx));
  const verify = await runVerify(
    proposal.spec,
    state.spec,
    baseline,
    proposal.adjustedFields,
    ctx
  );
  return { proposal, verify, accepted: verify.passed };
}

export async function runPersonaStep(
  state: GrowthState,
  input: { effectiveChanges: string[]; accepted: boolean; generation: number },
  ctx: SkillContext
): Promise<PersonaUpdate> {
  ctx.emit({
    type: "stage",
    skill: "persona",
    index: 4,
    total: 5,
    label: describeSkill("persona").name,
  });
  return runPersona(state, input, ctx);
}

export async function runMemoryStep(
  state: GrowthState,
  ctx: SkillContext
): Promise<{ notes: string; skipped?: string }> {
  ctx.emit({
    type: "stage",
    skill: "memory",
    index: 5,
    total: 5,
    label: describeSkill("memory").name,
  });
  if (!shouldConsolidateMemory(state)) {
    const reason = "历史还不长，暂时不需要整理";
    ctx.emit({ type: "skipped", skill: "memory", reason });
    return { notes: state.experienceNotes, skipped: reason };
  }
  const notes = await runMemory(state, ctx);
  return { notes };
}

export interface MergeInput {
  state: GrowthState;
  accepted: boolean;
  acceptedSpec?: GrowthState["spec"];
  evaluation?: GenomeEvaluation | null;
  baseline?: GenomeEvaluation | null;
  reasoning: string;
  attempts: number;
  persona: PersonaUpdate | null;
  experienceNotes: string;
  rejectionReasons: string[];
  failureCause?: string;
}

/**
 * 人格步骤可能超时被跳过，那时结果区不能空着。
 * 兜底也用第一人称，措辞比模型的粗糙，但至少还是它在说话。
 */
function fallbackSelfReport(accepted: boolean, strategyChanged: boolean, attempts: number): string {
  if (accepted && strategyChanged) return "我改了走法，这次跑得比原来的我好一点。";
  if (accepted) return "我想了半天，最后还是照原来的走法走。";
  if (attempts > 1) return `我试了 ${attempts} 版，没有一版比现在的我更好。`;
  return "这一轮我什么都没改成。";
}

/**
 * 把各步产物合成最终存档。失败路径不调用它——由客户端决定不消费对局。
 */
export function mergeEvolutionResult(input: MergeInput): EvolutionResult {
  const {
    state,
    accepted,
    acceptedSpec,
    evaluation,
    baseline,
    reasoning,
    attempts,
    persona,
    experienceNotes,
    rejectionReasons,
    failureCause,
  } = input;

  const specChanges =
    accepted && acceptedSpec ? describeSpecDiff(state.spec, acceptedSpec) : [];
  const personaChanges: string[] = [];
  if (persona && persona.name !== state.name) {
    personaChanges.push(`改名为「${persona.name}」`);
  }
  if (persona && Object.keys(persona.lines).length > 0) {
    personaChanges.push("更新了台词");
  }

  const changes = [...specChanges, ...personaChanges];
  const nextGeneration =
    accepted && specChanges.length > 0 ? state.generation + 1 : state.generation;
  const headline = accepted
    ? specChanges.length > 0
      ? `进化生效：${specChanges.slice(0, 2).join("；")}`
      : "策略维持不变，但它的表达方式变了。"
    : failureCause
      ? `连提 ${attempts} 版都没过测试：${failureCause}`
      : `连提 ${attempts} 版方案都没跑赢现役版本，这轮策略保持原样。`;

  const selfReport =
    persona?.selfReport?.trim() || fallbackSelfReport(accepted, specChanges.length > 0, attempts);

  const logEntry: ReflectionLogEntry = {
    at: Date.now(),
    accepted,
    reason: accepted
      ? reasoning || "提案通过回测"
      : `${failureCause || reasoning || "提案"}｜${rejectionReasons.join("；") || "未通过回测"}`,
    candidateFitness: evaluation?.averageFitness ?? null,
    baselineFitness: baseline?.averageFitness ?? state.bestFitness,
    changes,
  };

  const effectiveEvaluation = accepted && evaluation ? evaluation : baseline ?? state.bestEvaluation;
  const archivedEvaluation = effectiveEvaluation
    ? toGenomeEvaluation(effectiveEvaluation)
    : null;

  const finalState = markEvolved({
    ...state,
    name: persona?.name ?? state.name,
    tagline: persona?.tagline ?? state.tagline,
    growthStage: persona?.growthStage ?? state.growthStage,
    lines: persona ? mergePersonaLines(state.lines, persona.lines) : state.lines,
    personaProfile: persona
      ? mergePersonaProfile(state.personaProfile, persona.personaProfile)
      : state.personaProfile,
    spec: accepted && acceptedSpec ? acceptedSpec : state.spec,
    bestFitness: archivedEvaluation?.averageFitness ?? state.bestFitness,
    bestEvaluation: archivedEvaluation ?? state.bestEvaluation,
    generation: nextGeneration,
    experienceNotes,
    reflectionLog: [...state.reflectionLog, logEntry].slice(-MAX_REFLECTION_LOG),
  });

  return {
    status: accepted ? "accepted" : "rejected",
    strategyChanged: specChanges.length > 0,
    selfReport,
    headline,
    changes,
    reasoning,
    candidateFitness: logEntry.candidateFitness,
    baselineFitness: logEntry.baselineFitness,
    attempts,
    state: finalState,
  };
}

/** 离线训练脚本用：在同一进程里顺序跑完整流水线，事件打到 emit */
export async function runEvolution(input: {
  state: GrowthState;
  matches: MatchSummary[];
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
  emit: SkillContext["emit"];
}): Promise<EvolutionResult> {
  const { state, matches, emit } = input;
  const makeCtx = (budgetMs: number) =>
    createSkillContext({
      apiKey: input.apiKey,
      model: input.model,
      signal: input.signal,
      emit,
      budgetMs,
    });

  let diagnosis = await runDiagnoseStep(state, matches, makeCtx(describeSkill("diagnose").budgetMs));

  let accepted = false;
  let proposal: SpecProposal | undefined;
  let verify: VerifyOutcome | undefined;
  let rejection: RejectionFeedback | undefined;
  let failureCause = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt++) {
    attempts = attempt;
    if (attempt > 1 && rejection) {
      emit({
        type: "attempt",
        attempt,
        max: MAX_PROPOSAL_ATTEMPTS,
        reason: rejection.failureCause || rejection.reasons.join("；") || "",
      });
      const redo = await runRediagnoseStep(
        state,
        diagnosis,
        rejection,
        makeCtx(describeSkill("diagnose").budgetMs)
      );
      diagnosis = redo.diagnosis;
      failureCause = redo.failureCause;
      rejection = { ...rejection, failureCause };
    }
    const step = await runProposeStep(
      state,
      diagnosis,
      makeCtx(describeSkill("evolve").budgetMs),
      rejection
    );
    proposal = step.proposal;
    verify = step.verify;
    if (step.accepted) {
      accepted = true;
      break;
    }
    rejection = toRejection(step.proposal, step.verify, failureCause);
  }

  const specChanges =
    accepted && proposal ? describeSpecDiff(state.spec, proposal.spec) : [];
  const nextGeneration =
    accepted && specChanges.length > 0 ? state.generation + 1 : state.generation;

  let persona: PersonaUpdate | null = null;
  try {
    persona = await runPersonaStep(
      state,
      { effectiveChanges: specChanges, accepted, generation: nextGeneration },
      makeCtx(describeSkill("persona").budgetMs)
    );
  } catch (error) {
    emit({ type: "skipped", skill: "persona", reason: (error as Error).message.slice(0, 160) });
  }

  let experienceNotes = state.experienceNotes;
  try {
    const memory = await runMemoryStep(state, makeCtx(describeSkill("memory").budgetMs));
    experienceNotes = memory.notes;
  } catch (error) {
    emit({ type: "skipped", skill: "memory", reason: (error as Error).message.slice(0, 160) });
  }

  return mergeEvolutionResult({
    state,
    accepted,
    acceptedSpec: accepted ? proposal?.spec : undefined,
    evaluation: accepted ? verify?.evaluation : verify?.evaluation ?? rejection?.evaluation,
    baseline: verify?.baseline ?? rejection?.baseline,
    reasoning: proposal?.reasoning ?? "",
    attempts,
    persona,
    experienceNotes,
    rejectionReasons: rejection?.reasons ?? [],
    failureCause,
  });
}
