/**
 * 一次性校验：v2 迁移、表达式解析、9 局 DSL 回测计时。
 * 运行：npx tsx scripts/verify-dsl.ts
 */
import { NOVICE_GENOME } from "../src/game/ai/adaptive";
import {
  NOVICE_SPEC,
  compileScoreExpression,
  migrateGenomeToSpec,
  sanitizeStrategySpec,
} from "../src/game/ai/strategy";
import { evaluateSpec } from "../src/game/simulate";
import { sanitizeGrowthState } from "../src/lib/growthStorage";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const migrated = migrateGenomeToSpec(NOVICE_GENOME);
  assert(migrated.pathMode === "greedy", "新手基因应映射为 greedy");
  assert(migrated.safety.avoidImmediateDeath === false, "新手不应开启避死");
  assert(migrated.mistakeProbability === 0.5, "新手失误率应为 0.5");

  const v2 = sanitizeGrowthState({
    version: 2,
    name: "旧档",
    genome: NOVICE_GENOME,
    bestFitness: 12.5,
    bestEvaluation: {
      averageFitness: 12.5,
      averageScoreDiff: 1,
      wins: 2,
      games: 5,
      earlyDeaths: 1,
    },
    matchCount: 3,
    lastEvolvedMatchCount: 0,
  });
  assert(v2.version === 3, "应升到 v3");
  assert(v2.spec.pathMode === "greedy", "迁移后应有 spec");
  assert(v2.bestEvaluation === null, "旧适应度必须置空");
  assert(v2.bestFitness === null, "旧适应度必须置空");

  const ok = compileScoreExpression("foodProximity * 2 + min(reachableArea, 1)");
  assert(ok, "合法表达式应能编译");
  assert(compileScoreExpression("eval(1)") === null, "非法表达式必须丢弃");
  const dropped = sanitizeStrategySpec({
    ...NOVICE_SPEC,
    scoreExpression: "process.exit(1)",
  });
  assert(dropped.spec.scoreExpression === null, "sanitize 应丢掉非法公式");

  const started = Date.now();
  const evaluation = await evaluateSpec(NOVICE_SPEC);
  const elapsed = Date.now() - started;
  console.log(
    `9 局回测 ${elapsed}ms，适应度 ${evaluation.averageFitness}，开局送死 ${evaluation.earlyDeaths}/${evaluation.games}`
  );
  assert(elapsed < 3000, `回测应在 3 秒内完成，实际 ${elapsed}ms`);
  console.log("verify-dsl: ok");
}

void main();
