import type { AICharacterId, AIDecisionStrategy } from "../types";
import { decideGreedy } from "./greedy";
import { decideBfs } from "./bfs";
import { decideAdvanced } from "./advanced";
import { decideStrategy } from "./strategy";
import { getActiveSpec } from "./mysteryRuntime";

export interface AICharacter {
  id: AICharacterId;
  name: string;
  title: string;
  tagline: string;
  description: string;
  themeColorVar: string; // 对应 globals.css 中定义的 CSS 变量名
  themeColorVarSecondary: string;
  avatarSrc: string;
  decisionStrategy: AIDecisionStrategy;
  /** 用于选角页难度提示条的强度值（0-100），非真实统计胜率 */
  challengeLevel: number;
  expectedPlayerWinRate: string;
}

/**
 * 可扩展的 AI 角色名册（Roster），对应 docs/DESIGN.md 3.5 节。
 * 新增角色只需在此追加一条记录并复用/组合已有决策器，
 * 无需改动决策引擎与页面渲染逻辑。
 */
export const AI_ROSTER: Record<AICharacterId, AICharacter> = {
  xiaotan: {
    id: "xiaotan",
    name: "小贪",
    title: "呆萌新手",
    tagline: "食物！是食物！我要冲过去啦～",
    description: "老实可爱的新手陪练，会把心里想的话直接说出来，偶尔犯迷糊。",
    themeColorVar: "--xiaotan-pink",
    themeColorVarSecondary: "--xiaotan-blue",
    avatarSrc: "/avatars/xiaotan.png",
    decisionStrategy: decideGreedy,
    challengeLevel: 25,
    expectedPlayerWinRate: "~75%",
  },
  laomou: {
    id: "laomou",
    name: "老谋",
    title: "冷静策略家",
    tagline: "路径已计算，前进。",
    description: "会寻路、会算计，移动前先确认自己不会把自己困死。",
    themeColorVar: "--laomou-purple",
    themeColorVarSecondary: "--laomou-blue",
    avatarSrc: "/avatars/laomou.png",
    decisionStrategy: decideBfs,
    challengeLevel: 60,
    expectedPlayerWinRate: "~50%",
  },
  shewang: {
    id: "shewang",
    name: "蛇王",
    title: "阴险嘲讽",
    tagline: "这块地盘，是我的。",
    description: "阴险狡诈，会主动占据关键通道封锁你的去路，语气充满嘲讽。",
    themeColorVar: "--shewang-red",
    themeColorVarSecondary: "--shewang-orange",
    avatarSrc: "/avatars/shewang.png",
    decisionStrategy: decideAdvanced,
    challengeLevel: 90,
    expectedPlayerWinRate: "~30%",
  },
  // 第四位挑战者：name/tagline/challengeLevel 都只是"未觉醒"状态下的占位值，
  // 真正展示给玩家的信息来自成长存档（见 src/lib/growthStorage.ts）。
  mystery: {
    id: "mystery",
    name: "？？？",
    title: "自学习体",
    tagline: "……",
    description: "一条什么都不会的蛇。每局结束后它会复盘自己的失败，然后变得不一样。",
    themeColorVar: "--mystery-green",
    themeColorVarSecondary: "--mystery-teal",
    avatarSrc: "/avatars/mystery.png",
    decisionStrategy: (ctx) => decideStrategy(ctx, getActiveSpec()),
    challengeLevel: 5,
    expectedPlayerWinRate: "未知",
  },
};

export const AI_CHARACTER_IDS: AICharacterId[] = [
  "xiaotan",
  "laomou",
  "shewang",
  "mystery",
];
