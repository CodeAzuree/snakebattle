import {
  ALL_DIRECTIONS,
  addPosition,
  bfsPathLength,
  bfsReachableArea,
  directionVector,
  isWithinBounds,
  manhattanDistance,
  positionKey,
} from "../../board";
import type { Direction, Position } from "../../types";
import { FEATURE_KEYS, type FeatureKey } from "./spec";

export interface FeatureWorld {
  gridSize: number;
  head: Position;
  food: Position;
  tail: Position;
  opponentHead: Position;
  currentDirection: Direction;
  selfLength: number;
  obstacles: Set<string>;
}

export type FeatureMap = Record<FeatureKey, number>;

/**
 * 懒计算特征：只在第一次被读取时才跑 BFS。
 *
 * 4 个候选方向 × 每 tick × 整局 667 tick，如果每个特征都 eagerly 算一遍，
 * 回测会慢一个数量级。权重为 0、表达式没引用的特征永远不会被求值。
 */
export function createFeatureAccessor(
  world: FeatureWorld,
  next: Position,
  dir: Direction
): FeatureMap {
  const cache: Partial<FeatureMap> = {};
  const maxDistance = world.gridSize * 2;

  const compute = (key: FeatureKey): number => {
    switch (key) {
      case "foodProximity": {
        const route = bfsPathLength(next, world.food, world.gridSize, world.obstacles);
        const length = route ?? maxDistance;
        return 1 - Math.min(length, maxDistance) / maxDistance;
      }
      case "reachableArea": {
        const comfortable = Math.max(4, world.selfLength * 2);
        return Math.min(1, bfsReachableArea(next, world.gridSize, world.obstacles) / comfortable);
      }
      case "tailReachable": {
        const toTail = bfsPathLength(next, world.tail, world.gridSize, world.obstacles);
        return toTail === null ? 0 : 1;
      }
      case "corridorWidth": {
        let open = 0;
        for (const around of ALL_DIRECTIONS) {
          const cell = addPosition(next, directionVector(around));
          if (!isWithinBounds(cell, world.gridSize)) continue;
          if (world.obstacles.has(positionKey(cell))) continue;
          open += 1;
        }
        return open / 4;
      }
      case "opponentBlock": {
        const hypothetical = new Set(world.obstacles);
        hypothetical.add(positionKey(next));
        const oppPath = bfsPathLength(
          world.opponentHead,
          world.food,
          world.gridSize,
          hypothetical
        );
        return (oppPath === null ? maxDistance : Math.min(oppPath, maxDistance)) / maxDistance;
      }
      case "opponentDistance":
        return Math.min(1, manhattanDistance(next, world.opponentHead) / maxDistance);
      case "wallDistance": {
        const dist = Math.min(
          next.x,
          next.y,
          world.gridSize - 1 - next.x,
          world.gridSize - 1 - next.y
        );
        return dist / Math.max(1, world.gridSize / 2);
      }
      case "foodRace": {
        const selfDist = manhattanDistance(next, world.food);
        const oppDist = manhattanDistance(world.opponentHead, world.food);
        const delta = oppDist - selfDist;
        return Math.max(-1, Math.min(1, delta / 8));
      }
      case "directionInertia":
        return dir === world.currentDirection ? 1 : 0;
    }
  };

  const accessor = {} as FeatureMap;
  for (const key of FEATURE_KEYS) {
    Object.defineProperty(accessor, key, {
      enumerable: true,
      get() {
        if (cache[key] === undefined) cache[key] = compute(key);
        return cache[key] as number;
      },
    });
  }
  return accessor;
}

export function weightedScore(
  features: FeatureMap,
  weights: Record<FeatureKey, number>
): number {
  let score = 0;
  for (const key of FEATURE_KEYS) {
    const weight = weights[key];
    if (weight === 0) continue;
    score += weight * features[key];
  }
  return score;
}

/** 表达式或权重实际会读到的特征集合，用于决定要不要启用昂贵的 BFS */
export function neededFeatures(
  weights: Record<FeatureKey, number>,
  expression: string | null
): Set<FeatureKey> {
  const needed = new Set<FeatureKey>();
  for (const key of FEATURE_KEYS) {
    if (weights[key] !== 0) needed.add(key);
  }
  if (expression) {
    for (const key of FEATURE_KEYS) {
      if (expression.includes(key)) needed.add(key);
    }
  }
  return needed;
}
