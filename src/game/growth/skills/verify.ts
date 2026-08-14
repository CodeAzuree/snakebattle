import { describeSpecDiff, specsEqual, type StrategySpec } from "@/game/ai/strategy";
import {
  buildPostmortem,
  describePostmortem,
  hydrateSpecEvaluation,
} from "@/game/growth/backtestPostmortem";
import {
  BACKTEST_GAMES,
  BACKTEST_SEED_BASE,
  evaluateSpec,
  toGenomeEvaluation,
  type GenomeEvaluation,
  type SpecEvaluation,
} from "@/game/simulate";
import { countSpecEdits, MAX_RULE_CHANGES, MAX_WEIGHT_CHANGES } from "./evolve";
import type { SkillContext, VerifyOutcome } from "./types";

export { BACKTEST_GAMES, BACKTEST_SEED_BASE };

export async function measureBaseline(
  spec: StrategySpec,
  ctx: SkillContext
): Promise<SpecEvaluation> {
  return evaluateSpec(spec, {
    games: BACKTEST_GAMES,
    seedBase: BACKTEST_SEED_BASE,
    onProgress: (done, total) =>
      ctx.emit({
        type: "progress",
        skill: "verify",
        done,
        total,
        label: `测量现役基准（第 ${done}/${total} 局）`,
      }),
  });
}

function asSpecEvaluation(evaluation: GenomeEvaluation): SpecEvaluation | undefined {
  return hydrateSpecEvaluation(evaluation, (evaluation as SpecEvaluation).matches);
}

function outcomeOf(
  passed: boolean,
  reasons: string[],
  evaluation: GenomeEvaluation,
  baseline: GenomeEvaluation,
  postmortem: VerifyOutcome["postmortem"]
): VerifyOutcome {
  const baselineFull = asSpecEvaluation(baseline);
  return {
    passed,
    reasons,
    evaluation: toGenomeEvaluation(evaluation),
    baseline: toGenomeEvaluation(baseline),
    postmortem,
    baselineMatches: baselineFull?.matches ?? [],
  };
}

/**
 * 进化测试：静态检查 + 混合对手池回测 + 回归检查。
 *
 * 判定只看两条：适应度不低于现役，且开局送死不增加。
 * 净胜分已经包含在适应度里，不再单独设门。
 */
export async function runVerify(
  candidate: StrategySpec,
  current: StrategySpec,
  baseline: GenomeEvaluation,
  adjustedFields: string[],
  ctx: SkillContext
): Promise<VerifyOutcome> {
  if (specsEqual(candidate, current)) {
    ctx.emit({ type: "note", skill: "verify", text: "提案与现役策略一致，跳过回测。" });
    return outcomeOf(true, ["提案未改动任何策略字段"], baseline, baseline, null);
  }

  const edits = countSpecEdits(current, candidate);
  const staticReasons: string[] = [];
  if (edits.pathChanged > 1) staticReasons.push("寻路模式改了不止一次");
  if (edits.weightChanges > MAX_WEIGHT_CHANGES) {
    staticReasons.push(`一次改了 ${edits.weightChanges} 个权重，超过上限 ${MAX_WEIGHT_CHANGES}`);
  }
  if (edits.ruleChanged > MAX_RULE_CHANGES) {
    staticReasons.push(`规则改动过多（上限 ${MAX_RULE_CHANGES} 条）`);
  }
  if (staticReasons.length > 0) {
    ctx.emit({ type: "note", skill: "verify", text: `静态检查未通过：${staticReasons.join("；")}` });
    return outcomeOf(
      false,
      staticReasons,
      baseline,
      baseline,
      buildPostmortem({
        reasons: staticReasons,
        specDiff: describeSpecDiff(current, candidate),
        baseline: asSpecEvaluation(baseline),
      })
    );
  }

  if (adjustedFields.length > 0) {
    ctx.emit({
      type: "note",
      skill: "verify",
      text: `静态检查：${adjustedFields.slice(0, 4).join("、")} 曾越界，已收敛后再回测。`,
    });
  }

  const evaluation = await evaluateSpec(candidate, {
    games: BACKTEST_GAMES,
    seedBase: BACKTEST_SEED_BASE,
    onProgress: (done, total) =>
      ctx.emit({
        type: "progress",
        skill: "verify",
        done,
        total,
        label: `沙盒回测（第 ${done}/${total} 局）`,
      }),
  });

  const reasons: string[] = [];
  if (evaluation.averageFitness < baseline.averageFitness) {
    reasons.push(`适应度下降：${evaluation.averageFitness} < 现役 ${baseline.averageFitness}`);
  }
  if (evaluation.earlyDeaths > baseline.earlyDeaths) {
    reasons.push(`开局送死变多：${evaluation.earlyDeaths} 局 vs 现役 ${baseline.earlyDeaths} 局`);
  }

  const passed = reasons.length === 0;
  const specDiff = describeSpecDiff(current, candidate);
  const postmortem = passed
    ? null
    : buildPostmortem({
        reasons,
        specDiff,
        candidate: evaluation,
        baseline: asSpecEvaluation(baseline),
      });

  if (passed) {
    const diffPreview = specDiff.slice(0, 3).join("；");
    ctx.emit({
      type: "note",
      skill: "verify",
      text: `回测通过：适应度 ${baseline.averageFitness} → ${evaluation.averageFitness}，胜 ${evaluation.wins}/${evaluation.games} 局。${diffPreview}`,
    });
  } else {
    ctx.emit({ type: "note", skill: "verify", text: `回测未通过：${reasons.join("；")}` });
    if (postmortem) {
      for (const line of describePostmortem(postmortem)) {
        ctx.emit({ type: "note", skill: "verify", text: line });
      }
    }
  }

  return outcomeOf(passed, reasons, evaluation, baseline, postmortem);
}
