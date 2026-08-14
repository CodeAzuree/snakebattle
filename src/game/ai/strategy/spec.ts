import { compileScoreExpression } from "./expression";import type { AdaptiveGenome } from "../adaptive";

/**
 * 「？？？」的可进化策略规格。
 *
 * 大模型不能写代码，但可以改这份声明式结构：换主寻路算法、重排规则、
 * 调特征权重、写一段受限打分表达式。执行层始终是确定性的 decideStrategy()，
 * 保证对局零延迟、可回测、导入他人存档没有代码执行风险。
 */
export type PathMode = "greedy" | "bfsShortest" | "bfsSafest" | "spaceFill" | "tailChase";

export const PATH_MODES: PathMode[] = [
  "greedy",
  "bfsShortest",
  "bfsSafest",
  "spaceFill",
  "tailChase",
];

export const PATH_MODE_LABELS: Record<PathMode, string> = {
  greedy: "贪心直冲",
  bfsShortest: "BFS 最短路",
  bfsSafest: "BFS 最安全",
  spaceFill: "空间填充",
  tailChase: "追尾巴",
};

export type FeatureKey =
  | "foodProximity"
  | "reachableArea"
  | "tailReachable"
  | "corridorWidth"
  | "opponentBlock"
  | "opponentDistance"
  | "wallDistance"
  | "foodRace"
  | "directionInertia";

export const FEATURE_KEYS: FeatureKey[] = [
  "foodProximity",
  "reachableArea",
  "tailReachable",
  "corridorWidth",
  "opponentBlock",
  "opponentDistance",
  "wallDistance",
  "foodRace",
  "directionInertia",
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  foodProximity: "离食物近",
  reachableArea: "可达空间",
  tailReachable: "能回到尾巴",
  corridorWidth: "通道宽度",
  opponentBlock: "封锁对手",
  opponentDistance: "与对手距离",
  wallDistance: "离墙距离",
  foodRace: "抢食领先",
  directionInertia: "保持原方向",
};

export type RuleConditionKind =
  | "always"
  | "areaBelow"
  | "lengthAbove"
  | "opponentCloserToFoodBy"
  | "scoreDeficitAbove"
  | "scoreLeadAbove"
  | "timeRemainingBelowSec"
  | "opponentHeadWithin";

export const RULE_CONDITION_KINDS: RuleConditionKind[] = [
  "always",
  "areaBelow",
  "lengthAbove",
  "opponentCloserToFoodBy",
  "scoreDeficitAbove",
  "scoreLeadAbove",
  "timeRemainingBelowSec",
  "opponentHeadWithin",
];

export interface RuleCondition {
  kind: RuleConditionKind;
  /** 条件阈值；always 时忽略 */
  value: number;
}

export type RuleAction =
  | "chaseFood"
  | "surviveFirst"
  | "chaseTail"
  | "blockOpponent"
  | "retreatToOpenSpace"
  | "hugWall";

export const RULE_ACTIONS: RuleAction[] = [
  "chaseFood",
  "surviveFirst",
  "chaseTail",
  "blockOpponent",
  "retreatToOpenSpace",
  "hugWall",
];

export const RULE_ACTION_LABELS: Record<RuleAction, string> = {
  chaseFood: "追食物",
  surviveFirst: "先求生",
  chaseTail: "追尾巴",
  blockOpponent: "封锁对手",
  retreatToOpenSpace: "退向空地",
  hugWall: "贴边走",
};

export interface StrategyRule {
  when: RuleCondition;
  then: RuleAction;
}

export interface SafetyModules {
  /** 是否过滤下一步会立刻撞墙/撞身的方向 */
  avoidImmediateDeath: boolean;
  /** 是否要求移动后可达空间不少于自身长度 + minAreaMargin */
  requireEscapeRoute: boolean;
  /** 是否要求移动后仍能回到自己的尾巴（防止把自己关死） */
  tailSafety: boolean;
  minAreaMargin: number;
}

export interface StrategySpec {
  specVersion: 1;
  pathMode: PathMode;
  weights: Record<FeatureKey, number>;
  /** 受限打分表达式；合法时优先于 weights。只允许特征名、数字、四则运算与 min/max/clamp/abs */
  scoreExpression: string | null;
  rules: StrategyRule[];
  safety: SafetyModules;
  mistakeProbability: number;
  notes: string;
}

export const WEIGHT_BOUNDS = { min: -2, max: 2 } as const;
export const MISTAKE_BOUNDS = { min: 0, max: 0.5 } as const;
export const AREA_MARGIN_BOUNDS = { min: 0, max: 6 } as const;
export const MAX_RULES = 5;
export const NOTES_MAX_LENGTH = 120;
export const EXPRESSION_MAX_LENGTH = 160;

export function zeroWeights(): Record<FeatureKey, number> {
  return {
    foodProximity: 0,
    reachableArea: 0,
    tailReachable: 0,
    corridorWidth: 0,
    opponentBlock: 0,
    opponentDistance: 0,
    wallDistance: 0,
    foodRace: 0,
    directionInertia: 0,
  };
}

/**
 * 出厂状态：纯新手。贪心直冲、不做任何安全检查、一半概率乱走。
 * 这是刻意的起点，成长曲线才有落差。
 */
export const NOVICE_SPEC: StrategySpec = {
  specVersion: 1,
  pathMode: "greedy",
  weights: { ...zeroWeights(), foodProximity: 1 },
  scoreExpression: null,
  rules: [],
  safety: {
    avoidImmediateDeath: false,
    requireEscapeRoute: false,
    tailSafety: false,
    minAreaMargin: 0,
  },
  mistakeProbability: 0.5,
  notes: "",
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function isPathMode(value: unknown): value is PathMode {
  return typeof value === "string" && (PATH_MODES as string[]).includes(value);
}

function isConditionKind(value: unknown): value is RuleConditionKind {
  return typeof value === "string" && (RULE_CONDITION_KINDS as string[]).includes(value);
}

function isRuleAction(value: unknown): value is RuleAction {
  return typeof value === "string" && (RULE_ACTIONS as string[]).includes(value);
}

function sanitizeWeights(
  raw: unknown,
  fallback: Record<FeatureKey, number>
): { weights: Record<FeatureKey, number>; adjusted: string[] } {
  const input = (raw ?? {}) as Record<string, unknown>;
  const weights = zeroWeights();
  const adjusted: string[] = [];
  for (const key of FEATURE_KEYS) {
    const source = input[key] ?? fallback[key];
    const clamped = clampNumber(source, fallback[key], WEIGHT_BOUNDS.min, WEIGHT_BOUNDS.max);
    if (typeof source !== "number" || !Number.isFinite(source) || source !== clamped) {
      adjusted.push(`weights.${key}`);
    }
    weights[key] = clamped;
  }
  return { weights, adjusted };
}

function sanitizeRules(raw: unknown): { rules: StrategyRule[]; adjusted: boolean } {
  if (!Array.isArray(raw)) return { rules: [], adjusted: raw !== undefined };
  const rules: StrategyRule[] = [];
  let adjusted = raw.length > MAX_RULES;
  for (const item of raw.slice(0, MAX_RULES)) {
    const entry = (item ?? {}) as { when?: unknown; then?: unknown };
    const whenRaw = (entry.when ?? {}) as { kind?: unknown; value?: unknown };
    if (!isConditionKind(whenRaw.kind) || !isRuleAction(entry.then)) {
      adjusted = true;
      continue;
    }
    rules.push({
      when: {
        kind: whenRaw.kind,
        value: clampNumber(whenRaw.value, 0, 0, 120),
      },
      then: entry.then,
    });
  }
  return { rules, adjusted };
}

export interface SanitizeSpecResult {
  spec: StrategySpec;
  adjustedFields: string[];
}

/**
 * 把任意输入收敛成一份合法策略规格。
 * 缺失字段回退到 fallback，越界数值 clamp，非法表达式整段丢弃。
 */
export function sanitizeStrategySpec(
  raw: unknown,
  fallback: StrategySpec = NOVICE_SPEC
): SanitizeSpecResult {
  const input = (raw ?? {}) as Partial<Record<keyof StrategySpec, unknown>>;
  const adjustedFields: string[] = [];

  const pathMode = isPathMode(input.pathMode) ? input.pathMode : fallback.pathMode;
  if (!isPathMode(input.pathMode)) adjustedFields.push("pathMode");

  const { weights, adjusted: weightAdjusted } = sanitizeWeights(input.weights, fallback.weights);
  adjustedFields.push(...weightAdjusted);

  let scoreExpression: string | null = fallback.scoreExpression;
  if (input.scoreExpression === null || input.scoreExpression === "") {
    scoreExpression = null;
  } else if (typeof input.scoreExpression === "string") {
    const trimmed = input.scoreExpression.trim().slice(0, EXPRESSION_MAX_LENGTH);
    scoreExpression = trimmed.length > 0 ? trimmed : null;
  } else if (input.scoreExpression !== undefined) {
    adjustedFields.push("scoreExpression");
  }

  const { rules, adjusted: rulesAdjusted } = sanitizeRules(input.rules);
  if (rulesAdjusted) adjustedFields.push("rules");

  const safetyRaw = (input.safety ?? {}) as Partial<Record<keyof SafetyModules, unknown>>;
  const safety: SafetyModules = {
    avoidImmediateDeath:
      typeof safetyRaw.avoidImmediateDeath === "boolean"
        ? safetyRaw.avoidImmediateDeath
        : fallback.safety.avoidImmediateDeath,
    requireEscapeRoute:
      typeof safetyRaw.requireEscapeRoute === "boolean"
        ? safetyRaw.requireEscapeRoute
        : fallback.safety.requireEscapeRoute,
    tailSafety:
      typeof safetyRaw.tailSafety === "boolean"
        ? safetyRaw.tailSafety
        : fallback.safety.tailSafety,
    minAreaMargin: clampNumber(
      safetyRaw.minAreaMargin,
      fallback.safety.minAreaMargin,
      AREA_MARGIN_BOUNDS.min,
      AREA_MARGIN_BOUNDS.max
    ),
  };
  if (typeof safetyRaw.avoidImmediateDeath !== "boolean" && input.safety !== undefined) {
    adjustedFields.push("safety.avoidImmediateDeath");
  }
  if (typeof safetyRaw.requireEscapeRoute !== "boolean" && input.safety !== undefined) {
    adjustedFields.push("safety.requireEscapeRoute");
  }
  if (typeof safetyRaw.tailSafety !== "boolean" && input.safety !== undefined) {
    adjustedFields.push("safety.tailSafety");
  }

  const mistakeProbability = clampNumber(
    input.mistakeProbability,
    fallback.mistakeProbability,
    MISTAKE_BOUNDS.min,
    MISTAKE_BOUNDS.max
  );
  if (
    typeof input.mistakeProbability !== "number" ||
    !Number.isFinite(input.mistakeProbability) ||
    input.mistakeProbability !== mistakeProbability
  ) {
    adjustedFields.push("mistakeProbability");
  }

  let notes = typeof input.notes === "string" ? input.notes.trim() : fallback.notes;
  if (notes.length > NOTES_MAX_LENGTH) {
    notes = notes.slice(0, NOTES_MAX_LENGTH);
    adjustedFields.push("notes");
  }

  return {
    spec: {
      specVersion: 1,
      pathMode,
      weights,
      scoreExpression,
      rules,
      safety,
      mistakeProbability,
      notes,
    },
    adjustedFields,
  };
}

/**
 * 把 v2 存档里的标量基因映射成一份策略规格。
 * 执行器换了，旧适应度不可比，调用方必须把 bestEvaluation 置空后重测。
 */
export function migrateGenomeToSpec(genome: AdaptiveGenome): StrategySpec {
  const weights = zeroWeights();
  weights.foodProximity = Math.max(0, genome.efficiencyWeight) * 1.5;
  weights.reachableArea = (1 - genome.efficiencyWeight) * 1.5;
  weights.opponentBlock = genome.blockingAggressiveness * 1.5;
  if (genome.riskAversion > 0) {
    weights.reachableArea = Math.max(weights.reachableArea, genome.riskAversion);
  }

  const pathMode: PathMode = genome.lookaheadEnabled ? "bfsShortest" : "greedy";
  const checksSafety = genome.safetyMargin >= 0;

  const rules: StrategyRule[] = [];
  if (genome.blockingAggressiveness >= 0.4) {
    rules.push({
      when: { kind: "opponentCloserToFoodBy", value: 0 },
      then: "blockOpponent",
    });
  }
  if (genome.riskAversion >= 0.5) {
    rules.push({
      when: { kind: "areaBelow", value: 8 },
      then: "surviveFirst",
    });
  }

  return sanitizeStrategySpec({
    specVersion: 1,
    pathMode,
    weights,
    scoreExpression: null,
    rules,
    safety: {
      avoidImmediateDeath: checksSafety,
      requireEscapeRoute: checksSafety && genome.lookaheadEnabled,
      tailSafety: false,
      minAreaMargin: checksSafety ? Math.max(0, genome.safetyMargin) : 0,
    },
    mistakeProbability: genome.mistakeProbability,
    notes: genome.strategyNotes,
  }).spec;
}

function weightDiff(
  before: Record<FeatureKey, number>,
  after: Record<FeatureKey, number>
): string[] {
  const changes: string[] = [];
  for (const key of FEATURE_KEYS) {
    if (Math.abs(before[key] - after[key]) > 0.01) {
      changes.push(`${FEATURE_LABELS[key]} ${before[key]} → ${after[key]}`);
    }
  }
  return changes;
}

function describeRule(rule: StrategyRule): string {
  const when =
    rule.when.kind === "always" ? "始终" : `${rule.when.kind}(${rule.when.value})`;
  return `${when} → ${RULE_ACTION_LABELS[rule.then]}`;
}

/** 人类可读的策略变化，用于成长播报。notes 不进列表。 */
export function describeSpecDiff(before: StrategySpec, after: StrategySpec): string[] {
  const changes: string[] = [];
  if (before.pathMode !== after.pathMode) {
    changes.push(
      `寻路 ${PATH_MODE_LABELS[before.pathMode]} → ${PATH_MODE_LABELS[after.pathMode]}`
    );
  }
  changes.push(...weightDiff(before.weights, after.weights));
  if ((before.scoreExpression ?? "") !== (after.scoreExpression ?? "")) {
    changes.push(
      after.scoreExpression ? `启用打分公式「${after.scoreExpression}」` : "关闭打分公式"
    );
  }
  const beforeRules = before.rules.map(describeRule).join("；");
  const afterRules = after.rules.map(describeRule).join("；");
  if (beforeRules !== afterRules) {
    changes.push(afterRules ? `规则：${afterRules}` : "清空规则表");
  }
  if (before.safety.avoidImmediateDeath !== after.safety.avoidImmediateDeath) {
    changes.push(`避死 ${before.safety.avoidImmediateDeath} → ${after.safety.avoidImmediateDeath}`);
  }
  if (before.safety.requireEscapeRoute !== after.safety.requireEscapeRoute) {
    changes.push(`逃生检查 ${before.safety.requireEscapeRoute} → ${after.safety.requireEscapeRoute}`);
  }
  if (before.safety.tailSafety !== after.safety.tailSafety) {
    changes.push(`尾巴安全 ${before.safety.tailSafety} → ${after.safety.tailSafety}`);
  }
  if (before.safety.minAreaMargin !== after.safety.minAreaMargin) {
    changes.push(`空间余量 ${before.safety.minAreaMargin} → ${after.safety.minAreaMargin}`);
  }
  if (before.mistakeProbability !== after.mistakeProbability) {
    changes.push(`失误率 ${before.mistakeProbability} → ${after.mistakeProbability}`);
  }
  return changes;
}

export function specsEqual(a: StrategySpec, b: StrategySpec): boolean {
  return describeSpecDiff(a, b).length === 0;
}
