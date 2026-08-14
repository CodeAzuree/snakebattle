import type { DeathCause, FitnessTerms } from "@/game/replay";
import {
  BACKTEST_OPPONENT_LABELS,
  BACKTEST_OPPONENTS,
  toGenomeEvaluation,
  type BacktestMatch,
  type BacktestOpponent,
  type SpecEvaluation,
} from "@/game/simulate";

const DEATH_LABELS: Record<DeathCause, string> = {
  wall: "撞墙",
  self: "撞自己",
  opponent: "撞对手",
  survived: "存活",
};

export interface FitnessTermDelta {
  score: number;
  diff: number;
  survival: number;
  outcome: number;
  earlyDeathPenalty: number;
}

export interface OpponentDelta {
  opponent: BacktestOpponent;
  label: string;
  games: number;
  candidateFitness: number;
  baselineFitness: number;
  delta: number;
  candidateEarlyDeaths: number;
  baselineEarlyDeaths: number;
}

export interface WorstGame {
  opponent: BacktestOpponent;
  death: DeathCause;
  earlyDeath: boolean;
  avoidableDeath: boolean;
  safeDirections: number | null;
  fitnessDelta: number;
  candidateFitness: number;
  baselineFitness: number;
}

export interface BehaviorDrift {
  wastedTurns: number;
  spaceAvgRatio: number;
  turnRate: number;
  foodWinRate: number;
}

/**
 * 候选 vs 现役的结构化复盘。体积压在 1KB 量级，跟着否决反馈走客户端再回服务端。
 */
export interface BacktestPostmortem {
  reasons: string[];
  specDiff: string[];
  fitnessDelta: number;
  candidateFitness: number;
  baselineFitness: number;
  terms: FitnessTermDelta;
  byOpponent: OpponentDelta[];
  worstGames: WorstGame[];
  behavior: BehaviorDrift;
}

function avg(matches: BacktestMatch[], pick: (match: BacktestMatch) => number): number {
  if (matches.length === 0) return 0;
  return matches.reduce((sum, match) => sum + pick(match), 0) / matches.length;
}

function avgTerms(matches: BacktestMatch[]): FitnessTerms {
  return {
    score: avg(matches, (match) => match.terms.score),
    diff: avg(matches, (match) => match.terms.diff),
    survival: avg(matches, (match) => match.terms.survival),
    outcome: avg(matches, (match) => match.terms.outcome),
    earlyDeathPenalty: avg(matches, (match) => match.terms.earlyDeathPenalty),
  };
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ofOpponent(matches: BacktestMatch[], opponent: BacktestOpponent): BacktestMatch[] {
  return matches.filter((match) => match.opponent === opponent);
}

/**
 * 把候选与现役的回测对上号。没有每局数据时也给出总分差和改动列表，
 * 静态检查失败走这条退化路径。
 */
export function buildPostmortem(input: {
  reasons: string[];
  specDiff: string[];
  candidate?: SpecEvaluation;
  baseline?: SpecEvaluation;
}): BacktestPostmortem {
  const candidateMatches = input.candidate?.matches ?? [];
  const baselineMatches = input.baseline?.matches ?? [];
  const candidateTerms = avgTerms(candidateMatches);
  const baselineTerms = avgTerms(baselineMatches);
  const candidateFitness = input.candidate?.averageFitness ?? 0;
  const baselineFitness = input.baseline?.averageFitness ?? 0;

  const byOpponent: OpponentDelta[] = BACKTEST_OPPONENTS.map((opponent) => {
    const cand = ofOpponent(candidateMatches, opponent);
    const base = ofOpponent(baselineMatches, opponent);
    const candidateAvg = avg(cand, (match) => match.fitness);
    const baselineAvg = avg(base, (match) => match.fitness);
    return {
      opponent,
      label: BACKTEST_OPPONENT_LABELS[opponent],
      games: cand.length,
      candidateFitness: round(candidateAvg),
      baselineFitness: round(baselineAvg),
      delta: round(candidateAvg - baselineAvg),
      candidateEarlyDeaths: cand.filter((match) => match.earlyDeath).length,
      baselineEarlyDeaths: base.filter((match) => match.earlyDeath).length,
    };
  }).filter((row) => row.games > 0);

  const pairCount = Math.min(candidateMatches.length, baselineMatches.length);
  const worstGames: WorstGame[] = [];
  for (let i = 0; i < pairCount; i++) {
    const cand = candidateMatches[i];
    const base = baselineMatches[i];
    worstGames.push({
      opponent: cand.opponent,
      death: cand.death,
      earlyDeath: cand.earlyDeath,
      avoidableDeath: cand.avoidableDeath,
      safeDirections: cand.safeDirections,
      fitnessDelta: round(cand.fitness - base.fitness),
      candidateFitness: cand.fitness,
      baselineFitness: base.fitness,
    });
  }
  worstGames.sort((a, b) => a.fitnessDelta - b.fitnessDelta);

  return {
    reasons: input.reasons.slice(0, 4),
    specDiff: input.specDiff.slice(0, 6),
    fitnessDelta: round(candidateFitness - baselineFitness),
    candidateFitness,
    baselineFitness,
    terms: {
      score: round(candidateTerms.score - baselineTerms.score),
      diff: round(candidateTerms.diff - baselineTerms.diff),
      survival: round(candidateTerms.survival - baselineTerms.survival),
      outcome: round(candidateTerms.outcome - baselineTerms.outcome),
      earlyDeathPenalty: round(candidateTerms.earlyDeathPenalty - baselineTerms.earlyDeathPenalty),
    },
    byOpponent,
    worstGames: worstGames.slice(0, 3),
    behavior: {
      wastedTurns: round(
        avg(candidateMatches, (match) => match.wastedTurns) -
          avg(baselineMatches, (match) => match.wastedTurns),
        2
      ),
      spaceAvgRatio: round(
        avg(candidateMatches, (match) => match.spaceAvgRatio) -
          avg(baselineMatches, (match) => match.spaceAvgRatio)
      ),
      turnRate: round(
        avg(candidateMatches, (match) => match.turnRate) -
          avg(baselineMatches, (match) => match.turnRate)
      ),
      foodWinRate: round(
        avg(candidateMatches, (match) => match.foodWinRate) -
          avg(baselineMatches, (match) => match.foodWinRate)
      ),
    },
  };
}

function signed(value: number, digits = 2): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function termLine(label: string, delta: number, invert = false): string | null {
  if (Math.abs(delta) < 0.05) return null;
  const worse = invert ? delta > 0 : delta < 0;
  return `${label} ${signed(delta)}${worse ? "（变差）" : ""}`;
}

function describeWorst(game: WorstGame): string {
  const death = game.earlyDeath ? `开局${DEATH_LABELS[game.death]}` : DEATH_LABELS[game.death];
  const avoidable =
    game.avoidableDeath && (game.safeDirections ?? 0) > 0
      ? `，现场还有 ${game.safeDirections} 个安全方向`
      : "";
  return `对${BACKTEST_OPPONENT_LABELS[game.opponent]} ${death}${avoidable}，适应度 ${signed(game.fitnessDelta)}`;
}

/**
 * 把复盘渲染成人话行：一份给提示词，一份 emit 成 note 给玩家看。
 */
export function describePostmortem(postmortem: BacktestPostmortem): string[] {
  const lines: string[] = [
    `适应度 ${postmortem.baselineFitness} → ${postmortem.candidateFitness}（${signed(postmortem.fitnessDelta, 3)}）`,
  ];

  const terms = [
    termLine("得分", postmortem.terms.score),
    termLine("净胜", postmortem.terms.diff),
    termLine("存活", postmortem.terms.survival),
    termLine("胜负奖励", postmortem.terms.outcome),
    termLine("送死罚分", postmortem.terms.earlyDeathPenalty, true),
  ].filter((line): line is string => Boolean(line));
  if (terms.length > 0) lines.push(`分项：${terms.join("，")}`);

  if (postmortem.byOpponent.length > 0) {
    const ranked = [...postmortem.byOpponent].sort((a, b) => a.delta - b.delta);
    lines.push(
      `按对手：${ranked
        .map((row) => {
          const deaths =
            row.candidateEarlyDeaths !== row.baselineEarlyDeaths
              ? `，开局送死 ${row.candidateEarlyDeaths}/${row.games} vs 现役 ${row.baselineEarlyDeaths}`
              : "";
          return `${row.label} ${signed(row.delta)}${deaths}`;
        })
        .join("；")}`
    );
  }

  for (const game of postmortem.worstGames.filter((item) => item.fitnessDelta < -0.05).slice(0, 3)) {
    lines.push(`最差局：${describeWorst(game)}`);
  }

  const drift: string[] = [];
  if (Math.abs(postmortem.behavior.wastedTurns) >= 0.5) {
    drift.push(`浪费转向 ${signed(postmortem.behavior.wastedTurns, 1)}`);
  }
  if (Math.abs(postmortem.behavior.spaceAvgRatio) >= 0.02) {
    drift.push(`空间 ${signed(postmortem.behavior.spaceAvgRatio)}`);
  }
  if (Math.abs(postmortem.behavior.turnRate) >= 0.03) {
    drift.push(`转向频率 ${signed(postmortem.behavior.turnRate)}`);
  }
  if (Math.abs(postmortem.behavior.foodWinRate) >= 0.05) {
    drift.push(`抢食胜率 ${signed(postmortem.behavior.foodWinRate)}`);
  }
  if (drift.length > 0) lines.push(`行为：${drift.join("，")}`);

  if (postmortem.specDiff.length > 0) {
    lines.push(`被否决的改动：${postmortem.specDiff.join("；")}`);
  }
  return lines;
}

export function hydrateSpecEvaluation(
  evaluation: { averageFitness: number; averageScoreDiff: number; wins: number; games: number; earlyDeaths: number },
  matches?: BacktestMatch[]
): SpecEvaluation | undefined {
  if (!matches || matches.length === 0) return undefined;
  return { ...toGenomeEvaluation(evaluation), matches };
}
