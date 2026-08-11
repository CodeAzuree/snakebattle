/**
 * 本地胜率粗验脚本：用 BFS 策略模拟一个"稳健玩家"，
 * 分别对战三档 AI 各若干局，核对难度梯度是否符合 docs/DESIGN.md 3.2 节预期。
 * 运行：npx tsx scripts/simulate.ts
 */
import { AI_ROSTER } from "../src/game/ai/roster";
import { decideBfs } from "../src/game/ai/bfs";
import { GRID_SIZE, GAME_DURATION_MS, TICK_MS } from "../src/lib/constants";
import { buildOccupiedSet, randomEmptyPosition } from "../src/game/board";
import type { AICharacterId, GameState, SnakeState } from "../src/game/types";

function createSnake(id: "player" | "ai", startX: number, y: number, direction: "RIGHT" | "LEFT"): SnakeState {
  const dx = direction === "RIGHT" ? -1 : 1;
  const body = Array.from({ length: 3 }, (_, i) => ({ x: startX + dx * i, y }));
  return { id, body, direction, alive: true, score: 0 };
}

function createState(aiCharacterId: AICharacterId): GameState {
  const player = createSnake("player", 4, Math.floor(GRID_SIZE / 2) + 2, "RIGHT");
  const ai = createSnake("ai", GRID_SIZE - 5, Math.floor(GRID_SIZE / 2) - 2, "LEFT");
  const food = randomEmptyPosition(GRID_SIZE, buildOccupiedSet(player.body, ai.body));
  return {
    gridSize: GRID_SIZE,
    player,
    ai,
    food,
    timeRemainingMs: GAME_DURATION_MS,
    phase: "playing",
    result: null,
    aiCharacterId,
    aiInternalState: "hunting",
    tickCount: 0,
  };
}

// 复用引擎的同一套 tick 规则（从 src/game/engine.ts 内联精简版，避免引入 React/Next 依赖）
import { stepGame as engineStep } from "../src/game/engine";

function simulateOneGame(aiCharacterId: AICharacterId): "player" | "ai" | "draw" {
  let state = createState(aiCharacterId);
  const maxTicks = Math.ceil(GAME_DURATION_MS / TICK_MS) + 5;

  for (let i = 0; i < maxTicks && state.phase === "playing"; i++) {
    const playerDecision = decideBfs({
      gridSize: state.gridSize,
      self: state.player,
      opponent: state.ai,
      food: state.food,
    });
    state = engineStep(state, playerDecision.direction);
  }

  return state.result ?? "draw";
}

function runTrials(aiCharacterId: AICharacterId, trials: number) {
  let playerWins = 0;
  let aiWins = 0;
  let draws = 0;

  for (let i = 0; i < trials; i++) {
    const result = simulateOneGame(aiCharacterId);
    if (result === "player") playerWins++;
    else if (result === "ai") aiWins++;
    else draws++;
  }

  const character = AI_ROSTER[aiCharacterId];
  console.log(
    `${character.name}（${character.title}）：玩家代理胜 ${playerWins}/${trials} (${((playerWins / trials) * 100).toFixed(1)}%)，` +
      `AI 胜 ${aiWins}/${trials} (${((aiWins / trials) * 100).toFixed(1)}%)，平局 ${draws}/${trials}`
  );
}

const TRIALS = Number(process.argv[2] ?? 200);
console.log(`每档 AI 模拟 ${TRIALS} 局（玩家一方由 BFS 策略代打）...\n`);
runTrials("xiaotan", TRIALS);
runTrials("laomou", TRIALS);
runTrials("shewang", TRIALS);
