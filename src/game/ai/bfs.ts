import {
  ALL_DIRECTIONS,
  addPosition,
  bfsFirstStepDirection,
  bfsReachableArea,
  buildOccupiedSet,
  directionVector,
  isOpposite,
  isWithinBounds,
  manhattanDistance,
  positionKey,
} from "../board";
import type { AIDecisionContext, AIDecisionResult, Direction } from "../types";

/** 移动后可达空间低于自身长度加此余量，视为有自堵风险 */
const SAFETY_MARGIN = 2;
/** 判定"封锁路线"的接近距离阈值 */
const BLOCKING_PROXIMITY = 3;

/**
 * 老谋（Medium）：BFS 寻路取最近的安全食物，移动前检查自己是否会被困死。
 * 对应 docs/DESIGN.md 3.4 节。
 */
export function decideBfs(ctx: AIDecisionContext): AIDecisionResult {
  const { self, opponent, food, gridSize } = ctx;
  const head = self.body[0];

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

  const bestStep = bfsFirstStepDirection(head, food, gridSize, staticObstacles);

  let chosen: Direction;
  let internalState: AIDecisionResult["internalState"];

  if (bestStep && pool.includes(bestStep)) {
    chosen = bestStep;
    const nextHead = addPosition(head, directionVector(chosen));
    const selfDistanceAfterMove = manhattanDistance(nextHead, food);
    const opponentDistance = manhattanDistance(opponent.body[0], food);
    const nearOpponent = manhattanDistance(nextHead, opponent.body[0]) <= BLOCKING_PROXIMITY;

    internalState =
      nearOpponent && opponentDistance <= selfDistanceAfterMove + 1
        ? "blocking"
        : "hunting";
  } else {
    // 找不到通往食物的安全路径，优先选择可达空间最大的方向以求存活
    chosen = [...pool].sort((a, b) => {
      const areaA = bfsReachableArea(
        addPosition(head, directionVector(a)),
        gridSize,
        staticObstacles
      );
      const areaB = bfsReachableArea(
        addPosition(head, directionVector(b)),
        gridSize,
        staticObstacles
      );
      return areaB - areaA;
    })[0];
    internalState = "escaping";
  }

  return { direction: chosen, internalState };
}
