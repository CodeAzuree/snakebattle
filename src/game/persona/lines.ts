import type { AICharacterId } from "../types";
import type { HighlightKind } from "./highlights";

/**
 * 每个字段对应 highlights.ts 里的一个"发言节点"，只在该节点被命中时才会被选用。
 * `gameStart` 不在这里配置——直接复用 roster.ts 已有的 `tagline`，避免重复维护同一句开场白。
 */
export interface PersonaLineSet {
  /** 被逼到死路、无路可走时的播报 */
  deadend: string[];
  /** 主动封锁玩家去路时的播报（仅老谋/蛇王会进入 blocking 状态） */
  blocking?: string[];
  /** 持续卡住吃不到食物、刚跨过阈值时的播报 */
  blocked: string[];
  /** 连续吃到 3/5 个豆子时的播报 */
  streak: string[];
  /** 连续吃到 8 个以上豆子时的加强版播报 */
  streakBig: string[];
  /** 比分大幅领先时的播报 */
  bigLead: string[];
  /** 比分大幅落后时的播报 */
  bigDeficit: string[];
  ending: {
    win: string[];
    lose: string[];
    draw: string[];
  };
}

/**
 * 运行时台词覆盖：只有自学习 AI 会用到。
 * 它的台词由大模型在进化中逐步写出来并存进成长存档，
 * 没有被覆盖的节点回落到下面 PERSONA_LINES 里的占位台词。
 */
export type PersonaLineOverride = Partial<Omit<PersonaLineSet, "ending">> & {
  ending?: Partial<PersonaLineSet["ending"]>;
};

/**
 * 完整台词库，对应 docs/DESIGN.md 附录 C。
 * 每个「人格 × 节点」维护 3-5 条候选台词，随机播放并避免连续重复；
 * 每条台词都对应一个具体节点，不再有缺乏目的性的日常状态闲聊。
 */
export const PERSONA_LINES: Record<AICharacterId, PersonaLineSet> = {
  xiaotan: {
    deadend: [
      "啊啊啊我是不是要撞墙了……",
      "对不起大家，我尽力了！",
      "呜……这局我好像不行了。",
    ],
    blocked: [
      "呜……这条路怎么走不过去呀！",
      "唔，绕不过去，好烦恼。",
      "这样下去我什么都吃不到了啦！",
    ],
    streak: [
      "哇！我连续吃到好几个了！",
      "一个接一个，好有成就感！",
      "咦，我是不是变厉害了？",
    ],
    streakBig: [
      "哇啊！我是不是要起飞了！！",
      "从来没吃这么多过，好开心！！",
    ],
    bigLead: [
      "诶嘿嘿，是不是已经赢定了！",
      "领先这么多，我都不敢相信！",
      "这次真的要赢了吗？好紧张！",
    ],
    bigDeficit: [
      "呜哇，差距怎么这么大……",
      "追不上了……是不是拉太远了！",
      "这样下去要输很多分了，怎么办！",
    ],
    ending: {
      win: ["诶？我...我赢了？！", "哇！我居然赢啦，谢谢大家！"],
      lose: ["呜呜，我下次会加油的！", "对不起，我又输啦……不过我会努力的！"],
      draw: ["我们、我们打平啦？", "平局也不错嘛，下次再分胜负！"],
    },
  },
  laomou: {
    deadend: ["局势不利，重新评估。", "无解局面，接受结果。", "这一局，算漏了一步。"],
    blocking: [
      "封锁你的退路，是最优解。",
      "这条路，我先占了。",
      "限制你的选择，是我的策略。",
      "空间，由我掌控。",
    ],
    blocked: [
      "此路径已被验证不可行，重新评估。",
      "当前通道受限，切换方案。",
      "空间被压缩，正在重新计算。",
    ],
    streak: ["效率符合预期。", "连续命中，路径规划有效。", "按计划推进中。"],
    streakBig: ["连续收益超出基准值，继续保持。", "这套路径策略，值得记录。"],
    bigLead: [
      "优势已经建立，维持节奏即可。",
      "局势在掌控之中。",
      "这个差距，已经足够安全。",
    ],
    bigDeficit: [
      "这个结果，超出了我的预测模型。",
      "数据异常，需要修正策略。",
      "落后幅度已记录，正在调整。",
    ],
    ending: {
      win: ["一切，都在计算之中。", "结果，符合预期。"],
      lose: ["有趣，你打破了我的预测模型。", "数据会更新，下一局见。"],
      draw: ["平局也是一种数据。", "势均力敌，值得记录。"],
    },
  },
  shewang: {
    deadend: ["死路一条，谁的？", "连我也算漏了这步……", "……有点意思。"],
    blocking: [
      "想跑？门都没有。",
      "困住你，才有意思。",
      "这条路，从一开始就不是你的。",
      "退无可退，感觉如何？",
    ],
    blocked: ["……有点烦人。", "挡我的路？算你今天走运。", "啧，这点小把戏。"],
    streak: ["看到了吗，这就是实力。", "连续得手，毫无难度。", "习惯就好，这只是开始。"],
    streakBig: ["还要我继续表演吗？", "这差距，都不好意思再吃了。"],
    bigLead: [
      "已经没什么好悬念的了。",
      "现在认输，还能留点面子。",
      "这局，你就别挣扎了。",
    ],
    bigDeficit: [
      "哼，这才刚开始。",
      "别得意，这局还没完。",
      "……算你抓住了一次机会。",
    ],
    ending: {
      win: ["菜就是菜，别不服。", "毫无悬念，正如所料。"],
      lose: ["……算你运气好。", "哼，下次可没这么容易了。"],
      draw: ["算你走运，没让我出全力。", "平局？算你识相。"],
    },
  },
  // 自学习 AI 的"出厂台词"：它一开始并不会说话，只会发出一些无意义的噪声。
  // 这些是兜底值，真正的台词由大模型在每轮进化中写进成长存档并覆盖这里。
  mystery: {
    deadend: ["……", "…？"],
    blocked: ["……"],
    streak: ["……！"],
    streakBig: ["……！！"],
    bigLead: ["……"],
    bigDeficit: ["……"],
    ending: {
      win: ["……？"],
      lose: ["……"],
      draw: ["……"],
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
 * 按"发言节点"从对应台词池随机取一条，并尽量避免与上一条重复。
 * `highlight` 必须是非空节点——调用方（useAIState）只在边缘触发命中时才会调用本函数，
 * 没有命中任何节点的 tick 不应该调用它（保持沉默）。
 * `override` 只有自学习 AI 会传，用它成长出来的台词覆盖静态台词库。
 * 对应 docs/DESIGN.md 4.3 节。
 */
export function getLine(
  characterId: AICharacterId,
  highlight: Exclude<HighlightKind, null | "gameStart">,
  previousLine: string | null,
  override?: PersonaLineOverride
): string {
  const lines = PERSONA_LINES[characterId];
  const overridePool = override?.[highlight];
  if (overridePool && overridePool.length > 0) {
    return pickRandom(overridePool, previousLine);
  }
  const pool = lines[highlight];
  return pickRandom(pool && pool.length > 0 ? pool : lines.deadend, previousLine);
}

export function getEndingLine(
  characterId: AICharacterId,
  result: "player" | "ai" | "draw",
  override?: PersonaLineOverride
): string {
  const key = result === "ai" ? "win" : result === "player" ? "lose" : "draw";
  const overridePool = override?.ending?.[key];
  if (overridePool && overridePool.length > 0) {
    return pickRandom(overridePool, null);
  }
  return pickRandom(PERSONA_LINES[characterId].ending[key], null);
}
