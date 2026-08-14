/**
 * "发言节点"判定：AI 只在下面这些真正有戏剧性的瞬间开口，其余时间保持沉默。
 * 所有节点都是"边缘触发"——只在条件刚从「否」变成「是」的那一 tick 命中一次，
 * 而不是在条件持续成立期间反复命中，从根本上避免"每隔几秒必然刷一句路人闲话"。
 * 对应 docs/DESIGN.md 4.2/4.3 节。
 */
export type HighlightKind =
  | "gameStart"
  | "streak"
  | "streakBig"
  | "deadend"
  | "blocking"
  | "blocked"
  | "bigLead"
  | "bigDeficit"
  | null;

/** 连续吃到 3/5/8 个即触发一次；8 复用 streakBig 的更夸张文案 */
export const STREAK_MILESTONES = [3, 5, 8] as const;

/** 卡住状态累计真实时长刚跨过这个阈值（ms）时，判定为一次"被挡住去路" */
export const STUCK_THRESHOLD_MS = 1400;

/**
 * 比分差达到这个量级才算"大幅"领先/落后，专用于更夸张的台词。
 * 比 emotion.ts 里 confident/tense 的阈值（2）更高，两套信号互不冲突：
 * emotion.ts 驱动头像小情绪/反应动效，这里驱动专属台词内容。
 */
export const SCORE_GAP_BIG = 3;

/**
 * 优先级从高到低：一次性的"连胜"事件 > 内部状态驱动的戏剧性瞬间（死路/主动封锁）
 * > 持续型条件刚跨过阈值的瞬间（卡住 / 比分悬殊）。
 */
const PRIORITY: Exclude<HighlightKind, null>[] = [
  "gameStart",
  "streakBig",
  "streak",
  "deadend",
  "blocking",
  "blocked",
  "bigLead",
  "bigDeficit",
];

/**
 * 从"本 tick 刚命中的边缘事件集合"中，按优先级挑出最高的一个。
 * 调用方（useAIState）负责把「上一 tick 条件是否成立」与「这一 tick 条件是否成立」
 * 做比较，只把真正发生了「否 -> 是」跳变的事件放进 hits 集合。
 */
export function resolveHighlight(hits: Set<Exclude<HighlightKind, null>>): HighlightKind {
  for (const kind of PRIORITY) {
    if (hits.has(kind)) return kind;
  }
  return null;
}
