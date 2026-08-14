/**
 * 本地胜率粗验脚本：用 BFS 策略模拟一个"稳健玩家"，
 * 分别对战三档 AI 各若干局，核对难度梯度是否符合 docs/DESIGN.md 3.2 节预期。
 * 加上 --adaptive 参数则额外跑一遍自学习 AI 的新手基因，确认它确实"很菜"。
 * 运行：npx tsx scripts/simulate.ts [局数] [--adaptive]
 */
import { AI_ROSTER } from "../src/game/ai/roster";
import { NOVICE_SPEC, decideStrategy } from "../src/game/ai/strategy";
import { simulateMatch } from "../src/game/simulate";
import { createSeededRng } from "../src/lib/rng";
import type { AICharacterId, AIDecisionStrategy } from "../src/game/types";

function runTrials(
  label: string,
  aiStrategy: (seed: number) => AIDecisionStrategy,
  trials: number,
  aiCharacterId: AICharacterId = "laomou"
) {
  let playerWins = 0;
  let aiWins = 0;
  let draws = 0;

  for (let i = 0; i < trials; i++) {
    const seed = 1000 + i;
    const { result } = simulateMatch({ seed, aiCharacterId, aiStrategy: aiStrategy(seed) });
    if (result === "player") playerWins++;
    else if (result === "ai") aiWins++;
    else draws++;
  }

  console.log(
    `${label}：玩家代理胜 ${playerWins}/${trials} (${((playerWins / trials) * 100).toFixed(1)}%)，` +
      `AI 胜 ${aiWins}/${trials} (${((aiWins / trials) * 100).toFixed(1)}%)，平局 ${draws}/${trials}`
  );
}

function runRosterTrials(aiCharacterId: AICharacterId, trials: number) {
  const character = AI_ROSTER[aiCharacterId];
  runTrials(
    `${character.name}（${character.title}）`,
    () => character.decisionStrategy,
    trials,
    aiCharacterId
  );
}

const args = process.argv.slice(2);
const TRIALS = Number(args.find((arg) => !arg.startsWith("--")) ?? 200);
console.log(`每档 AI 模拟 ${TRIALS} 局（玩家一方由 BFS 策略代打）...\n`);
runRosterTrials("xiaotan", TRIALS);
runRosterTrials("laomou", TRIALS);
runRosterTrials("shewang", TRIALS);

if (args.includes("--adaptive")) {
  runTrials(
    "自学习 AI（新手规格）",
    (seed) => {
      const rng = createSeededRng(seed ^ 0x9e3779b9);
      return (ctx) => decideStrategy(ctx, NOVICE_SPEC, rng);
    },
    TRIALS
  );
}
