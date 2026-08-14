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

/**
 * "策略基因"：第四位挑战者（自学习 AI）的全部可调参数。
 * 大模型每局复盘后只能提议修改这些数值，不能生成/执行代码——
 * 执行层始终是本文件里这个确定性函数，保证运行时无延迟、可回测、可回退。
 * 对应 docs/DESIGN.md 第五章。
 */
export interface AdaptiveGenome {
  /** 移动前的安全检查强度；-1 表示完全不检查（新手会直接撞墙），>=0 时还要求可达空间不少于自身长度加该余量 */
  safetyMargin: number;
  /** 是否启用 BFS：包括寻路取食与"移动后可达空间"的自堵检测 */
  lookaheadEnabled: boolean;
  /** 主动封锁玩家取食路线的倾向 */
  blockingAggressiveness: number;
  /** 随机失误概率 */
  mistakeProbability: number;
  /** 无路可走时的取舍：越高越倾向于"先活下来"，越低越倾向于"冲着食物去" */
  riskAversion: number;
  /** 取食效率与生存空间之间的权衡：1 表示只看谁离食物近，0 表示只看哪边空间大 */
  efficiencyWeight: number;
  /** 大模型写给下一轮自己看的自由备注，不参与决策执行，只用于保持思考连续性 */
  strategyNotes: string;
}

/** 各数值字段的安全区间：边界之内大模型完全自由，边界之外一律 clamp，避免非法值破坏决策执行 */
export const GENOME_BOUNDS = {
  safetyMargin: { min: -1, max: 6 },
  blockingAggressiveness: { min: 0, max: 1 },
  mistakeProbability: { min: 0, max: 0.5 },
  riskAversion: { min: 0, max: 1 },
  efficiencyWeight: { min: 0, max: 1 },
} as const;

export const STRATEGY_NOTES_MAX_LENGTH = 120;

/**
 * 出厂状态：纯新手。不做任何安全检查、一半概率乱走、只知道朝食物直冲，
 * 因此很容易撞墙或撞到自己——这是刻意的起点，成长曲线才有落差。
 */
export const NOVICE_GENOME: AdaptiveGenome = {
  safetyMargin: -1,
  lookaheadEnabled: false,
  blockingAggressiveness: 0,
  mistakeProbability: 0.5,
  riskAversion: 0,
  efficiencyWeight: 1,
  strategyNotes: "",
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

export interface SanitizeGenomeResult {
  genome: AdaptiveGenome;
  /** 被 clamp 或被替换成兜底值的字段名，用于写进反思日志，让下一轮大模型知道哪里越界了 */
  adjustedFields: string[];
}

/**
 * 把（可能来自大模型的）任意输入收敛成一份合法基因。
 * 缺失字段回退到 fallback，越界数值 clamp 到安全区间，并记录调整过哪些字段。
 */
export function sanitizeGenome(
  raw: unknown,
  fallback: AdaptiveGenome = NOVICE_GENOME
): SanitizeGenomeResult {
  const input = (raw ?? {}) as Partial<Record<keyof AdaptiveGenome, unknown>>;
  const adjustedFields: string[] = [];

  const numericField = (key: keyof typeof GENOME_BOUNDS) => {
    const { min, max } = GENOME_BOUNDS[key];
    const clamped = clampNumber(input[key], fallback[key], min, max);
    if (typeof input[key] !== "number" || !Number.isFinite(input[key]) || input[key] !== clamped) {
      adjustedFields.push(key);
    }
    return clamped;
  };

  const safetyMargin = numericField("safetyMargin");
  const blockingAggressiveness = numericField("blockingAggressiveness");
  const mistakeProbability = numericField("mistakeProbability");
  const riskAversion = numericField("riskAversion");
  const efficiencyWeight = numericField("efficiencyWeight");

  let lookaheadEnabled = fallback.lookaheadEnabled;
  if (typeof input.lookaheadEnabled === "boolean") {
    lookaheadEnabled = input.lookaheadEnabled;
  } else {
    adjustedFields.push("lookaheadEnabled");
  }

  let strategyNotes = typeof input.strategyNotes === "string" ? input.strategyNotes.trim() : "";
  if (strategyNotes.length > STRATEGY_NOTES_MAX_LENGTH) {
    strategyNotes = strategyNotes.slice(0, STRATEGY_NOTES_MAX_LENGTH);
    adjustedFields.push("strategyNotes");
  }

  return {
    genome: {
      safetyMargin,
      lookaheadEnabled,
      blockingAggressiveness,
      mistakeProbability,
      riskAversion,
      efficiencyWeight,
      strategyNotes,
    },
    adjustedFields,
  };
}

/** 触发"是否值得封锁玩家"评估的距离阈值，与蛇王保持一致 */
const SUPPRESSION_RANGE = 5;

/**
 * 自学习 AI 的决策函数：行为完全由基因数值决定。
 * 新手基因下退化成"无脑贪心 + 高失误率"，随着基因被调优会逐步长出
 * 安全检查、BFS 寻路、自堵规避、主动封锁等能力。
 *
 * `rng` 可注入，用于沙盒回测时让同一基因的多次试跑可复现、可比较。
 */
export function decideAdaptive(
  ctx: AIDecisionContext,
  genome: AdaptiveGenome,
  rng: () => number = Math.random
): AIDecisionResult {
  const { self, opponent, food, gridSize } = ctx;
  const head = self.body[0];
  const opponentHead = opponent.body[0];

  const candidates = ALL_DIRECTIONS.filter(
    (dir) => !isOpposite(dir, self.direction) || self.body.length === 1
  );

  // 随机失误：新手阶段占比很高，是它"看起来很菜"的主要来源
  if (genome.mistakeProbability > 0 && rng() < genome.mistakeProbability) {
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

  const distanceTo = (dir: Direction) =>
    manhattanDistance(addPosition(head, directionVector(dir)), food);

  const greedyBest = [...candidates].sort((a, b) => distanceTo(a) - distanceTo(b))[0];

  // safetyMargin < 0 代表"完全不看路"：直接按贪心方向走，撞墙也认
  const checksSafety = genome.safetyMargin >= 0;
  if (!checksSafety) {
    return { direction: greedyBest ?? self.direction, internalState: "hunting" };
  }

  const safeCandidates = candidates.filter(isImmediatelySafe);

  if (safeCandidates.length === 0) {
    // 无路可走：riskAversion 高就挑可达空间最大的方向搏一线生机，低就继续朝食物冲
    const fallback = genome.riskAversion >= 0.5
      ? [...candidates].sort(
          (a, b) =>
            bfsReachableArea(addPosition(head, directionVector(b)), gridSize, staticObstacles) -
            bfsReachableArea(addPosition(head, directionVector(a)), gridSize, staticObstacles)
        )[0]
      : greedyBest;
    return { direction: fallback ?? self.direction, internalState: "deadend" };
  }

  // 启用前瞻时，优先只在"移动后仍有足够可达空间"的方向里选，避免把自己关进小房间
  const spaciousCandidates = genome.lookaheadEnabled
    ? safeCandidates.filter((dir) => {
        const next = addPosition(head, directionVector(dir));
        const area = bfsReachableArea(next, gridSize, staticObstacles);
        return area >= self.body.length + genome.safetyMargin;
      })
    : safeCandidates;

  const pool = spaciousCandidates.length > 0 ? spaciousCandidates : safeCandidates;

  const pathStep = genome.lookaheadEnabled
    ? bfsFirstStepDirection(head, food, gridSize, staticObstacles)
    : null;

  const maxDistance = gridSize * 2;
  /** 可达空间达到该值即视为"足够宽敞"，超出部分不再加分，避免为了空旷而放弃吃豆 */
  const comfortableArea = Math.max(4, (self.body.length + Math.max(0, genome.safetyMargin)) * 2);

  // 是否值得考虑封锁：对手离食物够近、自己也够近，且基因里确实有攻击倾向
  const considerBlocking =
    genome.blockingAggressiveness > 0 &&
    manhattanDistance(opponentHead, food) <= SUPPRESSION_RANGE &&
    manhattanDistance(head, opponentHead) <= SUPPRESSION_RANGE + 1;

  // 封锁不能无限绕远：允许的额外绕行步数随攻击性上升，超出预算的方向拿不到封锁加分
  const detourBudget = Math.round(genome.blockingAggressiveness * 4);
  const nearestDistance = Math.min(...pool.map(distanceTo));

  const obstructionScore = (dir: Direction) => {
    const nextHead = addPosition(head, directionVector(dir));
    const hypothetical = buildOccupiedSet(self.body.slice(0, -1), opponent.body, [nextHead]);
    const oppPath = bfsPathLength(opponentHead, food, gridSize, hypothetical);
    return oppPath === null ? maxDistance : Math.min(oppPath, maxDistance);
  };

  let bestDir: Direction = pool[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestBlockingTerm = 0;

  for (const dir of pool) {
    const next = addPosition(head, directionVector(dir));

    // 效率项：离食物越近越好；启用前瞻时用 BFS 真实路径长度，否则用曼哈顿距离
    const routeLength = genome.lookaheadEnabled
      ? bfsPathLength(next, food, gridSize, staticObstacles) ?? maxDistance
      : manhattanDistance(next, food);
    const efficiencyTerm = 1 - Math.min(routeLength, maxDistance) / maxDistance;

    // 生存项：只惩罚"钻进小房间"，空间够用之后不再继续加分（不启用前瞻时不计算，省掉 BFS 开销）
    const spaceTerm = genome.lookaheadEnabled
      ? Math.min(1, bfsReachableArea(next, gridSize, staticObstacles) / comfortableArea)
      : 0;

    const blockingTerm =
      considerBlocking && distanceTo(dir) <= nearestDistance + detourBudget
        ? genome.blockingAggressiveness * (obstructionScore(dir) / maxDistance)
        : 0;

    const score =
      genome.efficiencyWeight * efficiencyTerm +
      (1 - genome.efficiencyWeight) * spaceTerm +
      blockingTerm;

    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
      bestBlockingTerm = blockingTerm;
    }
  }

  let internalState: AIDecisionResult["internalState"];
  if (considerBlocking && bestBlockingTerm > 0 && bestDir !== greedyBest) {
    internalState = "blocking";
  } else if (pathStep && bestDir === pathStep) {
    internalState = "hunting";
  } else if (bestDir === greedyBest) {
    internalState = "hunting";
  } else {
    // 为了安全/空间放弃了最短路，属于危险规避
    internalState = "escaping";
  }

  return { direction: bestDir, internalState };
}
