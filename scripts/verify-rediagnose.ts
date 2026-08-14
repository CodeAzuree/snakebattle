/**
 * 用一份必然退化的回测复盘跑重诊断 + 再提案，确认 failureCause 落到具体改动、
 * 第二版规格换了方向。需要 .env.local 里的 API Key。
 * 运行：npx tsx --env-file=.env.local scripts/verify-rediagnose.ts
 */
import { describeSpecDiff, NOVICE_SPEC, sanitizeStrategySpec } from "../src/game/ai/strategy";
import { buildPostmortem } from "../src/game/growth/backtestPostmortem";
import { createSkillContext, toRejection } from "../src/game/growth/skills/pipeline";
import { runEvolve } from "../src/game/growth/skills/evolve";
import { runRediagnose } from "../src/game/growth/skills/rediagnose";
import { runVerify } from "../src/game/growth/skills/verify";
import { evaluateSpec } from "../src/game/simulate";
import { createNoviceGrowthState } from "../src/lib/growthStorage";
import type { Diagnosis } from "../src/game/growth/skills/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) throw new Error("缺少 MOONSHOT_API_KEY");

  const strong = sanitizeStrategySpec({
    ...NOVICE_SPEC,
    pathMode: "bfsShortest",
    mistakeProbability: 0.02,
    safety: {
      ...NOVICE_SPEC.safety,
      avoidImmediateDeath: true,
      requireEscapeRoute: true,
    },
  }).spec;

  const rejected = NOVICE_SPEC;
  const [baseline, candidate] = await Promise.all([evaluateSpec(strong), evaluateSpec(rejected)]);
  const specDiff = describeSpecDiff(strong, rejected);
  const postmortem = buildPostmortem({
    reasons: [`适应度下降：${candidate.averageFitness} < 现役 ${baseline.averageFitness}`],
    specDiff,
    candidate,
    baseline,
  });

  const previous: Diagnosis = {
    problems: [
      {
        issue: "抢食太慢",
        evidence: "食物全被拿走",
        rootCause: "pathMode 还是 greedy",
        hypothesis: "把 pathMode 改回 greedy、把失误率拉到 0.5",
        expectedEffect: "更敢冲",
        priority: "high",
      },
    ],
    focus: "更大胆地直冲食物",
  };

  const state = { ...createNoviceGrowthState(), spec: strong };
  const rejection = toRejection(
    { reasoning: "退回新手打法", spec: rejected, adjustedFields: [], rationale: specDiff },
    {
      passed: false,
      reasons: postmortem.reasons,
      evaluation: candidate,
      baseline,
      postmortem,
      baselineMatches: baseline.matches,
    }
  );

  console.log("\n== 重新诊断 ==");
  const diagnoseCtx = createSkillContext({
    apiKey,
    model: process.env.MOONSHOT_MODEL,
    emit: (event) => {
      if (event.type === "note") console.log(`  note[${event.skill}] ${event.text}`);
    },
    budgetMs: 60_000,
  });
  const redo = await runRediagnose(state, previous, rejection, diagnoseCtx);
  console.log(`\nfailureCause: ${redo.failureCause}`);
  assert(redo.failureCause.length > 0, "应给出未通过原因");
  assert(!/^适应度下降/.test(redo.failureCause), "未通过原因不能只是复述适应度下降");
  assert(redo.diagnosis.problems.length > 0, "应产出新问题清单");

  console.log("\n== 按新清单再提案 ==");
  const evolveCtx = createSkillContext({
    apiKey,
    model: process.env.MOONSHOT_MODEL,
    emit: (event) => {
      if (event.type === "note") console.log(`  note[${event.skill}] ${event.text}`);
    },
    budgetMs: 60_000,
  });
  const proposal = await runEvolve(state, redo.diagnosis, evolveCtx, {
    ...rejection,
    failureCause: redo.failureCause,
  });
  const nextDiff = describeSpecDiff(state.spec, proposal.spec);
  const rejectedDiff = specDiff.join("｜");
  console.log(`第二版改动：${nextDiff.join("；") || "（无）"}`);
  assert(nextDiff.length > 0, "第二版应改动策略");
  assert(nextDiff.join("｜") !== rejectedDiff, "第二版不应原样重复被否决的改动");

  const verify = await runVerify(proposal.spec, state.spec, baseline, proposal.adjustedFields, evolveCtx);
  console.log(`回测：${verify.passed ? "通过" : verify.reasons.join("；")}`);

  console.log("\n✓ 重诊断把未通过原因落到了具体改动，第二版换了方向");
}

void main();
