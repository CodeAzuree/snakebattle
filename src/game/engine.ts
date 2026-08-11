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
  Direction,
  GameState,
  MatchResult,
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

export function createInitialGameState(aiCharacterId: AICharacterId): GameState {
  const player = createPlayerSnake();
  const ai = createAiSnake();
  const occupied = buildOccupiedSet(player.body, ai.body);
  const food = randomEmptyPosition(GRID_SIZE, occupied);

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

function resolveDirection(current: Direction, requested: Direction | null): Direction {
  if (!requested) return current;
  if (isOpposite(requested, current)) return current;
  return requested;
}

/**
 * 推进一个 tick：读取玩家方向输入 → AI 决策 → 双蛇同步移动 → 碰撞判定
 * → 食物判定 → 计分/计时 → 胜负判定。
 * 对应 docs/DESIGN.md 2.1/2.4 节与附录 B 的 tick 执行顺序约定。
 */
export function stepGame(state: GameState, playerInput: Direction | null): GameState {
  if (state.phase !== "playing") return state;

  const character = AI_ROSTER[state.aiCharacterId];
  const aiDecision = character.decisionStrategy({
    gridSize: state.gridSize,
    self: state.ai,
    opponent: state.player,
    food: state.food,
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
    food = randomEmptyPosition(state.gridSize, occupied);
  }

  const timeRemainingMs = Math.max(0, state.timeRemainingMs - TICK_MS);

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
