import { GAME_DURATION_MS, TICK_MS } from "@/lib/constants";
import { createInitialGameState, stepGame } from "./engine";
import {
  ALL_DIRECTIONS,
  addPosition,
  bfsReachableArea,
  buildOccupiedSet,
  directionVector,
  isOpposite,
  isSamePosition,
  isWithinBounds,
  manhattanDistance,
} from "./board";
import type {
  AICharacterId,
  AIInternalState,
  Direction,
  GameState,
  MatchResult,
  Position,
} from "./types";

/**
 * 单 tick 的最小记录。不存双方完整蛇身坐标（几百 tick 会非常冗余），
 * 只存"双方实际移动方向 + AI 内部状态 + 本 tick 新刷出的食物"，
 * 把这些输入回放进纯函数 stepGame() 就能确定性还原出每一 tick 的完整坐标。
 */
export interface MatchTickRecord {
  /** 玩家本 tick 实际采用的方向（已经过反向输入过滤） */
  p: Direction;
  /** AI 本 tick 实际采用的方向 */
  a: Direction;
  /** AI 本 tick 的内部状态 */
  s: AIInternalState;
  /** 本 tick 结束后新刷出的食物位置，仅在有蛇吃到豆时存在 */
  f?: Position;
}

export interface MatchRecord {
  version: 1;
  gridSize: number;
  tickMs: number;
  aiCharacterId: AICharacterId;
  /** 开局食物位置（客户端 mount 后随机摆放的那一颗） */
  initialFood: Position;
  ticks: MatchTickRecord[];
  result: MatchResult;
  playerScore: number;
  aiScore: number;
}

/**
 * 对局记录器：在每次 stepGame 之后调用 track(prev, next)，
 * 结束时 finish() 产出一份可完整重放的紧凑记录。
 */
export class MatchRecorder {
  private readonly ticks: MatchTickRecord[] = [];
  private readonly initialFood: Position;
  private readonly aiCharacterId: AICharacterId;
  private readonly gridSize: number;
  private readonly tickMs: number;

  constructor(initialState: GameState, tickMs: number = TICK_MS) {
    this.initialFood = initialState.food;
    this.aiCharacterId = initialState.aiCharacterId;
    this.gridSize = initialState.gridSize;
    this.tickMs = tickMs;
  }

  track(prev: GameState, next: GameState) {
    if (next.tickCount === prev.tickCount) return; // 非 playing 阶段，stepGame 原样返回
    const entry: MatchTickRecord = {
      p: next.player.direction,
      a: next.ai.direction,
      s: next.aiInternalState,
    };
    if (!isSamePosition(prev.food, next.food)) {
      entry.f = next.food;
    }
    this.ticks.push(entry);
  }

  get tickCount() {
    return this.ticks.length;
  }

  finish(finalState: GameState): MatchRecord {
    return {
      version: 1,
      gridSize: this.gridSize,
      tickMs: this.tickMs,
      aiCharacterId: this.aiCharacterId,
      initialFood: this.initialFood,
      ticks: this.ticks,
      result: finalState.result,
      playerScore: finalState.player.score,
      aiScore: finalState.ai.score,
    };
  }
}

/**
 * 把紧凑记录重放成逐 tick 的完整状态序列（index 0 为开局状态）。
 * AI 决策与食物刷新都改为"照本宣科"，因此还原结果与当时一模一样，
 * 即便当时的 AI 带有随机失误也不会偏离。
 */
export function replayMatch(record: MatchRecord): GameState[] {
  let state: GameState = {
    ...createInitialGameState(record.aiCharacterId),
    food: record.initialFood,
  };
  const states: GameState[] = [state];

  for (const tick of record.ticks) {
    const scripted = { direction: tick.a, internalState: tick.s };
    state = stepGame(state, tick.p, record.tickMs, {
      aiStrategy: () => scripted,
      foodPicker: () => tick.f ?? state.food,
    });
    states.push(state);
  }

  return states;
}

export type DeathCause = "wall" | "self" | "opponent" | "survived";

export interface MatchSummary {
  result: MatchResult;
  durationTicks: number;
  durationSec: number;
  playerScore: number;
  aiScore: number;
  aiDeath: DeathCause;
  playerDeath: DeathCause;
  /** AI 连续吃豆（中途没被玩家抢走）的峰值 */
  aiMaxStreak: number;
  /** AI 处于"无路可走"状态的 tick 数 */
  aiDeadendTicks: number;
  /** AI 各内部状态占比，保留两位小数 */
  aiStateRatio: Partial<Record<AIInternalState, number>>;
  /** AI 蛇头到食物的平均曼哈顿距离，衡量它是否在有效逼近目标 */
  aiAvgDistanceToFood: number;
  /** AI 改变方向的次数占总 tick 的比例，过高说明抖动/绕圈 */
  aiTurnRate: number;
  /** 比分曲线采样（最多 8 个点），让大模型看到领先/落后是在哪个阶段发生的 */
  scoreCurve: { tick: number; player: number; ai: number }[];
  /** 是否属于"开局没多久就自杀"，是判定新手行为与回退的关键信号 */
  earlyDeath: boolean;
  /** 死亡那一 tick 是否还有别的安全方向可选：区分「被围死」和「自己走进死角」 */
  avoidableDeath: boolean;
  deathContext: {
    safeDirections: number;
    bestArea: number;
    headOnEdge: boolean;
  } | null;
  /** 每颗食物生成时双方的距离差与最终归属，区分「跑不过」和「路线烂」 */
  foodContests: { aiDist: number; playerDist: number; winner: "ai" | "player" }[];
  /** AI 平均可达空间占网格的比例 */
  spaceAvgRatio: number;
  /** 远离食物又没换来空间的转向次数 */
  wastedTurns: number;
}

function classifyDeath(prev: GameState, next: GameState, side: "player" | "ai"): DeathCause {
  const snake = next[side];
  if (snake.alive) return "survived";

  const head = snake.body[0];
  if (!isWithinBounds(head, next.gridSize)) return "wall";
  if (snake.body.slice(1).some((seg) => isSamePosition(seg, head))) return "self";
  const other = side === "ai" ? next.player : next.ai;
  if (other.body.some((seg) => isSamePosition(seg, head))) return "opponent";
  // 双方同 tick 交换头部位置的擦肩相撞
  if (isSamePosition(head, prev[side === "ai" ? "player" : "ai"].body[0])) return "opponent";
  return "opponent";
}

/** 早死判定阈值：不到全场三分之一就出局，基本可以确定是策略问题而非运气 */
const EARLY_DEATH_RATIO = 1 / 3;

/**
 * 从回放记录里提炼出结构化摘要——这才是真正发给大模型看的内容。
 * 原始坐标流对大模型既贵又没用，它需要的是"怎么死的、有没有在有效进食、
 * 是不是在原地打转"这类可以直接映射到基因调整的结论。
 */
export function deriveMatchSummary(record: MatchRecord): MatchSummary {
  const states = replayMatch(record);
  const totalTicks = record.ticks.length;
  const last = states[states.length - 1];
  const beforeLast = states[Math.max(0, states.length - 2)];

  const stateCounts = new Map<AIInternalState, number>();
  let maxStreak = 0;
  let currentStreak = 0;
  let distanceSum = 0;
  let turns = 0;
  let spaceSum = 0;
  let wastedTurns = 0;
  const foodContests: MatchSummary["foodContests"] = [];
  let contestAiDist = manhattanDistance(states[0].ai.body[0], states[0].food);
  let contestPlayerDist = manhattanDistance(states[0].player.body[0], states[0].food);

  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1];
    const curr = states[i];

    stateCounts.set(curr.aiInternalState, (stateCounts.get(curr.aiInternalState) ?? 0) + 1);

    if (curr.ai.score > prev.ai.score) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
      foodContests.push({
        aiDist: contestAiDist,
        playerDist: contestPlayerDist,
        winner: "ai",
      });
      contestAiDist = manhattanDistance(curr.ai.body[0], curr.food);
      contestPlayerDist = manhattanDistance(curr.player.body[0], curr.food);
    } else if (curr.player.score > prev.player.score) {
      currentStreak = 0;
      foodContests.push({
        aiDist: contestAiDist,
        playerDist: contestPlayerDist,
        winner: "player",
      });
      contestAiDist = manhattanDistance(curr.ai.body[0], curr.food);
      contestPlayerDist = manhattanDistance(curr.player.body[0], curr.food);
    }

    const head = prev.ai.body[0];
    distanceSum += manhattanDistance(head, prev.food);
    const obstacles = buildOccupiedSet(prev.ai.body.slice(0, -1), prev.player.body);
    const area = bfsReachableArea(head, prev.gridSize, obstacles);
    spaceSum += area / (prev.gridSize * prev.gridSize);

    if (curr.ai.direction !== prev.ai.direction) {
      turns += 1;
      const movedAway =
        manhattanDistance(curr.ai.body[0], prev.food) > manhattanDistance(head, prev.food);
      const nextObstacles = buildOccupiedSet(curr.ai.body.slice(0, -1), curr.player.body);
      const nextArea = bfsReachableArea(curr.ai.body[0], curr.gridSize, nextObstacles);
      if (movedAway && nextArea <= area) wastedTurns += 1;
    }
  }

  const aiStateRatio: Partial<Record<AIInternalState, number>> = {};
  for (const [key, count] of stateCounts) {
    aiStateRatio[key] = Number((count / Math.max(1, totalTicks)).toFixed(2));
  }

  const sampleCount = Math.min(8, totalTicks);
  const scoreCurve = Array.from({ length: sampleCount }, (_, i) => {
    const index = Math.round(((i + 1) / sampleCount) * totalTicks);
    const snapshot = states[Math.min(index, states.length - 1)];
    return { tick: index, player: snapshot.player.score, ai: snapshot.ai.score };
  });

  const maxTicks = Math.ceil((states[0].timeRemainingMs || 1) / record.tickMs);
  const aiDeath = classifyDeath(beforeLast, last, "ai");

  let deathContext: MatchSummary["deathContext"] = null;
  let avoidableDeath = false;
  if (aiDeath !== "survived" && states.length >= 2) {
    const dying = beforeLast;
    const head = dying.ai.body[0];
    const obstacles = buildOccupiedSet(dying.ai.body.slice(0, -1), dying.player.body);
    const dirs = ALL_DIRECTIONS.filter(
      (dir) => !isOpposite(dir, dying.ai.direction) || dying.ai.body.length === 1
    );
    let safe = 0;
    let bestArea = 0;
    for (const dir of dirs) {
      const next = addPosition(head, directionVector(dir));
      if (!isWithinBounds(next, dying.gridSize)) continue;
      if (obstacles.has(`${next.x},${next.y}`)) continue;
      safe += 1;
      bestArea = Math.max(bestArea, bfsReachableArea(next, dying.gridSize, obstacles));
    }
    const headOnEdge =
      head.x === 0 || head.y === 0 || head.x === dying.gridSize - 1 || head.y === dying.gridSize - 1;
    deathContext = { safeDirections: safe, bestArea, headOnEdge };
    avoidableDeath = safe > 0;
  }

  return {
    result: record.result,
    durationTicks: totalTicks,
    durationSec: Number(((totalTicks * record.tickMs) / 1000).toFixed(1)),
    playerScore: record.playerScore,
    aiScore: record.aiScore,
    aiDeath,
    playerDeath: classifyDeath(beforeLast, last, "player"),
    aiMaxStreak: maxStreak,
    aiDeadendTicks: stateCounts.get("deadend") ?? 0,
    aiStateRatio,
    aiAvgDistanceToFood: Number((distanceSum / Math.max(1, totalTicks)).toFixed(1)),
    aiTurnRate: Number((turns / Math.max(1, totalTicks)).toFixed(2)),
    scoreCurve,
    earlyDeath: aiDeath !== "survived" && totalTicks < maxTicks * EARLY_DEATH_RATIO,
    avoidableDeath,
    deathContext,
    foodContests: foodContests.slice(-8),
    spaceAvgRatio: Number((spaceSum / Math.max(1, totalTicks)).toFixed(3)),
    wastedTurns,
  };
}

/** 适应度的五项构成。拆开是为了回测复盘能说清「总分掉了，到底掉在哪一项」。 */
export interface FitnessTerms {
  score: number;
  diff: number;
  survival: number;
  outcome: number;
  earlyDeathPenalty: number;
}

export function fitnessTerms(summary: MatchSummary): FitnessTerms {
  const survivalRatio = Math.min(1, (summary.durationSec * 1000) / GAME_DURATION_MS);
  return {
    score: summary.aiScore,
    diff: (summary.aiScore - summary.playerScore) * 0.5,
    survival: survivalRatio * 20,
    outcome: summary.result === "ai" ? 8 : summary.result === "draw" ? 2 : 0,
    earlyDeathPenalty: summary.earlyDeath ? 8 : 0,
  };
}

export function sumFitnessTerms(terms: FitnessTerms): number {
  return Number(
    (
      terms.score +
      terms.diff +
      terms.survival +
      terms.outcome -
      terms.earlyDeathPenalty
    ).toFixed(3)
  );
}

/**
 * 适应度：沙盒回测里用来判定"这次进化提案到底有没有变强"的唯一标尺。
 *
 * 主项是自己的绝对得分而非净胜分：净胜分做主项会出现"开局立刻自杀反而比
 * 打满全场输几分得分高"的反向激励，那会把进化引向摆烂。净胜分只作为次项参与，
 * 再叠加存活占比、胜负奖励与开局自杀的重罚。
 */
export function computeFitness(summary: MatchSummary): number {
  return sumFitnessTerms(fitnessTerms(summary));
}
