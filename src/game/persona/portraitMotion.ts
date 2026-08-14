import type { AICharacterId, EmotionState } from "../types";

/**
 * 角色 × 情绪 → 肖像反应动效类名，对应 docs/UI_DESIGN.md 5.3 节的动态立绘设计。
 * 类名对应 globals.css 中定义的 .portrait-react-* 工具类，均只使用 transform，
 * 每次台词切换（speech.key 变化）时重新挂载并播放一次，播放完自然回落到 .portrait-idle 呼吸动效。
 */
export function getReactionClassName(id: AICharacterId, emotion: EmotionState): string {
  switch (id) {
    case "xiaotan":
      return emotion === "tense" ? "portrait-react-shake" : "portrait-react-bounce";
    case "laomou":
      return "portrait-react-nod";
    case "shewang":
      return emotion === "confident" ? "portrait-react-tilt" : "portrait-react-sway";
    // 数字生命感：说话时像信号不稳定一样抖一下
    case "mystery":
      return "portrait-react-glitch";
    default:
      return "portrait-react-nod";
  }
}

/**
 * 角色 × 情绪 → 情绪贴图素材路径。`calm` 是基线情绪，不叠加贴图，
 * 避免贴图常驻分散注意力，只在情绪明显偏离基线时才提示玩家。
 */
export function getEmotionBadgeSrc(id: AICharacterId, emotion: EmotionState): string | null {
  if (emotion === "calm") return null;
  return `/emotions/${id}-${emotion}.png`;
}
