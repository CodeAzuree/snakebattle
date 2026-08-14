import type { Direction, Position } from "./types";

export const ALL_DIRECTIONS: Direction[] = ["UP", "DOWN", "LEFT", "RIGHT"];

export function directionVector(direction: Direction): Position {
  switch (direction) {
    case "UP":
      return { x: 0, y: -1 };
    case "DOWN":
      return { x: 0, y: 1 };
    case "LEFT":
      return { x: -1, y: 0 };
    case "RIGHT":
      return { x: 1, y: 0 };
  }
}

export function isOpposite(a: Direction, b: Direction): boolean {
  return (
    (a === "UP" && b === "DOWN") ||
    (a === "DOWN" && b === "UP") ||
    (a === "LEFT" && b === "RIGHT") ||
    (a === "RIGHT" && b === "LEFT")
  );
}

export function addPosition(a: Position, b: Position): Position {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function isSamePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isWithinBounds(pos: Position, gridSize: number): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < gridSize && pos.y < gridSize;
}

export function positionKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function buildOccupiedSet(...bodies: Position[][]): Set<string> {
  const set = new Set<string>();
  for (const body of bodies) {
    for (const pos of body) {
      set.add(positionKey(pos));
    }
  }
  return set;
}

/**
 * 在网格中随机生成一个不与给定障碍物重叠的位置。
 * 网格为 20x20，穷举候选后随机挑选，保证不会死循环。
 */
export function randomEmptyPosition(
  gridSize: number,
  occupied: Set<string>,
  rng: () => number = Math.random
): Position {
  const candidates: Position[] = [];
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const pos = { x, y };
      if (!occupied.has(positionKey(pos))) {
        candidates.push(pos);
      }
    }
  }
  if (candidates.length === 0) {
    return { x: 0, y: 0 };
  }
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * 广度优先搜索：从 start 出发，寻找到 target 的最短路径长度（步数）。
 * 返回 null 表示不可达。obstacles 为占用格子集合（key 形如 "x,y"）。
 */
export function bfsPathLength(
  start: Position,
  target: Position,
  gridSize: number,
  obstacles: Set<string>
): number | null {
  if (isSamePosition(start, target)) return 0;

  const visited = new Set<string>([positionKey(start)]);
  let frontier: Position[] = [start];
  let steps = 0;

  while (frontier.length > 0) {
    steps += 1;
    const next: Position[] = [];
    for (const pos of frontier) {
      for (const dir of ALL_DIRECTIONS) {
        const candidate = addPosition(pos, directionVector(dir));
        const key = positionKey(candidate);
        if (!isWithinBounds(candidate, gridSize)) continue;
        if (visited.has(key)) continue;
        if (obstacles.has(key)) continue;
        if (isSamePosition(candidate, target)) return steps;
        visited.add(key);
        next.push(candidate);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * 广度优先搜索：计算从 start 出发（不含 start 自身）可达的格子数量，
 * 用于评估某个方向是否会导致蛇被困在狭小空间（自堵风险）。
 */
export function bfsReachableArea(
  start: Position,
  gridSize: number,
  obstacles: Set<string>
): number {
  const visited = new Set<string>([positionKey(start)]);
  let frontier: Position[] = [start];
  let count = 0;

  while (frontier.length > 0) {
    const next: Position[] = [];
    for (const pos of frontier) {
      for (const dir of ALL_DIRECTIONS) {
        const candidate = addPosition(pos, directionVector(dir));
        const key = positionKey(candidate);
        if (!isWithinBounds(candidate, gridSize)) continue;
        if (visited.has(key)) continue;
        if (obstacles.has(key)) continue;
        visited.add(key);
        count += 1;
        next.push(candidate);
      }
    }
    frontier = next;
  }
  return count;
}

/**
 * 从 start 到 target 的 BFS 最短路径上的第一步方向。
 * 用于让 AI 沿着已求得的最短路径前进一格。
 */
export function bfsFirstStepDirection(
  start: Position,
  target: Position,
  gridSize: number,
  obstacles: Set<string>
): Direction | null {
  if (isSamePosition(start, target)) return null;

  const visited = new Map<string, Direction>();
  visited.set(positionKey(start), "UP"); // 占位，start 本身不会被回溯
  let frontier: { pos: Position; firstStep: Direction }[] = ALL_DIRECTIONS.map(
    (dir) => ({ pos: addPosition(start, directionVector(dir)), firstStep: dir })
  ).filter(({ pos }) => isWithinBounds(pos, gridSize) && !obstacles.has(positionKey(pos)));

  for (const { pos, firstStep } of frontier) {
    visited.set(positionKey(pos), firstStep);
    if (isSamePosition(pos, target)) return firstStep;
  }

  while (frontier.length > 0) {
    const next: { pos: Position; firstStep: Direction }[] = [];
    for (const { pos, firstStep } of frontier) {
      for (const dir of ALL_DIRECTIONS) {
        const candidate = addPosition(pos, directionVector(dir));
        const key = positionKey(candidate);
        if (!isWithinBounds(candidate, gridSize)) continue;
        if (visited.has(key)) continue;
        if (obstacles.has(key)) continue;
        if (isSamePosition(candidate, target)) return firstStep;
        visited.set(key, firstStep);
        next.push({ pos: candidate, firstStep });
      }
    }
    frontier = next;
  }
  return null;
}
