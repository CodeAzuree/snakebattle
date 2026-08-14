"use client";

import { useSyncExternalStore } from "react";
import { describeSpecDiff } from "@/game/ai/strategy";
import { commitGrowthState, readGrowthState } from "@/lib/growthStore";
import { evolutionReadiness } from "@/lib/growthStorage";
import { STEP_TIMEOUT_MS, runEvolutionStep } from "./evolutionClient";
import { MAX_PROPOSAL_ATTEMPTS, mergeEvolutionResult, toRejection } from "./skills/pipeline";
import { shouldConsolidateMemory } from "./skills/memory";
import {
  SKILL_REGISTRY,
  type Diagnosis,
  type EvolutionEvent,
  type EvolutionResult,
  type EvolutionStep,
  type PersonaUpdate,
  type RejectionFeedback,
  type SkillId,
  type SpecProposal,
  type VerifyOutcome,
} from "./skills/types";

export type EvolutionPhase = "idle" | "running" | "finished";
export type SkillStatus = "pending" | "running" | "done" | "skipped";

export interface SkillProgress {
  id: SkillId;
  status: SkillStatus;
  detail: string;
}

export interface EvolutionNote {
  skill: SkillId;
  text: string;
}

export interface EvolutionRunState {
  phase: EvolutionPhase;
  skills: SkillProgress[];
  notes: EvolutionNote[];
  /** 模型正在生成的原文，按技能累积；步骤结束后由 notes 接管展示 */
  thinking: Partial<Record<SkillId, string>>;
  progress: { done: number; total: number; label: string } | null;
  attempt: { attempt: number; max: number } | null;
  result: EvolutionResult | null;
  error: string | null;
}

const MAX_NOTES = 40;
/** 单步实时原文的保留上限，超出就丢前面的，避免长跑把内存和渲染撑爆 */
const MAX_THINKING_CHARS = 4_000;

const IDLE_SKILLS: SkillProgress[] = SKILL_REGISTRY.map((skill) => ({
  id: skill.id,
  status: "pending" as SkillStatus,
  detail: "",
}));

/** 技能在流水线里的序号（1 起），stage 事件与本地回退都按它对齐 */
const SKILL_POSITION = new Map<SkillId, number>(
  SKILL_REGISTRY.map((skill, index) => [skill.id, index + 1])
);

const IDLE_STATE: EvolutionRunState = {
  phase: "idle",
  skills: IDLE_SKILLS,
  notes: [],
  thinking: {},
  progress: null,
  attempt: null,
  result: null,
  error: null,
};

let current: EvolutionRunState = IDLE_STATE;
let inFlight = false;
const listeners = new Set<() => void>();

function setState(next: EvolutionRunState) {
  current = next;
  for (const listener of listeners) listener();
}

/** 步骤行只有一行的宽度，长错误信息截短，完整内容仍在详情日志里 */
function truncateDetail(message: string): string {
  const trimmed = message.trim();
  return trimmed.length <= 24 ? trimmed : `${trimmed.slice(0, 24)}…`;
}

function updateSkill(
  skills: SkillProgress[],
  id: SkillId,
  status: SkillStatus,
  detail = ""
): SkillProgress[] {
  return skills.map((skill) => (skill.id === id ? { ...skill, status, detail } : skill));
}

/**
 * 把流水线指针挪到第 index 步：之前的一律收敛成"完成"，之后的退回"等待"。
 *
 * 关键在于前序步骤即使还挂着 running 也要收敛——否则回测跑完后没人给它收尾，
 * 等人格开跑就会出现两个步骤同时显示"进行中"。skipped 是明确结论，保留不动。
 */
function advanceTo(skills: SkillProgress[], index: number): SkillProgress[] {
  return skills.map((skill, position) => {
    const order = position + 1;
    if (order < index) {
      return skill.status === "skipped" ? skill : { ...skill, status: "done" as SkillStatus };
    }
    if (order === index) {
      return { ...skill, status: "running" as SkillStatus, detail: "" };
    }
    return { ...skill, status: "pending" as SkillStatus, detail: "" };
  });
}

function applyEvent(state: EvolutionRunState, event: EvolutionEvent): EvolutionRunState {
  switch (event.type) {
    case "stage":
      // 清掉这一步上一轮残留的原文：自我修正会把「进化」重跑一次
      return {
        ...state,
        skills: advanceTo(state.skills, event.index),
        thinking: { ...state.thinking, [event.skill]: "" },
        progress: null,
      };
    case "note":
      return {
        ...state,
        notes: [...state.notes, { skill: event.skill, text: event.text }].slice(-MAX_NOTES),
      };
    case "thinking": {
      const merged = ((state.thinking[event.skill] ?? "") + event.delta).slice(-MAX_THINKING_CHARS);
      return { ...state, thinking: { ...state.thinking, [event.skill]: merged } };
    }
    case "progress":
      return {
        ...state,
        progress: { done: event.done, total: event.total, label: event.label },
      };
    case "attempt":
      // 回测否决会把流程打回"进化"，这里立刻回退指针，不等下一次请求的首个事件
      return {
        ...state,
        attempt: { attempt: event.attempt, max: event.max },
        skills: advanceTo(state.skills, SKILL_POSITION.get("diagnose") ?? 1),
        progress: null,
        notes: [
          ...state.notes,
          {
            skill: "diagnose" as SkillId,
            text: `第 ${event.attempt}/${event.max} 次提案：上一版被否决（${event.reason}），已退回诊断重新看病。`,
          },
        ].slice(-MAX_NOTES),
      };
    case "skipped":
      return {
        ...state,
        skills: updateSkill(state.skills, event.skill, "skipped", truncateDetail(event.reason)),
        notes: [...state.notes, { skill: event.skill, text: event.reason }].slice(-MAX_NOTES),
      };
    case "done":
      return {
        ...state,
        phase: "finished",
        progress: null,
        result: event.result,
        skills: state.skills.map((skill) =>
          skill.status === "running" ? { ...skill, status: "done" as SkillStatus } : skill
        ),
      };
    case "error":
      // 只标记当前这一步失败。整轮的生死由客户端编排决定：
      // 人格/记忆整理是可跳过的，它们挂了不该把已经生效的进化判成失败。
      return {
        ...state,
        progress: null,
        skills: state.skills.map((skill) =>
          skill.status === "running"
            ? { ...skill, status: "skipped" as SkillStatus, detail: truncateDetail(event.message) }
            : skill
        ),
      };
    default:
      return state;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EvolutionRunState {
  return current;
}

export function useEvolutionRun(): EvolutionRunState {
  return useSyncExternalStore(subscribe, getSnapshot, () => IDLE_STATE);
}

export function isEvolutionRunning(): boolean {
  return current.phase === "running";
}

export function resetEvolutionRun() {
  if (inFlight) return;
  setState(IDLE_STATE);
}

function push(event: EvolutionEvent) {
  setState(applyEvent(current, event));
}

/**
 * 一步的流式输出结束后收尾。
 *
 * "进行中"应当严格等于"正在流式输出"，而两次请求之间存在网络间隙，
 * 不收尾的话上一步会一直亮着，直到下一步的第一个事件才熄灭。
 */
function settleRunning(status: Extract<SkillStatus, "done" | "skipped">, detail = "") {
  // 刻意不清 thinking：玩家刚看它一个字一个字吐完，收尾时把面板换成一段更短的
  // 摘要，观感就是"内容凭空缩水了"。原文留着，结论由 notes 追加在后面。
  setState({
    ...current,
    progress: null,
    skills: current.skills.map((skill) =>
      skill.status === "running" ? { ...skill, status, detail } : skill
    ),
  });
}

async function timedStep(
  step: EvolutionStep,
  state: Parameters<typeof runEvolutionStep>[0]["state"],
  context: unknown,
  parentSignal: AbortSignal
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS[step]);
  const forward = () => controller.abort();
  parentSignal.addEventListener("abort", forward, { once: true });
  try {
    const result = await runEvolutionStep({ step, state, context }, push, controller.signal);
    settleRunning("done");
    return result;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", forward);
  }
}

/**
 * 人格与记忆整理失败时给玩家看的说法。
 * 这两步不影响策略结果，措辞上要说清"跳过了、下轮再来"，而不是像整轮崩了。
 */
function optionalStepReason(error: unknown): string {
  const err = error as Error;
  if (err?.name === "AbortError" || err?.message?.includes("超时")) {
    return "这一步超时了，本轮跳过，下次再补";
  }
  return err?.message?.slice(0, 160) || "这一步失败了，本轮跳过";
}

/**
 * 启动一轮进化。客户端按技能逐步请求，自我修正循环也在这里。
 */
export async function startEvolution(): Promise<void> {
  if (inFlight) return;

  const growth = readGrowthState();
  if (!evolutionReadiness(growth).ready) return;

  inFlight = true;
  setState({ ...IDLE_STATE, phase: "running", skills: IDLE_SKILLS });
  const controller = new AbortController();

  try {
    const diagnoseEvent = await timedStep("diagnose", growth, undefined, controller.signal);
    if (diagnoseEvent.payload.step !== "diagnose") throw new Error("诊断步骤返回异常");
    let diagnosis: Diagnosis = diagnoseEvent.payload.diagnosis;

    let accepted = false;
    let proposal: SpecProposal | undefined;
    let verify: VerifyOutcome | undefined;
    let rejection: RejectionFeedback | undefined;
    let failureCause = "";
    let attempts = 0;

    for (let attempt = 1; attempt <= MAX_PROPOSAL_ATTEMPTS; attempt++) {
      attempts = attempt;
      if (attempt > 1 && rejection) {
        push({
          type: "attempt",
          attempt,
          max: MAX_PROPOSAL_ATTEMPTS,
          reason: rejection.failureCause || rejection.reasons.join("；") || "",
        });
        const redoEvent = await timedStep(
          "rediagnose",
          growth,
          { diagnosis, rejection },
          controller.signal
        );
        if (redoEvent.payload.step !== "rediagnose") throw new Error("重新诊断步骤返回异常");
        diagnosis = redoEvent.payload.diagnosis;
        failureCause = redoEvent.payload.failureCause;
        rejection = { ...rejection, failureCause };
      }
      const proposeEvent = await timedStep(
        "propose",
        growth,
        { diagnosis, rejection },
        controller.signal
      );
      if (proposeEvent.payload.step !== "propose") throw new Error("提案步骤返回异常");
      proposal = proposeEvent.payload.proposal;
      verify = proposeEvent.payload.verify;
      accepted = proposeEvent.payload.accepted;
      if (accepted) break;
      rejection = toRejection(proposal, verify, failureCause);
    }

    const specChanges =
      accepted && proposal ? describeSpecDiff(growth.spec, proposal.spec) : [];
    const nextGeneration =
      accepted && specChanges.length > 0 ? growth.generation + 1 : growth.generation;

    let persona: PersonaUpdate | null = null;
    try {
      const personaEvent = await timedStep(
        "persona",
        growth,
        { effectiveChanges: specChanges, accepted, generation: nextGeneration },
        controller.signal
      );
      if (personaEvent.payload.step === "persona") persona = personaEvent.payload.persona;
    } catch (error) {
      push({ type: "skipped", skill: "persona", reason: optionalStepReason(error) });
    }

    let experienceNotes = growth.experienceNotes;
    if (shouldConsolidateMemory(growth)) {
      try {
        const memoryEvent = await timedStep("memory", growth, undefined, controller.signal);
        if (memoryEvent.payload.step === "memory") experienceNotes = memoryEvent.payload.notes;
      } catch (error) {
        push({ type: "skipped", skill: "memory", reason: optionalStepReason(error) });
      }
    } else {
      push({ type: "skipped", skill: "memory", reason: "历史还不长，暂时不需要整理" });
    }

    const result = mergeEvolutionResult({
      state: growth,
      accepted,
      acceptedSpec: accepted ? proposal?.spec : undefined,
      evaluation: verify?.evaluation ?? rejection?.evaluation,
      baseline: verify?.baseline ?? rejection?.baseline,
      reasoning: proposal?.reasoning ?? "",
      attempts,
      persona,
      experienceNotes,
      rejectionReasons: rejection?.reasons ?? [],
      failureCause,
    });
    commitGrowthState(result.state);
    push({ type: "done", result });
  } catch (error) {
    const aborted = (error as Error).name === "AbortError";
    settleRunning("skipped", aborted ? "超时" : "失败");
    setState({
      ...current,
      phase: "finished",
      progress: null,
      error: aborted
        ? "进化超时了，这批对局没有被消耗，稍后再试一次。"
        : `进化没能完成：${(error as Error).message}`,
    });
  } finally {
    inFlight = false;
  }
}
