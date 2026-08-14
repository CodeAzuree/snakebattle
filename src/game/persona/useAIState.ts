"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_SPEECH_HOLD_MS } from "@/lib/constants";
import { AI_ROSTER } from "../ai/roster";
import type { AIInternalState, GameState } from "../types";
import { computeEmotion } from "./emotion";
import { resolveHighlight, SCORE_GAP_BIG, STREAK_MILESTONES, STUCK_THRESHOLD_MS } from "./highlights";
import type { HighlightKind } from "./highlights";
import { getLine } from "./lines";
import type { PersonaLineOverride } from "./lines";

export interface AISpeech {
  text: string;
  key: number;
}

/**
 * 运行时人格覆盖：只有自学习 AI 会传，内容来自它的成长存档。
 * 传入对象必须是稳定引用（调用方用 useMemo 包一层），否则会让下面的 effect 每次渲染都重跑。
 */
export interface DynamicPersona {
  tagline?: string;
  lines?: PersonaLineOverride;
}

type NonNullHighlight = Exclude<HighlightKind, null>;

/** AI 处于这些内部状态时视为"卡住/受阻"，持续累计真实时长用于判定 blocked 节点 */
const STUCK_STATES: AIInternalState[] = ["escaping", "wandering", "deadend"];

/**
 * AI 只在 highlights.ts 定义的"发言节点"刚发生的那一刻开口一次，其余时间保持沉默——
 * 沉默是常态，开口是事件，这样每一句台词才有明确的目的性。
 * 对应 docs/DESIGN.md 4.2/4.3 节与 docs/UI_DESIGN.md 5.3 节。
 */
export function useAIState(state: GameState, persona?: DynamicPersona) {
  const emotion = computeEmotion(state.aiCharacterId, state);

  const lastLineRef = useRef<string | null>(null);
  const speechCounterRef = useRef(0);
  const [speech, setSpeech] = useState<AISpeech | null>(null);

  // 滚动计数与"上一 tick 状态"记录：均为纯 UI 层状态，不写回 GameState
  const prevScoresRef = useRef({ ai: state.ai.score, player: state.player.score });
  const streakCountRef = useRef(0);
  const lastAnnouncedMilestoneRef = useRef(0);
  const prevTimeRemainingRef = useRef(state.timeRemainingMs);
  const stuckMsRef = useRef(0);
  const wasBlockedRef = useRef(false);
  const wasBigLeadRef = useRef(false);
  const wasBigDeficitRef = useRef(false);
  const prevInternalStateRef = useRef(state.aiInternalState);
  const lastSpeechAtRef = useRef<number | null>(null);
  // 命中的节点可能发生在冷却闸门关闭期间，先记下最高优先级的一个，等闸门打开时再播报
  const pendingHighlightRef = useRef<HighlightKind>(null);

  useEffect(() => {
    // 新的一局开始（含"再来一局"原地重开）：重置全部滚动计数，避免带入上一局的状态
    if (state.tickCount === 0) {
      prevScoresRef.current = { ai: state.ai.score, player: state.player.score };
      streakCountRef.current = 0;
      lastAnnouncedMilestoneRef.current = 0;
      prevTimeRemainingRef.current = state.timeRemainingMs;
      stuckMsRef.current = 0;
      wasBlockedRef.current = false;
      wasBigLeadRef.current = false;
      wasBigDeficitRef.current = false;
      prevInternalStateRef.current = state.aiInternalState;
      lastSpeechAtRef.current = null;
      pendingHighlightRef.current = null;
      lastLineRef.current = null;
      setSpeech(null);
      return;
    }

    if (state.phase !== "playing") return;

    const hits = new Set<NonNullHighlight>();

    // 开局第一帧：播报角色的签名开场白（复用 roster.ts 的 tagline，不重复维护内容）
    if (state.tickCount === 1) {
      hits.add("gameStart");
    }

    // 1. 连续吃豆里程碑：一次性事件，只在刚跨过 3/5/8 的那一 tick 命中
    const prevScores = prevScoresRef.current;
    if (state.ai.score > prevScores.ai) {
      streakCountRef.current += 1;
      if (
        (STREAK_MILESTONES as readonly number[]).includes(streakCountRef.current) &&
        streakCountRef.current > lastAnnouncedMilestoneRef.current
      ) {
        hits.add(
          streakCountRef.current >= STREAK_MILESTONES[STREAK_MILESTONES.length - 1]
            ? "streakBig"
            : "streak"
        );
        lastAnnouncedMilestoneRef.current = streakCountRef.current;
      }
    } else if (state.player.score > prevScores.player) {
      streakCountRef.current = 0;
      lastAnnouncedMilestoneRef.current = 0;
    }
    prevScoresRef.current = { ai: state.ai.score, player: state.player.score };

    // 2. 被挡住去路：用 timeRemainingMs 差值反推真实经过的毫秒数（天然适配三档速度），
    //    只在"卡住累计时长刚跨过阈值"的那一 tick 命中一次，持续卡住不会重复播报
    const deltaMs = Math.max(0, prevTimeRemainingRef.current - state.timeRemainingMs);
    prevTimeRemainingRef.current = state.timeRemainingMs;
    stuckMsRef.current = STUCK_STATES.includes(state.aiInternalState)
      ? stuckMsRef.current + deltaMs
      : 0;
    const isBlockedNow = stuckMsRef.current >= STUCK_THRESHOLD_MS;
    if (isBlockedNow && !wasBlockedRef.current) {
      hits.add("blocked");
    }
    wasBlockedRef.current = isBlockedNow;

    // 3. 比分大幅领先/落后：只在比分差刚跨过阈值的那一 tick 命中一次
    const scoreDiff = state.ai.score - state.player.score;
    const isBigLeadNow = scoreDiff >= SCORE_GAP_BIG;
    if (isBigLeadNow && !wasBigLeadRef.current) {
      hits.add("bigLead");
    }
    wasBigLeadRef.current = isBigLeadNow;
    const isBigDeficitNow = scoreDiff <= -SCORE_GAP_BIG;
    if (isBigDeficitNow && !wasBigDeficitRef.current) {
      hits.add("bigDeficit");
    }
    wasBigDeficitRef.current = isBigDeficitNow;

    // 4. 内部状态跳变为死路/主动封锁：只在刚进入该状态的那一 tick 命中一次
    if (state.aiInternalState === "deadend" && prevInternalStateRef.current !== "deadend") {
      hits.add("deadend");
    }
    if (state.aiInternalState === "blocking" && prevInternalStateRef.current !== "blocking") {
      hits.add("blocking");
    }
    prevInternalStateRef.current = state.aiInternalState;

    // 5. 把本 tick 命中的事件与之前排队中的事件合并，只保留最高优先级的一个
    if (pendingHighlightRef.current) {
      hits.add(pendingHighlightRef.current);
    }
    const bestPending = resolveHighlight(hits);
    if (bestPending) {
      pendingHighlightRef.current = bestPending;
    }

    // 6. 没有任何待播报的事件：保持沉默，不做任何事
    if (!pendingHighlightRef.current) return;

    // 7. 冷却闸门：距上次真正开口的时间不足最短间隔，先维持排队状态，下一 tick 继续检查
    const now = Date.now();
    const canSpeak =
      lastSpeechAtRef.current === null || now - lastSpeechAtRef.current >= MIN_SPEECH_HOLD_MS;
    if (!canSpeak) return;

    const highlight = pendingHighlightRef.current;
    pendingHighlightRef.current = null;

    const line =
      highlight === "gameStart"
        ? persona?.tagline || AI_ROSTER[state.aiCharacterId].tagline
        : getLine(state.aiCharacterId, highlight, lastLineRef.current, persona?.lines);

    lastLineRef.current = line;
    lastSpeechAtRef.current = now;
    speechCounterRef.current += 1;
    setSpeech({ text: line, key: speechCounterRef.current });
  }, [
    state.tickCount,
    state.phase,
    state.aiCharacterId,
    state.aiInternalState,
    state.ai.score,
    state.player.score,
    state.timeRemainingMs,
    persona,
  ]);

  return { emotion, speech };
}
