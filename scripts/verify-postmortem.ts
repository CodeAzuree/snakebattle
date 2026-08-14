/**
 * 纯本地校验：回测复盘能定位到送死罚分与具体对手。
 * 不调用大模型。运行：npx tsx scripts/verify-postmortem.ts
 */
import { NOVICE_SPEC, describeSpecDiff, sanitizeStrategySpec } from "../src/game/ai/strategy";
import { buildPostmortem, describePostmortem } from "../src/game/growth/backtestPostmortem";
import { evaluateSpec } from "../src/game/simulate";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const baselineSpec = sanitizeStrategySpec({
    ...NOVICE_SPEC,
    pathMode: "bfsShortest",
    mistakeProbability: 0.02,
    safety: {
      ...NOVICE_SPEC.safety,
      avoidImmediateDeath: true,
      requireEscapeRoute: true,
    },
  }).spec;
  const candidateSpec = NOVICE_SPEC;

  const [baseline, candidate] = await Promise.all([
    evaluateSpec(baselineSpec),
    evaluateSpec(candidateSpec),
  ]);

  assert(candidate.matches.length === 9, "候选应留下 9 局复盘");
  assert(baseline.matches.length === 9, "现役应留下 9 局复盘");
  assert(candidate.averageFitness < baseline.averageFitness, "新手规格相对稳健规格应更弱");

  const postmortem = buildPostmortem({
    reasons: [`适应度下降：${candidate.averageFitness} < 现役 ${baseline.averageFitness}`],
    specDiff: describeSpecDiff(baselineSpec, candidateSpec),
    candidate,
    baseline,
  });

  assert(postmortem.fitnessDelta < 0, "复盘应报适应度下降");
  assert(
    postmortem.terms.earlyDeathPenalty > 0 || postmortem.terms.survival < 0,
    "退化应能归因到送死罚分或存活项"
  );
  assert(postmortem.byOpponent.length === 3, "应按三种对手归因");
  assert(
    postmortem.byOpponent.some((row) => row.delta < 0),
    "至少对一种对手变差"
  );
  assert(postmortem.worstGames.length > 0, "应列出退化最狠的局");

  const lines = describePostmortem(postmortem);
  console.log(lines.join("\n"));
  assert(lines.some((line) => line.includes("适应度")), "人话行应包含适应度");
  assert(
    lines.some((line) => /贪心|BFS|蛇王/.test(line)),
    "人话行应按对手说话"
  );

  console.log("\nverify-postmortem: ok");
}

void main();
