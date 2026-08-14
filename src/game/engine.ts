import { GAME_DURATION_MS, GRID_SIZE, INITIAL_SNAKE_LENGTH, TICK_MS } from "@/lib/constants";
import { AI_ROSTER } from "./ai/roster";
import {
  addPosition,
  buildOccupiedSet,
  directionVector,
  isOpposite,
  isSamePosition,
  isWithinBounds,
  randomEmptyPosition,
} from "./board";
import type {
  AICharacterId,
  AIDecisionStrategy,
  Direction,
  GameState,
  MatchResult,
  Position,
  SnakeState,
} from "./types";

function createPlayerSnake(): SnakeState {
  const y = Math.floor(GRID_SIZE / 2) + 2;
  const startX = 4;
  const body = Array.from({ length: INITIAL_SNAKE_LENGTH }, (_, i) => ({
    x: startX - i,
    y,
  }));
  return { id: "player", body, direction: "RIGHT", alive: true, score: 0 };
}

function createAiSnake(): SnakeState {
  const y = Math.floor(GRID_SIZE / 2) - 2;
  const startX = GRID_SIZE - 5;
  const body = Array.from({ length: INITIAL_SNAKE_LENGTH }, (_, i) => ({
    x: startX + i,
    y,
  }));
  return { id: "ai", body, direction: "LEFT", alive: true, score: 0 };
}

/**
 * 初始食物位置固定取网格正中心（双方蛇的初始占位都在中心行/列之外，保证不重叠），
 * 不在此处调用 Math.random()。
 *
 * 原因：`createInitialGameState` 会被 `useState(() => createInitialGameState(...))`
 * 这种初始化器调用，而客户端组件在 Next.js 里首次渲染时会先做一次 SSR，
 * 再在浏览器端 hydrate 一次——如果这里用随机数生成食物位置，服务端和客户端会各自
 * 随机出不同的坐标，导致 hydration mismatch（控制台报错）。真正的随机食物位置
 * 由 `rerollFoodPosition` 在客户端 mount 后的 `useEffect` 里再生成一次。
 */
function centerFoodPosition(gridSize: number): Position {
  return { x: Math.floor(gridSize / 2), y: Math.floor(gridSize / 2) };
}

export function createInitialGameState(aiCharacterId: AICharacterId): GameState {
  const player = createPlayerSnake();
  const ai = createAiSnake();
  const food = centerFoodPosition(GRID_SIZE);

  return {
    gridSize: GRID_SIZE,
    player,
    ai,
    food,
    timeRemainingMs: GAME_DURATION_MS,
    // 选角页已完成 3 秒倒计时，进入 /play 时直接开始
    phase: "playing",
    result: null,
    aiCharacterId,
    aiInternalState: "hunting",
    tickCount: 0,
  };
}

/**
 * 只在客户端 mount 之后调用一次，把食物从确定性的中心位置重新随机摆放，
 * 避免上面提到的 SSR/CSR 随机数不一致问题。
 */
export function rerollFoodPosition(state: GameState): GameState {
  const occupied = buildOccupiedSet(state.player.body, state.ai.body);
  return { ...state, food: randomEmptyPosition(state.gridSize, occupied) };
}

function resolveDirection(current: Direction, requested: Direction | null): Direction {
  if (!requested) return current;
  if (isOpposite(requested, current)) return current;
  return requested;
}

/**
 * tick 的可注入点。正常对局两个字段都不传，走 roster 查表 + 随机刷豆；
 * 沙盒回测传入候选策略与带种子的刷豆函数以保证可复现，
 * 回放则两者都传入"照本宣科"的版本以精确还原历史对局。
 */
export interface StepOptions {
  /** 覆盖 AI 决策来源，用于试跑任意策略而不必先写进 roster */
  aiStrategy?: AIDecisionStrategy;
  /** 覆盖食物刷新位置的来源 */
  foodPicker?: (gridSize: number, occupied: Set<string>) => Position;
}

/**
 * 推进一个 tick：读取玩家方向输入 → AI 决策 → 双蛇同步移动 → 碰撞判定
 * → 食物判定 → 计分/计时 → 胜负判定。
 * 对应 docs/DESIGN.md 2.1/2.4 节与附录 B 的 tick 执行顺序约定。
 */
export function stepGame(
  state: GameState,
  playerInput: Direction | null,
  tickMs: number = TICK_MS,
  options: StepOptions = {}
): GameState {
  if (state.phase !== "playing") return state;

  const strategy = options.aiStrategy ?? AI_ROSTER[state.aiCharacterId].decisionStrategy;
  const aiDecision = strategy({
    gridSize: state.gridSize,
    self: state.ai,
    opponent: state.player,
    food: state.food,
    timeRemainingMs: state.timeRemainingMs,
    tickCount: state.tickCount,
  });

  const playerDirection = resolveDirection(state.player.direction, playerInput);
  const aiDirection = resolveDirection(state.ai.direction, aiDecision.direction);

  const playerNextHead = addPosition(state.player.body[0], directionVector(playerDirection));
  const aiNextHead = addPosition(state.ai.body[0], directionVector(aiDirection));

  const playerEats = isSamePosition(playerNextHead, state.food);
  const aiEats = isSamePosition(aiNextHead, state.food);

  const nextPlayerBody = [
    playerNextHead,
    ...state.player.body.slice(
      0,
      playerEats ? state.player.body.length : state.player.body.length - 1
    ),
  ];
  const nextAiBody = [
    aiNextHead,
    ...state.ai.body.slice(0, aiEats ? state.ai.body.length : state.ai.body.length - 1),
  ];

  // 双蛇同一 tick 内交换头部位置（擦肩而过）也判定为相撞，避免"穿过对方"的违和感
  const swapped =
    isSamePosition(playerNextHead, state.ai.body[0]) &&
    isSamePosition(aiNextHead, state.player.body[0]);

  const playerHitsWall = !isWithinBounds(playerNextHead, state.gridSize);
  const aiHitsWall = !isWithinBounds(aiNextHead, state.gridSize);

  const playerHitsSelf = nextPlayerBody
    .slice(1)
    .some((seg) => isSamePosition(seg, playerNextHead));
  const aiHitsSelf = nextAiBody.slice(1).some((seg) => isSamePosition(seg, aiNextHead));

  const playerHitsAi = nextAiBody.some((seg) => isSamePosition(seg, playerNextHead));
  const aiHitsPlayer = nextPlayerBody.some((seg) => isSamePosition(seg, aiNextHead));

  const playerDead = playerHitsWall || playerHitsSelf || playerHitsAi || swapped;
  const aiDead = aiHitsWall || aiHitsSelf || aiHitsPlayer || swapped;

  let food = state.food;
  const playerScore = state.player.score + (playerEats && !playerDead ? 1 : 0);
  const aiScore = state.ai.score + (aiEats && !aiDead ? 1 : 0);

  if ((playerEats && !playerDead) || (aiEats && !aiDead)) {
    const occupied = buildOccupiedSet(nextPlayerBody, nextAiBody);
    const pickFood = options.foodPicker ?? randomEmptyPosition;
    food = pickFood(state.gridSize, occupied);
  }

  const timeRemainingMs = Math.max(0, state.timeRemainingMs - tickMs);

  let result: MatchResult = null;
  let phase: GameState["phase"] = "playing";

  if (playerDead && aiDead) {
    result = "draw";
    phase = "ended";
  } else if (playerDead) {
    result = "ai";
    phase = "ended";
  } else if (aiDead) {
    result = "player";
    phase = "ended";
  } else if (timeRemainingMs <= 0) {
    phase = "ended";
    if (playerScore > aiScore) result = "player";
    else if (aiScore > playerScore) result = "ai";
    else result = "draw";
  }

  return {
    ...state,
    player: {
      ...state.player,
      body: nextPlayerBody,
      direction: playerDirection,
      alive: !playerDead,
      score: playerScore,
    },
    ai: {
      ...state.ai,
      body: nextAiBody,
      direction: aiDirection,
      alive: !aiDead,
      score: aiScore,
    },
    food,
    timeRemainingMs,
    phase,
    result,
    aiInternalState: aiDecision.internalState,
    tickCount: state.tickCount + 1,
  };
}
