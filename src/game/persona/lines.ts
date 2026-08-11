import type { AICharacterId, AIInternalState, EmotionState } from "../types";

export interface PersonaLineSet {
  hunting: string[];
  escaping: string[];
  escapingTense?: string[];
  blocking?: string[];
  wandering?: string[];
  deadend?: string[];
  confident?: string[];
  ending: {
    win: string[];
    lose: string[];
    draw: string[];
  };
}

/**
 * 完整台词库，对应 docs/DESIGN.md 附录 C。
 * 每个「人格 × 状态」维护 4-6 条候选台词，随机播放并避免连续重复。
 */
export const PERSONA_LINES: Record<AICharacterId, PersonaLineSet> = {
  xiaotan: {
    hunting: [
      "食物！是食物！我要冲过去啦～",
      "呀，看到啦，冲鸭！",
      "唔，那边亮亮的是能吃的吗？走过去看看！",
      "机会来啦，我可不能错过！",
      "追上它，追上它！",
    ],
    escaping: [
      "呜哇！这边好像很危险！",
      "不行不行，得躲开！",
      "哎呀，差点就撞上了……",
      "感觉不太妙，换个方向好了！",
    ],
    escapingTense: [
      "啊啊啊啊怎么办怎么办！",
      "呜呜呜救命，是不是要没了！",
      "我、我不想撞墙啊！！",
    ],
    wandering: [
      "呃...我要往哪边走呀？",
      "咦？食物去哪里了？",
      "嗯……这边看起来也还好？",
      "随便走走，说不定会遇到好东西！",
    ],
    deadend: [
      "啊啊啊我是不是要撞墙了……",
      "对不起大家，我尽力了！",
      "呜……这局我好像不行了。",
    ],
    confident: ["诶嘿，我今天是不是有点厉害？", "咦？我好像领先了！好开心！"],
    ending: {
      win: ["诶？我...我赢了？！", "哇！我居然赢啦，谢谢大家！"],
      lose: ["呜呜，我下次会加油的！", "对不起，我又输啦……不过我会努力的！"],
      draw: ["我们、我们打平啦？", "平局也不错嘛，下次再分胜负！"],
    },
  },
  laomou: {
    hunting: [
      "路径已计算，前进。",
      "最优解，锁定目标。",
      "距离与风险，均在可接受范围。",
      "目标明确，执行。",
      "这一步，是当前局面的最优选择。",
    ],
    escaping: [
      "此路不通，重新规划。",
      "风险过高，切换方案。",
      "该路径已被排除。",
      "调整路线，规避风险。",
    ],
    blocking: [
      "封锁你的退路，是最优解。",
      "这条路，我先占了。",
      "限制你的选择，是我的策略。",
      "空间，由我掌控。",
    ],
    wandering: ["当前局面复杂，评估中。"],
    deadend: ["局势不利，重新评估。", "无解局面，接受结果。", "这一局，算漏了一步。"],
    ending: {
      win: ["一切，都在计算之中。", "结果，符合预期。"],
      lose: ["有趣，你打破了我的预测模型。", "数据会更新，下一局见。"],
      draw: ["平局也是一种数据。", "势均力敌，值得记录。"],
    },
  },
  shewang: {
    hunting: [
      "这块地盘，是我的。",
      "又送上门了？",
      "别急，这口迟早是我的。",
      "唾手可得的东西，不吃白不吃。",
      "看好了，这才是效率。",
    ],
    escaping: ["慌了？意料之中。", "急了吧，慢慢来。", "小场面，不足挂齿。"],
    blocking: [
      "想跑？门都没有。",
      "困住你，才有意思。",
      "这条路，从一开始就不是你的。",
      "看你还能撑多久。",
      "退无可退，感觉如何？",
    ],
    deadend: ["死路一条，谁的？", "连我也算漏了这步……", "……有点意思。"],
    confident: [
      "看着吧，结局早就注定了。",
      "就这？我还以为你能撑久一点。",
      "菜是原罪，认了吧。",
    ],
    ending: {
      win: ["菜就是菜，别不服。", "毫无悬念，正如所料。"],
      lose: ["……算你运气好。", "哼，下次可没这么容易了。"],
      draw: ["算你走运，没让我出全力。", "平局？算你识相。"],
    },
  },
};

function pickRandom(pool: string[], avoid: string | null): string {
  if (pool.length === 0) return "";
  if (pool.length === 1) return pool[0];
  const filtered = avoid ? pool.filter((line) => line !== avoid) : pool;
  const source = filtered.length > 0 ? filtered : pool;
  return source[Math.floor(Math.random() * source.length)];
}

/**
 * 根据人格、内部状态与情绪强度，从对应台词池随机取一条，
 * 并尽量避免与上一条重复。对应 docs/DESIGN.md 4.3/4.4 节。
 */
export function getRandomLine(
  characterId: AICharacterId,
  internalState: AIInternalState,
  emotion: EmotionState,
  previousLine: string | null
): string {
  const lines = PERSONA_LINES[characterId];

  if (emotion === "confident" && lines.confident && lines.confident.length > 0) {
    return pickRandom(lines.confident, previousLine);
  }

  if (
    internalState === "escaping" &&
    emotion === "tense" &&
    lines.escapingTense &&
    lines.escapingTense.length > 0
  ) {
    return pickRandom(lines.escapingTense, previousLine);
  }

  switch (internalState) {
    case "hunting":
      return pickRandom(lines.hunting, previousLine);
    case "escaping":
      return pickRandom(lines.escaping, previousLine);
    case "blocking":
      return pickRandom(lines.blocking && lines.blocking.length > 0 ? lines.blocking : lines.hunting, previousLine);
    case "wandering":
      return pickRandom(lines.wandering && lines.wandering.length > 0 ? lines.wandering : lines.hunting, previousLine);
    case "deadend":
      return pickRandom(lines.deadend && lines.deadend.length > 0 ? lines.deadend : lines.escaping, previousLine);
  }
}

export function getEndingLine(
  characterId: AICharacterId,
  result: "player" | "ai" | "draw"
): string {
  const lines = PERSONA_LINES[characterId];
  const pool =
    result === "ai" ? lines.ending.win : result === "player" ? lines.ending.lose : lines.ending.draw;
  return pickRandom(pool, null);
}
