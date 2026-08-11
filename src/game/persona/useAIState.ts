"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "../types";
import { computeEmotion } from "./emotion";
import { getRandomLine } from "./lines";

export interface AISpeech {
  text: string;
  key: number;
}

/**
 * 综合"引擎内部状态 + 情绪值"，在状态切换时从台词池随机选取一条
 * （避免与上一条重复），供 UI 层的台词气泡消费。
 * 对应 docs/DESIGN.md 第四章与 docs/UI_DESIGN.md 5.3 节。
 */
export function useAIState(state: GameState) {
  const emotion = computeEmotion(state.aiCharacterId, state);
  const lastKeyRef = useRef<string | null>(null);
  const lastLineRef = useRef<string | null>(null);
  const speechCounterRef = useRef(0);
  const [speech, setSpeech] = useState<AISpeech | null>(null);

  useEffect(() => {
    if (state.phase !== "playing") return;
    const key = `${state.aiInternalState}:${emotion}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    const line = getRandomLine(
      state.aiCharacterId,
      state.aiInternalState,
      emotion,
      lastLineRef.current
    );
    lastLineRef.current = line;
    speechCounterRef.current += 1;
    setSpeech({ text: line, key: speechCounterRef.current });
  }, [state.aiCharacterId, state.aiInternalState, emotion, state.phase]);

  return { emotion, speech };
}
