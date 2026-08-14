import { GAME_DURATION_MS, TICK_MS } from "@/lib/constants";
import { createSeededRng } from "@/lib/rng";
import { buildOccupiedSet, randomEmptyPosition } from "./board";
import { createInitialGameState, stepGame } from "./engine";
import { decideAdvanced } from "./ai/advanced";
import { decideBfs } from "./ai/bfs";
import { decideGreedy } from "./ai/greedy";
import { decideStrategy, type StrategySpec } from "./ai/strategy";
import { MatchRecorder, computeFitness, deriveMatchSummary, fitnessTerms } from "./replay";
import type { DeathCause, FitnessTerms, MatchRecord, MatchSummary } from "./replay";
import type { AICharacterId, AIDecisionStrategy, GameState, MatchResult } from "./types";

export interface SimulateMatchOptions {
  /** AI 一方的决策策略 */
  aiStrategy: AIDecisionStrategy;
  /** 玩家一方的代打策略，默认用 BFS 当作"稳健玩家"基准 */
  playerStrategy?: AIDecisionStrategy;
  /** 随机种子：相同种子下食物刷新序列完全一致，保证不同基因在同样的运气条件下比较 */
  seed?: number;
  aiCharacterId?: AICharacterId;
  tickMs?: number;
}

export interface SimulationOutcome {
  result: MatchResult;
  record: MatchRecord;
  summary: MatchSummary;
  fitness: number;
}

/**
 * 跑完整整一局（直到分出胜负或时间耗尽）的纯函数，供三处复用：
 * 离线胜率脚本、进化提案的沙盒回测、离线预训练脚本。
 */
export function simulateMatch(options: SimulateMatchOptions): SimulationOutcome {
  const {
    aiStrategy,
    playerStrategy = decideBfs,
    seed = 1,
    aiCharacterId = "laomou",
    tickMs = TICK_MS,
  } = options;

  const foodRng = createSeededRng(seed);
  const base = createInitialGameState(aiCharacterId);
  let state: GameState = {
    ...base,
    food: randomEmptyPosition(
      base.gridSize,
      buildOccupiedSet(base.player.body, base.ai.body),
      foodRng
    ),
  };

  const recorder = new MatchRecorder(state, tickMs);
  const maxTicks = Math.ceil(GAME_DURATION_MS / tickMs) + 5;

  for (let i = 0; i < maxTicks && state.phase === "playing"; i++) {
    const playerDecision = playerStrategy({
      gridSize: state.gridSize,
      self: state.player,
      opponent: state.ai,
      food: state.food,
      timeRemainingMs: state.timeRemainingMs,
      tickCount: state.tickCount,
    });
    const next = stepGame(state, playerDecision.direction, tickMs, {
      aiStrategy,
      foodPicker: (gridSize, occupied) => randomEmptyPosition(gridSize, occupied, foodRng),
    });
    recorder.track(state, next);
    state = next;
  }

  const record = recorder.finish(state);
  const summary = deriveMatchSummary(record);

  return {
    result: state.result ?? "draw",
    record,
    summary,
    fitness: computeFitness(summary),
  };
}

export interface EvaluateSpecOptions {
  /** 回测局数，取平均以削弱单局运气 */
  games?: number;
  /** 种子基数：候选与现役必须用同一组种子，结果才可比 */
  seedBase?: number;
  /** 逐局进度回调：回测是整轮进化里唯一耗时可预期的环节，用它驱动真实进度条 */
  onProgress?: (done: number, total: number) => void;
}

export type EvaluateGenomeOptions = EvaluateSpecOptions;

export interface GenomeEvaluation {
  averageFitness: number;
  averageScoreDiff: number;
  wins: number;
  games: number;
  earlyDeaths: number;
}

/** 回测对手池里的三种风格，按局序号轮换 */
export type BacktestOpponent = "greedy" | "bfs" | "snakeKing";

export const BACKTEST_OPPONENTS: BacktestOpponent[] = ["greedy", "bfs", "snakeKing"];

export const BACKTEST_OPPONENT_LABELS: Record<BacktestOpponent, string> = {
  greedy: "贪心",
  bfs: "BFS",
  snakeKing: "蛇王",
};

/** 单局回测留下的复盘。体积刻意压小，要跟着否决反馈走一趟客户端再回服务端。 */
export interface BacktestMatch {
  opponent: BacktestOpponent;
  seed: number;
  fitness: number;
  terms: FitnessTerms;
  death: DeathCause;
  earlyDeath: boolean;
  avoidableDeath: boolean;
  safeDirections: number | null;
  wastedTurns: number;
  spaceAvgRatio: number;
  turnRate: number;
  foodWinRate: number;
  aiScore: number;
  playerScore: number;
}

/** 带每局复盘的回测结果。存档只认 GenomeEvaluation 那五个字段。 */
export interface SpecEvaluation extends GenomeEvaluation {
  matches: BacktestMatch[];
}

export function toGenomeEvaluation(evaluation: GenomeEvaluation): GenomeEvaluation {
  return {
    averageFitness: evaluation.averageFitness,
    averageScoreDiff: evaluation.averageScoreDiff,
    wins: evaluation.wins,
    games: evaluation.games,
    earlyDeaths: evaluation.earlyDeaths,
  };
}

/** 混合对手池：按局序号轮换，固定分配保证候选与现役可比 */
const OPPONENT_POOL: AIDecisionStrategy[] = [decideGreedy, decideBfs, decideAdvanced];

export const BACKTEST_GAMES = 9;
export const BACKTEST_SEED_BASE = 20240501;

/**
 * 沙盒回测：让指定策略对战混合对手池（贪心 / BFS / 蛇王），
 * 用同一组种子跑 N 局取平均适应度。这是进化护栏的量化依据——
 * 「变强」从此意味着对三种风格都变强，上限不再卡在「打赢一个 BFS」。
 *
 * 逐局之间主动交还一次事件循环：单局模拟是纯 CPU 的同步循环，
 * 不让出控制权的话，进度事件只能等整轮回测结束后才被真正发送出去。
 */
export async function evaluateSpec(
  spec: StrategySpec,
  options: EvaluateSpecOptions = {}
): Promise<SpecEvaluation> {
  const { games = BACKTEST_GAMES, seedBase = BACKTEST_SEED_BASE, onProgress } = options;

  let fitnessSum = 0;
  let scoreDiffSum = 0;
  let wins = 0;
  let earlyDeaths = 0;
  const matches: BacktestMatch[] = [];

  for (let i = 0; i < games; i++) {
    const seed = seedBase + i * 7919;
    const aiRng = createSeededRng(seed ^ 0x9e3779b9);
    const opponent = BACKTEST_OPPONENTS[i % BACKTEST_OPPONENTS.length];
    const playerStrategy = OPPONENT_POOL[i % OPPONENT_POOL.length];
    const outcome = simulateMatch({
      seed,
      playerStrategy,
      aiCharacterId: "mystery",
      aiStrategy: (ctx) => decideStrategy(ctx, spec, aiRng),
    });
    const contests = outcome.summary.foodContests ?? [];
    const foodWins = contests.filter((contest) => contest.winner === "ai").length;
    matches.push({
      opponent,
      seed,
      fitness: outcome.fitness,
      terms: fitnessTerms(outcome.summary),
      death: outcome.summary.aiDeath,
      earlyDeath: outcome.summary.earlyDeath,
      avoidableDeath: outcome.summary.avoidableDeath,
      safeDirections: outcome.summary.deathContext?.safeDirections ?? null,
      wastedTurns: outcome.summary.wastedTurns,
      spaceAvgRatio: outcome.summary.spaceAvgRatio,
      turnRate: outcome.summary.aiTurnRate,
      foodWinRate: contests.length > 0 ? Number((foodWins / contests.length).toFixed(3)) : 0,
      aiScore: outcome.summary.aiScore,
      playerScore: outcome.summary.playerScore,
    });
    fitnessSum += outcome.fitness;
    scoreDiffSum += outcome.summary.aiScore - outcome.summary.playerScore;
    if (outcome.result === "ai") wins += 1;
    if (outcome.summary.earlyDeath) earlyDeaths += 1;
    onProgress?.(i + 1, games);
    if (i < games - 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    averageFitness: Number((fitnessSum / games).toFixed(3)),
    averageScoreDiff: Number((scoreDiffSum / games).toFixed(2)),
    wins,
    games,
    earlyDeaths,
    matches,
  };
}

/** @deprecated 使用 evaluateSpec；保留别名避免外部脚本短暂失效 */
export const evaluateGenome = evaluateSpec;
