/**
 * 离线预训练脚本：在本地反复执行"模拟若干局 -> 触发一轮完整进化流水线"，
 * 产出一份已经成长过若干代的种子存档 JSON，可以在选角页导入，用于演示或作为初始状态。
 *
 * 运行：
 *   $env:MOONSHOT_API_KEY="sk-..."; npx tsx scripts/train.ts 10
 *   第一个参数是进化轮数（默认 5），第二个参数是输出文件（默认 growth-seed.json）。
 *
 * 与浏览器里的成长完全共用一套逻辑（skills/pipeline.ts / simulate.ts），
 * 差别只有两点：对手由 BFS 策略代打而不是真人，以及事件打到控制台而不是 HTTP 流。
 */
import { writeFileSync } from "node:fs";
import { decideStrategy } from "../src/game/ai/strategy";
import { runEvolution } from "../src/game/growth/skills/pipeline";
import type { EvolutionEvent } from "../src/game/growth/skills/types";
import { simulateMatch } from "../src/game/simulate";
import { createSeededRng } from "../src/lib/rng";
import {
  MATCHES_PER_EVOLUTION,
  appendMatchSummary,
  createNoviceGrowthState,
  evolutionReadiness,
  exportGrowthState,
  pendingMatchSummaries,
  type GrowthState,
} from "../src/lib/growthStorage";

const apiKey = process.env.MOONSHOT_API_KEY;
if (!apiKey) {
  console.error("缺少环境变量 MOONSHOT_API_KEY，无法调用大模型。");
  process.exit(1);
}

const rounds = Number(process.argv[2] ?? 5);
const outputPath = process.argv[3] ?? "growth-seed.json";

function printEvent(event: EvolutionEvent) {
  switch (event.type) {
    case "stage":
      console.log(`  [${event.index}/${event.total}] ${event.label}`);
      return;
    case "note":
      console.log(`      ${event.text}`);
      return;
    case "progress":
      if (event.done === event.total) console.log(`      ${event.label}`);
      return;
    case "attempt":
      console.log(`      自我修正第 ${event.attempt}/${event.max} 次：${event.reason}`);
      return;
    case "skipped":
      console.log(`      已跳过：${event.reason}`);
      return;
    default:
      return;
  }
}

async function main() {
  let state: GrowthState = createNoviceGrowthState();

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n=== 第 ${round} 轮 ===`);

    // 先攒够败绩/平局再进化，与线上门禁一致。它连胜时不强制复盘。
    let games = 0;
    while (
      !evolutionReadiness(state).ready &&
      games < MATCHES_PER_EVOLUTION * 10
    ) {
      const seed = (Date.now() % 100000) + round * 31 + games;
      const aiRng = createSeededRng(seed ^ 0x5bf03635);
      const currentSpec = state.spec;
      const outcome = simulateMatch({
        seed,
        aiCharacterId: "mystery",
        aiStrategy: (ctx) => decideStrategy(ctx, currentSpec, aiRng),
      });
      state = appendMatchSummary(state, outcome.summary);
      games += 1;
      const counted = outcome.result !== "ai";
      console.log(
        `  对局 ${games}：${outcome.result}${counted ? "" : "（赢了，不计入）"}（我 ${outcome.summary.aiScore} : 玩家 ${outcome.summary.playerScore}，存活 ${outcome.summary.durationSec}s）`
      );
    }

    const matches = pendingMatchSummaries(state);
    if (!evolutionReadiness(state).ready) {
      console.log("  它一直在赢，本轮跳过进化");
      continue;
    }

    const result = await runEvolution({
      state,
      matches,
      apiKey: apiKey!,
      emit: printEvent,
    });
    state = result.state;

    console.log(
      `  结论：${result.status}（提案 ${result.attempts} 次，适应度 ${result.baselineFitness} -> ${result.candidateFitness}）`
    );
    console.log(`  ${result.headline}`);
    if (result.reasoning) console.log(`  它的自述：${result.reasoning}`);

    // 留一点间隔避免触发接口限流
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  writeFileSync(outputPath, exportGrowthState(state), "utf8");
  console.log(
    `\n已写入种子存档：${outputPath}（名字「${state.name}」，第 ${state.generation} 代，适应度 ${state.bestFitness}）`
  );
}

void main();
