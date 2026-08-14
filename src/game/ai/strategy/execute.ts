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
} from "../../board";
import type { AIDecisionContext, AIDecisionResult, AIInternalState, Direction } from "../../types";
import { compileScoreExpression } from "./expression";
import { createFeatureAccessor, weightedScore } from "./features";
import { resolveActiveWeights } from "./rules";
import { type PathMode, type StrategySpec } from "./spec";

function pathHint(
  mode: PathMode,
  ctx: AIDecisionContext,
  obstacles: Set<string>
): Direction | null {
  const head = ctx.self.body[0];
  const tail = ctx.self.body[ctx.self.body.length - 1];

  switch (mode) {
    case "greedy": {
      const candidates = ALL_DIRECTIONS.filter(
        (dir) => !isOpposite(dir, ctx.self.direction) || ctx.self.body.length === 1
      );
      return [...candidates].sort(
        (a, b) =>
          manhattanDistance(addPosition(head, directionVector(a)), ctx.food) -
          manhattanDistance(addPosition(head, directionVector(b)), ctx.food)
      )[0] ?? null;
    }
    case "bfsShortest":
      return bfsFirstStepDirection(head, ctx.food, ctx.gridSize, obstacles);
    case "bfsSafest": {
      const candidates = ALL_DIRECTIONS.filter(
        (dir) => !isOpposite(dir, ctx.self.direction) || ctx.self.body.length === 1
      );
      let best: Direction | null = null;
      let bestArea = -1;
      let bestFood = Number.POSITIVE_INFINITY;
      for (const dir of candidates) {
        const next = addPosition(head, directionVector(dir));
        if (!isWithinBounds(next, ctx.gridSize)) continue;
        if (obstacles.has(positionKey(next))) continue;
        const area = bfsReachableArea(next, ctx.gridSize, obstacles);
        const foodDist = manhattanDistance(next, ctx.food);
        if (area > bestArea || (area === bestArea && foodDist < bestFood)) {
          best = dir;
          bestArea = area;
          bestFood = foodDist;
        }
      }
      return best;
    }
    case "spaceFill": {
      const candidates = ALL_DIRECTIONS.filter(
        (dir) => !isOpposite(dir, ctx.self.direction) || ctx.self.body.length === 1
      );
      return [...candidates].sort(
        (a, b) =>
          bfsReachableArea(addPosition(head, directionVector(b)), ctx.gridSize, obstacles) -
          bfsReachableArea(addPosition(head, directionVector(a)), ctx.gridSize, obstacles)
      )[0] ?? null;
    }
    case "tailChase":
      return bfsFirstStepDirection(head, tail, ctx.gridSize, obstacles);
  }
}

function inferInternalState(
  dir: Direction,
  pathHintDir: Direction | null,
  action: ReturnType<typeof resolveActiveWeights>["action"],
  deadend: boolean
): AIInternalState {
  if (deadend) return "deadend";
  if (action === "blockOpponent") return "blocking";
  if (action === "surviveFirst" || action === "retreatToOpenSpace" || action === "chaseTail") {
    return "escaping";
  }
  if (pathHintDir && dir === pathHintDir) return "hunting";
  if (action === "chaseFood") return "hunting";
  return "escaping";
}

/**
 * 自学习 AI 的决策函数：行为完全由策略规格决定。
 *
 * 流程：失误掷骰 → 安全过滤（逐级放宽）→ 规则匹配叠权重 → 特征打分取 argmax。
 * rng 可注入，用于沙盒回测时让同一规格的多次试跑可复现。
 */
export function decideStrategy(
  ctx: AIDecisionContext,
  spec: StrategySpec,
  rng: () => number = Math.random
): AIDecisionResult {
  const { self, opponent, food, gridSize } = ctx;
  const head = self.body[0];
  const tail = self.body[self.body.length - 1];

  const candidates = ALL_DIRECTIONS.filter(
    (dir) => !isOpposite(dir, self.direction) || self.body.length === 1
  );

  if (spec.mistakeProbability > 0 && rng() < spec.mistakeProbability) {
    const pick = candidates[Math.floor(rng() * candidates.length)] ?? self.direction;
    return { direction: pick, internalState: "wandering" };
  }

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

  let pool = spec.safety.avoidImmediateDeath ? candidates.filter(isImmediatelySafe) : candidates;

  if (spec.safety.requireEscapeRoute && pool.length > 0) {
    const spacious = pool.filter((dir) => {
      const next = addPosition(head, directionVector(dir));
      const area = bfsReachableArea(next, gridSize, staticObstacles);
      return area >= self.body.length + spec.safety.minAreaMargin;
    });
    if (spacious.length > 0) pool = spacious;
  }

  if (spec.safety.tailSafety && pool.length > 0) {
    const withTail = pool.filter((dir) => {
      const next = addPosition(head, directionVector(dir));
      return bfsPathLength(next, tail, gridSize, staticObstacles) !== null;
    });
    if (withTail.length > 0) pool = withTail;
  }

  if (pool.length === 0) {
    const fallback = spec.safety.avoidImmediateDeath
      ? [...candidates].sort(
          (a, b) =>
            bfsReachableArea(addPosition(head, directionVector(b)), gridSize, staticObstacles) -
            bfsReachableArea(addPosition(head, directionVector(a)), gridSize, staticObstacles)
        )[0]
      : pathHint(spec.pathMode, ctx, staticObstacles);
    return { direction: fallback ?? self.direction, internalState: "deadend" };
  }

  const hint = pathHint(spec.pathMode, ctx, staticObstacles);
  const { weights, action } = resolveActiveWeights(spec.rules, spec.weights, ctx);
  const expression = compileScoreExpression(spec.scoreExpression);

  let bestDir: Direction = pool[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const dir of pool) {
    const next = addPosition(head, directionVector(dir));
    const features = createFeatureAccessor(
      {
        gridSize,
        head,
        food,
        tail,
        opponentHead: opponent.body[0],
        currentDirection: self.direction,
        selfLength: self.body.length,
        obstacles: staticObstacles,
      },
      next,
      dir
    );

    let score = expression ? expression(features) : weightedScore(features, weights);
    // 主寻路模式给出的方向加一个小偏置，避免权重全 0 时完全随机
    if (hint && dir === hint) score += 0.15;
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  return {
    direction: bestDir,
    internalState: inferInternalState(bestDir, hint, action, false),
  };
}
