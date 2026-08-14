/**
 * 核心玩法常量，对应 docs/DESIGN.md 2.1 节的模式定义。
 */
export const GRID_SIZE = 20;
export const GAME_DURATION_MS = 120_000;
// 实测反馈 DESIGN.md 最初建议的 8–10 tick/秒偏快，整体下调一档，
// 标准档约 5.6 tick/秒，手感更从容。
export const TICK_MS = 180;
export const COUNTDOWN_SECONDS = 3;
export const INITIAL_SNAKE_LENGTH = 3;

/**
 * 速度档位：数值越小 tick 间隔越短，蛇移动越快。
 * 不同速度下 120 秒的真实时长预算保持不变，只是单位时间内的步数变化。
 */
export const GAME_SPEED_PRESETS = [
  { id: "slow", label: "慢速", tickMs: 240 },
  { id: "normal", label: "标准", tickMs: TICK_MS },
  { id: "fast", label: "快速", tickMs: 120 },
] as const;

export type GameSpeedId = (typeof GAME_SPEED_PRESETS)[number]["id"];

export const DEFAULT_GAME_SPEED_ID: GameSpeedId = "normal";

export function getSpeedTickMs(speedId: GameSpeedId): number {
  return GAME_SPEED_PRESETS.find((preset) => preset.id === speedId)?.tickMs ?? TICK_MS;
}

export function findSpeedPresetByTickMs(tickMs: number) {
  return GAME_SPEED_PRESETS.find((preset) => preset.tickMs === tickMs) ?? null;
}

/**
 * 台词气泡的停留时长：给玩家留出足够时间读完这句台词，
 * 与"多久说一次话"无关——AI 现在只在特殊节点才开口，节奏由事件本身决定。
 * 对应 docs/UI_DESIGN.md 5.3 节。
 */
export const SPEECH_BUBBLE_DURATION_MS = 3200;

/**
 * 两条台词之间的最短间隔。V1.1 起 AI 只在"发言节点"（见 persona/highlights.ts）
 * 刚发生的那一刻才会开口，正常情况下这些节点之间天然有较大间隔，
 * 该常量的作用收窄为"防抖"：避免像"卡住时长刚好在阈值附近来回跳"
 * 或"比分差刚好在阈值附近来回穿越"这类边界抖动导致连续误触发，
 * 而不再是原来那种"控制刷屏节奏"的主力手段。数值可以比原来小一些。
 * 对应 docs/DESIGN.md 4.3 节。
 */
export const MIN_SPEECH_HOLD_MS = 2400;
