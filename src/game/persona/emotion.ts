import type { AICharacterId, EmotionState, GameState } from "../types";

/**
 * 情绪强度状态机，对应 docs/DESIGN.md 4.4 节。
 * 小贪的慌张度、蛇王的嘲讽值随局势变化；老谋刻意保持情绪不变，
 * 用"无论局势如何都很冷静"强化其"算无遗策"的人设。
 */
export function computeEmotion(
  characterId: AICharacterId,
  state: GameState
): EmotionState {
  const scoreDiff = state.ai.score - state.player.score;

  switch (characterId) {
    case "xiaotan": {
      if (state.aiInternalState === "deadend" || scoreDiff <= -2) return "tense";
      if (scoreDiff >= 2) return "confident";
      return "calm";
    }
    case "laomou":
      return "calm";
    case "shewang": {
      if (scoreDiff >= 2 || state.aiInternalState === "blocking") return "confident";
      return "calm";
    }
    default:
      return "calm";
  }
}
