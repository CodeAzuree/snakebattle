export {
  NOVICE_SPEC,
  PATH_MODE_LABELS,
  PATH_MODES,
  FEATURE_KEYS,
  FEATURE_LABELS,
  RULE_ACTIONS,
  RULE_ACTION_LABELS,
  RULE_CONDITION_KINDS,
  MAX_RULES,
  describeSpecDiff,
  migrateGenomeToSpec,
  specsEqual,
  zeroWeights,
  type FeatureKey,
  type PathMode,
  type StrategyRule,
  type StrategySpec,
} from "./spec";
export { decideStrategy } from "./execute";
export { compileScoreExpression, isValidScoreExpression } from "./expression";

import { compileScoreExpression } from "./expression";
import {
  sanitizeStrategySpec as sanitizeStrategySpecRaw,
  type SanitizeSpecResult,
  type StrategySpec,
} from "./spec";

/** 写入存档前再验一次表达式：非法公式整段丢弃，避免循环依赖把校验放进 spec.ts */
export function sanitizeStrategySpec(
  raw: unknown,
  fallback?: StrategySpec
): SanitizeSpecResult {
  const result = sanitizeStrategySpecRaw(raw, fallback);
  if (!result.spec.scoreExpression) return result;
  if (compileScoreExpression(result.spec.scoreExpression)) return result;
  return {
    spec: { ...result.spec, scoreExpression: null },
    adjustedFields: [...result.adjustedFields, "scoreExpression"],
  };
}
