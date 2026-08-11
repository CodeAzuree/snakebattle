import {
  ALL_DIRECTIONS,
  addPosition,
  bfsFirstStepDirection,
  bfsPathLength,
  bfsReachableArea,
  buildOccupiedSet,
  directionVector,
  isOpposite,
  isWithinBounds,
  manhattanDistance,
  positionKey,
} from "../board";
import type { AIDecisionContext, AIDecisionResult, Direction } from "../types";

/** 移动后可达空间低于自身长度加此余量，视为有自堵风险（与老谋保持一致，不为了压制而牺牲基本安全） */
const SAFETY_MARGIN = 2;
/** 触发"压制模式"评估的距离阈值：玩家离食物够近、自己也够近，才值得考虑封锁 */
const SUPPRESSION_RANGE = 5;
/** 为了封锁，最多允许自己在"最优取食路径"基础上多绕的步数，超过则不值得 */
const MAX_DETOUR_COST = 2;

/**
 * 蛇王（Hard）：在老谋安全寻路的基础上叠加空间控制评分。
 * 默认行为与老谋一致（安全 BFS 寻路），当玩家逼近食物且自己有能力
 * 以较小代价截断玩家路线时，才切换为"压制模式"，避免为了嘲讽而牺牲效率。
 * 对应 docs/DESIGN.md 3.4 节。
 */
export function decideAdvanced(ctx: AIDecisionContext): AIDecisionResult {
  const { self, opponent, food, gridSize } = ctx;
  const head = self.body[0];
  const opponentHead = opponent.body[0];

  const candidates = ALL_DIRECTIONS.filter(
    (dir) => !isOpposite(dir, self.direction) || self.body.length === 1
  );

  const selfBodyObstacles = buildOccupiedSet(self.body.slice(0, -1));
  const opponentObstacles = buildOccupiedSet(opponent.body);
  const staticObstacles = buildOccupiedSet(self.body.slice(0, -1), opponent.body);

  const isImmediatelySafe = (dir: Direction) => {
    const next = addPosition(head, directionVector(dir));
    if (!isWithinBounds(next, gridSize)) return false;
    if (selfBodyObstacles.has(positionKey(next))) return false;
    if (opponentObstacles.has(positionKey(next))) return false;
    return true;
  };

  const safeCandidates = candidates.filter(isImmediatelySafe);

  if (safeCandidates.length === 0) {
    const fallback = candidates[0] ?? self.direction;
    return { direction: fallback, internalState: "deadend" };
  }

  const spaciousCandidates = safeCandidates.filter((dir) => {
    const next = addPosition(head, directionVector(dir));
    const area = bfsReachableArea(next, gridSize, staticObstacles);
    return area >= self.body.length + SAFETY_MARGIN;
  });

  const pool = spaciousCandidates.length > 0 ? spaciousCandidates : safeCandidates;

  // 基准方案：与老谋一致的安全寻路结果，保证蛇王的下限不低于老谋
  const bestStep = bfsFirstStepDirection(head, food, gridSize, staticObstacles);
  const baseline: Direction =
    bestStep && pool.includes(bestStep)
      ? bestStep
      : [...pool].sort((a, b) => {
          const areaA = bfsReachableArea(addPosition(head, directionVector(a)), gridSize, staticObstacles);
          const areaB = bfsReachableArea(addPosition(head, directionVector(b)), gridSize, staticObstacles);
          return areaB - areaA;
        })[0];
  const baselineIsHunting = !!bestStep && pool.includes(bestStep);
  const baselineDistanceToFood = manhattanDistance(
    addPosition(head, directionVector(baseline)),
    food
  );

  const opponentToFood = manhattanDistance(opponentHead, food);
  const selfToOpponent = manhattanDistance(head, opponentHead);
  const worthConsideringSuppression =
    opponentToFood <= SUPPRESSION_RANGE && selfToOpponent <= SUPPRESSION_RANGE + 1;

  if (worthConsideringSuppression) {
    // 只在"代价可控"的候选方向中挑选压制效果最好的一个，
    // 避免为了封锁玩家而让自己绕远路、平白丢掉取食效率。
    const affordableCandidates = pool.filter((dir) => {
      const nextHead = addPosition(head, directionVector(dir));
      const distanceToFood = manhattanDistance(nextHead, food);
      return distanceToFood <= baselineDistanceToFood + MAX_DETOUR_COST;
    });

    let bestDir: Direction | null = null;
    let bestObstruction = -1;

    for (const dir of affordableCandidates) {
      const nextHead = addPosition(head, directionVector(dir));
      const hypotheticalObstacles = buildOccupiedSet(
        self.body.slice(0, -1),
        opponent.body,
        [nextHead]
      );
      const oppPath = bfsPathLength(opponentHead, food, gridSize, hypotheticalObstacles);
      const obstructionScore = oppPath === null ? Number.POSITIVE_INFINITY : oppPath;
      if (obstructionScore > bestObstruction) {
        bestObstruction = obstructionScore;
        bestDir = dir;
      }
    }

    // 只有明显优于"什么都不做"（即比基准方案更能拖慢玩家）才真正切换到压制模式
    const baselineHypotheticalObstacles = buildOccupiedSet(self.body.slice(0, -1), opponent.body, [
      addPosition(head, directionVector(baseline)),
    ]);
    const baselineObstruction =
      bfsPathLength(opponentHead, food, gridSize, baselineHypotheticalObstacles) ??
      Number.POSITIVE_INFINITY;

    if (bestDir && bestObstruction > baselineObstruction) {
      return { direction: bestDir, internalState: "blocking" };
    }
  }

  return { direction: baseline, internalState: baselineIsHunting ? "hunting" : "escaping" };
}
