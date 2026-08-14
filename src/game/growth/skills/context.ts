import {
  FEATURE_LABELS,
  PATH_MODE_LABELS,
  RULE_ACTION_LABELS,
  type StrategySpec,
} from "@/game/ai/strategy";
import type { MatchSummary } from "@/game/replay";
import type { GrowthState } from "@/lib/growthStorage";

/**
 * 所有技能共享的背景说明。抽出来集中维护，是为了让「诊断」「进化」「人格」
 * 三个技能对同一局游戏的理解完全一致，不会各说各话。
 */
export const GAME_BACKGROUND = [
  "【游戏背景】20x20 网格，你控制的蛇与人类玩家限时 120 秒同场竞速，抢同一颗食物。",
  "吃到食物加一分并变长，撞墙或撞到任意蛇身即出局。时间耗尽时分高者胜。",
  "你出厂时什么都不会：不看路、半数步数随机乱走、只会朝食物直冲，所以经常几秒就撞死。",
].join("\n");

/** 策略手册：模型必须读懂 DSL 才能在算法层面提意见，而不是只拧几个标量 */
export function strategyManual(): string {
  return [
    "【策略规格 StrategySpec】你不能写可执行代码，只能改这份声明式结构：",
    "- pathMode：主寻路算法。greedy 贪心直冲 / bfsShortest BFS 最短路取食 / bfsSafest 在空间最大的方向里靠近食物 / spaceFill 最大化可达空间 / tailChase 追自己的尾巴。",
    "- weights：九个特征的打分权重，每项 -2 ~ 2。foodProximity 离食物近、reachableArea 可达空间、tailReachable 移动后能否回到尾巴、corridorWidth 通道宽度、opponentBlock 封锁对手、opponentDistance 与对手距离、wallDistance 离墙距离、foodRace 抢食领先、directionInertia 保持原方向。",
    "- scoreExpression：可选。一段只用特征名、数字、+ - * / ( ) 与 min/max/clamp/abs 的打分公式，合法时优先于 weights。非法公式会被丢弃。",
    "- rules：最多 5 条有序规则。when.kind 为 always / areaBelow / lengthAbove / opponentCloserToFoodBy / scoreDeficitAbove / scoreLeadAbove / timeRemainingBelowSec / opponentHeadWithin，then 为 chaseFood / surviveFirst / chaseTail / blockOpponent / retreatToOpenSpace / hugWall。先匹配先生效。",
    "- safety：avoidImmediateDeath 过滤立刻撞死的方向；requireEscapeRoute 要求移动后空间够用；tailSafety 要求还能回到尾巴；minAreaMargin 0~6。",
    "- mistakeProbability：0~0.5，每步随机乱走的概率。",
    "- notes：写给下一轮自己看的备注，不超过 120 字。",
    "",
    "单轮改动上限：寻路模式最多改 1 次、权重最多改 3 项、规则最多改 2 条。改太多会被测试直接判不合格。",
  ].join("\n");
}

export function compactSummary(summary: MatchSummary) {
  return {
    结果: summary.result === "ai" ? "我赢" : summary.result === "player" ? "玩家赢" : "平局",
    存活秒数: summary.durationSec,
    比分: `我 ${summary.aiScore} : 玩家 ${summary.playerScore}`,
    死因: summary.aiDeath,
    是否开局送死: summary.earlyDeath,
    本可避免的死亡: summary.avoidableDeath ?? false,
    死亡现场: summary.deathContext,
    最长连吃: summary.aiMaxStreak,
    无路可走帧数: summary.aiDeadendTicks,
    内部状态占比: summary.aiStateRatio,
    离食物平均距离: summary.aiAvgDistanceToFood,
    转向频率: summary.aiTurnRate,
    浪费转向: summary.wastedTurns,
    平均空间占比: summary.spaceAvgRatio,
    抢食记录: (summary.foodContests ?? []).slice(-6),
  };
}

export function identityBlock(state: GrowthState): string {
  const lines = [
    `【当前身份】名字：${state.name}；标语：${state.tagline}；阶段：${state.growthStage}；已进化 ${state.generation} 次；累计对战 ${state.matchCount} 局。`,
    `【现役策略】${JSON.stringify(summarizeSpec(state.spec))}`,
    `【现役回测适应度】${state.bestFitness ?? "尚未测量"}`,
  ];
  if (state.experienceNotes) {
    lines.push(`【长期经验笔记】${state.experienceNotes}`);
  }
  const profile = state.personaProfile;
  if (profile.voice || profile.quirks || profile.selfImage || profile.attitude) {
    lines.push(`【人格档案】${JSON.stringify(profile)}`);
  }
  return lines.join("\n");
}

export function summarizeSpec(spec: StrategySpec) {
  const activeWeights = Object.entries(spec.weights).filter(([, value]) => value !== 0);
  return {
    寻路: PATH_MODE_LABELS[spec.pathMode],
    权重: Object.fromEntries(
      activeWeights.map(([key, value]) => [FEATURE_LABELS[key as keyof typeof FEATURE_LABELS] ?? key, value])
    ),
    公式: spec.scoreExpression,
    规则: spec.rules.map(
      (rule) =>
        `${rule.when.kind}(${rule.when.value})→${RULE_ACTION_LABELS[rule.then]}`
    ),
    安全: spec.safety,
    失误率: spec.mistakeProbability,
    备注: spec.notes,
  };
}

export function truncate(text: unknown, max: number): string {
  return typeof text === "string" ? text.trim().slice(0, max) : "";
}

interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
}

function skeleton(node: JsonSchemaNode): unknown {
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  if (type === "object") {
    const shape: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      shape[key] = skeleton(child);
    }
    return shape;
  }
  if (type === "array") return [node.items ? skeleton(node.items) : ""];
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}

/**
 * 把 JSON Schema 渲染成一份空骨架，直接贴进提示词。
 *
 * `kimi-k*` 走的是 json_object，服务端不校验结构，而提示词里如果只描述字段含义、
 * 不给出顶层键名，模型就会自己编一套外壳（实测把 problems 写成 issues）。
 * 键名对不上时 sanitize 会静默回落到现役值，表现就是"进化生效但什么都没变"。
 * 骨架由 schema 生成，保证提示词和解析逻辑不会各自漂移。
 */
export function outputShape(schema: object): string {
  return JSON.stringify(skeleton(schema as JsonSchemaNode));
}
