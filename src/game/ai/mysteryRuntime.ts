import { NOVICE_SPEC, type StrategySpec } from "./strategy";

/**
 * 自学习 AI 当前生效的策略规格。
 *
 * 存档在 localStorage 里，但决策函数每 tick 都要用它，不能每次都读存储、解析 JSON。
 * 因此进入对局前由页面把存档里的规格同步到这里，决策时只读内存中的这一份。
 * 服务端渲染时这里始终是新手规格，不会读到任何浏览器状态。
 */
let activeSpec: StrategySpec = {
  ...NOVICE_SPEC,
  weights: { ...NOVICE_SPEC.weights },
  safety: { ...NOVICE_SPEC.safety },
};

export function setActiveSpec(spec: StrategySpec) {
  activeSpec = spec;
}

export function getActiveSpec(): StrategySpec {
  return activeSpec;
}
