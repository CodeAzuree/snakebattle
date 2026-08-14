import {
  bfsReachableArea,
  manhattanDistance,
} from "../../board";
import type { AIDecisionContext } from "../../types";
import {
  FEATURE_KEYS,
  type FeatureKey,
  type RuleAction,
  type RuleCondition,
  type StrategyRule,
} from "./spec";

/**
 * 每条规则动作对应一组权重乘子：命中后叠到现役权重上，不引入新的代码路径。
 * 这样模型「换策略」本质上还是在改同一套特征打分，回测与执行保持一致。
 */
export const ACTION_WEIGHT_PRESETS: Record<RuleAction, Partial<Record<FeatureKey, number>>> = {
  chaseFood: { foodProximity: 1.4, foodRace: 0.6, reachableArea: -0.2 },
  surviveFirst: { reachableArea: 1.6, tailReachable: 1.2, foodProximity: -0.4, corridorWidth: 0.6 },
  chaseTail: { tailReachable: 1.8, reachableArea: 0.6, foodProximity: -0.6 },
  blockOpponent: { opponentBlock: 1.6, foodProximity: 0.3, opponentDistance: -0.4 },
  retreatToOpenSpace: { reachableArea: 1.4, corridorWidth: 0.8, wallDistance: 0.4, foodProximity: -0.3 },
  hugWall: { wallDistance: -1.2, directionInertia: 0.4, foodProximity: 0.4 },
};

export function applyActionPreset(
  base: Record<FeatureKey, number>,
  action: RuleAction
): Record<FeatureKey, number> {
  const next = { ...base };
  const preset = ACTION_WEIGHT_PRESETS[action];
  for (const key of FEATURE_KEYS) {
    const delta = preset[key];
    if (delta) next[key] = Math.max(-2, Math.min(2, next[key] + delta));
  }
  return next;
}

function occupiedFrom(ctx: AIDecisionContext): Set<string> {
  const occupied = new Set<string>();
  for (const seg of ctx.self.body.slice(0, -1)) occupied.add(`${seg.x},${seg.y}`);
  for (const seg of ctx.opponent.body) occupied.add(`${seg.x},${seg.y}`);
  return occupied;
}

export function conditionMatches(condition: RuleCondition, ctx: AIDecisionContext): boolean {
  const { self, opponent, food, gridSize, timeRemainingMs } = ctx;
  const head = self.body[0];
  const oppHead = opponent.body[0];

  switch (condition.kind) {
    case "always":
      return true;
    case "areaBelow":
      return bfsReachableArea(head, gridSize, occupiedFrom(ctx)) < condition.value;
    case "lengthAbove":
      return self.body.length >= condition.value;
    case "opponentCloserToFoodBy":
      return manhattanDistance(oppHead, food) + condition.value < manhattanDistance(head, food);
    case "scoreDeficitAbove":
      return opponent.score - self.score >= condition.value;
    case "scoreLeadAbove":
      return self.score - opponent.score >= condition.value;
    case "timeRemainingBelowSec":
      return timeRemainingMs / 1000 <= condition.value;
    case "opponentHeadWithin":
      return manhattanDistance(head, oppHead) <= condition.value;
  }
}

/** 有序匹配：先命中的先生效，未命中则沿用基础权重 */
export function resolveActiveWeights(
  rules: StrategyRule[],
  base: Record<FeatureKey, number>,
  ctx: AIDecisionContext
): { weights: Record<FeatureKey, number>; action: RuleAction | null } {
  for (const rule of rules) {
    if (conditionMatches(rule.when, ctx)) {
      return { weights: applyActionPreset(base, rule.then), action: rule.then };
    }
  }
  return { weights: base, action: null };
}
