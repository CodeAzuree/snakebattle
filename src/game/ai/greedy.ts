import {
  ALL_DIRECTIONS,
  addPosition,
  buildOccupiedSet,
  directionVector,
  isOpposite,
  isWithinBounds,
  manhattanDistance,
  positionKey,
} from "../board";
import type { AIDecisionContext, AIDecisionResult, Direction } from "../types";

const MISTAKE_PROBABILITY = 0.2;

/**
 * 小贪（Easy）：贪心朝食物移动，不做深层规划；
 * 约 20% 概率忽略安全检查，制造"呆萌"式的失误。
 * 对应 docs/DESIGN.md 3.4 节。
 */
export function decideGreedy(ctx: AIDecisionContext): AIDecisionResult {
  const { self, opponent, food, gridSize } = ctx;
  const head = self.body[0];

  const candidates = ALL_DIRECTIONS.filter(
    (dir) => !isOpposite(dir, self.direction) || self.body.length === 1
  );

  const selfBodyObstacles = buildOccupiedSet(self.body.slice(0, -1));
  const opponentObstacles = buildOccupiedSet(opponent.body);

  const isSafe = (dir: Direction) => {
    const next = addPosition(head, directionVector(dir));
    if (!isWithinBounds(next, gridSize)) return false;
    if (selfBodyObstacles.has(positionKey(next))) return false;
    if (opponentObstacles.has(positionKey(next))) return false;
    return true;
  };

  const byDistanceToFood = (dirs: Direction[]) =>
    [...dirs].sort((a, b) => {
      const da = manhattanDistance(addPosition(head, directionVector(a)), food);
      const db = manhattanDistance(addPosition(head, directionVector(b)), food);
      return da - db;
    });

  const safeCandidates = candidates.filter(isSafe);

  if (safeCandidates.length === 0) {
    // 无路可走，被迫接受结果
    const fallback = byDistanceToFood(candidates)[0] ?? self.direction;
    return { direction: fallback, internalState: "deadend" };
  }

  const isMistake = Math.random() < MISTAKE_PROBABILITY;
  if (isMistake) {
    const randomPick =
      candidates[Math.floor(Math.random() * candidates.length)] ?? self.direction;
    return { direction: randomPick, internalState: "wandering" };
  }

  const sortedSafe = byDistanceToFood(safeCandidates);
  const sortedAll = byDistanceToFood(candidates);
  const chosen = sortedSafe[0];

  // 如果不考虑安全性时最优方向本身就是安全的，说明是顺畅地追食物；
  // 否则说明是为了绕开风险而牺牲了一部分"效率"，属于危险规避。
  const internalState =
    chosen === sortedAll[0] ? "hunting" : "escaping";

  return { direction: chosen, internalState };
}
