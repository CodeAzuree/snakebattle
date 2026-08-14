export interface Position {
  x: number;
  y: number;
}

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export type PlayerId = "player" | "ai";

/**
 * `mystery` 是第四位挑战者（自学习 AI）的内部稳定 id，只在代码里使用；
 * 它展示给玩家的名字存在成长存档里，会随着大模型的进化而改变。
 */
export type AICharacterId = "xiaotan" | "laomou" | "shewang" | "mystery";

/**
 * AI 内部状态枚举，对应 docs/DESIGN.md 附录 B 与第四章的台词映射表。
 */
export type AIInternalState =
  | "hunting"
  | "escaping"
  | "blocking"
  | "wandering"
  | "deadend";

/**
 * 情绪强度，对应 docs/DESIGN.md 4.4 节的情绪状态机。
 */
export type EmotionState = "calm" | "tense" | "confident";

export interface SnakeState {
  id: PlayerId;
  body: Position[]; // index 0 为蛇头，对应 docs/DESIGN.md 附录 B 的坐标约定
  direction: Direction;
  alive: boolean;
  score: number;
}

export type GamePhase = "countdown" | "playing" | "paused" | "ended";

export type MatchResult = "player" | "ai" | "draw" | null;

export interface GameState {
  gridSize: number;
  player: SnakeState;
  ai: SnakeState;
  food: Position;
  timeRemainingMs: number;
  phase: GamePhase;
  result: MatchResult;
  aiCharacterId: AICharacterId;
  aiInternalState: AIInternalState;
  tickCount: number;
}

export interface AIDecisionContext {
  gridSize: number;
  self: SnakeState;
  opponent: SnakeState;
  food: Position;
  /** 剩余对局时长：策略规则（如「时间不够就冲分」）需要它 */
  timeRemainingMs: number;
  /** 已推进的 tick 数：用于惯性、阶段判断 */
  tickCount: number;
}

export interface AIDecisionResult {
  direction: Direction;
  internalState: AIInternalState;
}

export type AIDecisionStrategy = (ctx: AIDecisionContext) => AIDecisionResult;
