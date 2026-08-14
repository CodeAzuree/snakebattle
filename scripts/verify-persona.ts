/**
 * 打印几种典型策略的人格侧写，用来确认「不同打法喂给人格模块的种子确实不同」，
 * 并断言命名规则由打法位移而不是代数决定。
 * 不调用大模型，可以随便跑。运行：npx tsx scripts/verify-persona.ts
 */
import { NOVICE_SPEC, sanitizeStrategySpec, type StrategySpec } from "../src/game/ai/strategy";
import { describePlaystyle, namingRule, styleShifted } from "../src/game/growth/skills/persona";
import { createNoviceGrowthState, DEFAULT_MYSTERY_NAME } from "../src/lib/growthStorage";

const build = (patch: Partial<StrategySpec>): StrategySpec =>
  sanitizeStrategySpec({ ...NOVICE_SPEC, ...patch }).spec;

const cases: Record<string, StrategySpec> = {
  出厂新手: NOVICE_SPEC,
  惜命苟活: build({
    pathMode: "spaceFill",
    mistakeProbability: 0.02,
    weights: { ...NOVICE_SPEC.weights, reachableArea: 1.6, corridorWidth: 1 },
    safety: {
      avoidImmediateDeath: true,
      requireEscapeRoute: true,
      tailSafety: true,
      minAreaMargin: 3,
    },
  }),
  压制型: build({
    pathMode: "bfsShortest",
    mistakeProbability: 0.04,
    weights: { ...NOVICE_SPEC.weights, opponentBlock: 1.4, foodRace: 1 },
    rules: [
      { when: { kind: "opponentHeadWithin", value: 3 }, then: "blockOpponent" },
      { when: { kind: "areaBelow", value: 8 }, then: "retreatToOpenSpace" },
      { when: { kind: "always", value: 0 }, then: "chaseFood" },
    ],
    safety: {
      avoidImmediateDeath: true,
      requireEscapeRoute: true,
      tailSafety: false,
      minAreaMargin: 1,
    },
  }),
  抽风绕尾: build({
    pathMode: "tailChase",
    mistakeProbability: 0.28,
    weights: { ...NOVICE_SPEC.weights, opponentDistance: 0.9, wallDistance: -0.8 },
    scoreExpression: "reachableArea * 2 - foodProximity",
  }),
};

const seen = new Set<string>();
for (const [name, spec] of Object.entries(cases)) {
  const traits = describePlaystyle(spec);
  console.log(`\n== ${name} ==`);
  for (const trait of traits) console.log(` - ${trait}`);
  seen.add(traits.join("|"));
}

if (seen.size !== Object.keys(cases).length) {
  throw new Error("不同打法产生了相同的人格侧写，人格差异感会退化");
}
console.log(`\n✓ ${seen.size} 种打法产生了 ${seen.size} 份不同的侧写`);

// 命名规则：同一个名字，只有「打法真的换了」才允许改名，与代数无关
const named = { ...createNoviceGrowthState(), name: "蜷", generation: 9 };
const shifted = { accepted: true, effectiveChanges: ["寻路 直冲 → 最短路"], generation: 10 };
const stable = { accepted: true, effectiveChanges: ["失误率 0.5 → 0.45"], generation: 10 };

if (!styleShifted(shifted) || styleShifted(stable)) {
  throw new Error("styleShifted 判定有误：换寻路模式应算位移，微调单项不应算");
}

const shiftedRule = namingRule(named, shifted, "mature");
const stableRule = namingRule(named, stable, "mature");
if (!shiftedRule.includes("可以给自己改一个名字")) {
  throw new Error("打法位移时应允许改名，实际是：" + shiftedRule);
}
if (!stableRule.includes(`保持「${named.name}」`)) {
  throw new Error("打法没动时应保持原名，实际是：" + stableRule);
}

// 平台期（代数停在 2）仍叫「？？？」且有实质进步时，必须命名
const anonymous = { ...createNoviceGrowthState(), generation: 2 };
const firstNameRule = namingRule(anonymous, { ...shifted, generation: 2 }, "first");
if (!firstNameRule.includes("**必须**给自己起第一个名字")) {
  throw new Error("仍叫「？？？」时应强制命名，实际是：" + firstNameRule);
}
if (!firstNameRule.includes(describePlaystyle(anonymous.spec)[0])) {
  throw new Error("命名规则里应附上打法侧写，否则名字对不上走位");
}
if (namingRule(anonymous, shifted, "silent").includes("必须")) {
  throw new Error(`silent 档应保持「${DEFAULT_MYSTERY_NAME}」，不许命名`);
}

console.log("✓ 命名规则：打法位移解锁改名、无位移保持原名、未命名时强制起名");
