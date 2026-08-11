/**
 * 核心玩法常量，对应 docs/DESIGN.md 2.1 节的模式定义。
 */
export const GRID_SIZE = 20;
export const GAME_DURATION_MS = 120_000;
export const TICK_MS = 120; // ≈ 8.3 tick/秒，落在 DESIGN.md 建议的 8–10 tick/秒区间
export const COUNTDOWN_SECONDS = 3;
export const INITIAL_SNAKE_LENGTH = 3;

/** 台词气泡的停留时长，对应 docs/UI_DESIGN.md 5.3 节 */
export const SPEECH_BUBBLE_DURATION_MS = 2600;
