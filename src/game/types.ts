export interface Position {
  x: number;
  y: number;
}

export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export type PlayerId = "player" | "ai";

export type AICharacterId = "xiaotan" | "laomou" | "shewang";

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
}

export interface AIDecisionResult {
  direction: Direction;
  internalState: AIInternalState;
}

export type AIDecisionStrategy = (ctx: AIDecisionContext) => AIDecisionResult;
