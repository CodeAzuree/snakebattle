import { FEATURE_LABELS, type FeatureKey, type PathMode, type StrategySpec } from "@/game/ai/strategy";
import type { PersonaLineOverride } from "@/game/persona/lines";
import {
  DEFAULT_MYSTERY_NAME,
  LINE_MAX_LENGTH,
  MAX_LINES_PER_POOL,
  NAME_MAX_LENGTH,
  TAGLINE_MAX_LENGTH,
  languageCompleteness,
  sanitizeLines,
  sanitizeName,
  sanitizePersonaProfile,
  sanitizeTagline,
  type GrowthState,
} from "@/lib/growthStorage";
import { GAME_BACKGROUND, outputShape, truncate } from "./context";
import { callKimiJson } from "./kimi";
import { describeSkill, type PersonaUpdate, type SkillContext } from "./types";

const LINE_POOL_SCHEMA = { type: "array", items: { type: "string" } } as const;

/** 「第 3 代 · 」这样的前缀，代数由代码拼，模型只负责阶段名本身 */
const STAGE_PREFIX = /^第\s*\d+\s*代\s*·\s*/;

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    tagline: { type: "string" },
    growthStage: { type: "string" },
    selfReport: { type: "string" },
    personaProfile: {
      type: "object",
      properties: {
        voice: { type: "string" },
        quirks: { type: "string" },
        selfImage: { type: "string" },
        attitude: { type: "string" },
      },
      required: ["voice", "quirks", "selfImage", "attitude"],
      additionalProperties: false,
    },
    lines: {
      type: "object",
      properties: {
        deadend: LINE_POOL_SCHEMA,
        blocked: LINE_POOL_SCHEMA,
        blocking: LINE_POOL_SCHEMA,
        streak: LINE_POOL_SCHEMA,
        streakBig: LINE_POOL_SCHEMA,
        bigLead: LINE_POOL_SCHEMA,
        bigDeficit: LINE_POOL_SCHEMA,
        ending: {
          type: "object",
          properties: {
            win: LINE_POOL_SCHEMA,
            lose: LINE_POOL_SCHEMA,
            draw: LINE_POOL_SCHEMA,
          },
          required: ["win", "lose", "draw"],
          additionalProperties: false,
        },
      },
      required: [
        "deadend",
        "blocked",
        "blocking",
        "streak",
        "streakBig",
        "bigLead",
        "bigDeficit",
        "ending",
      ],
      additionalProperties: false,
    },
  },
  required: ["name", "tagline", "growthStage", "selfReport", "personaProfile", "lines"],
  additionalProperties: false,
} as const;

export type { PersonaUpdate };

/**
 * 单轮每个场景最多新增的句子数。
 *
 * 池上限是 6，如果允许一轮就写满，模型会一次性倒出六句同义改写把池占死，
 * 之后再想加更有个性的句子已经没位置了。限量能逼它每轮只挑最好的两句。
 */
const MAX_NEW_LINES_PER_ROUND = 2;

/** 结果区那句自述的长度上限：再长就不像一句话，而像一段说明 */
export const SELF_REPORT_MAX_LENGTH = 80;

const LINE_POOL_FIELDS = [
  "deadend",
  "blocked",
  "blocking",
  "streak",
  "streakBig",
  "bigLead",
  "bigDeficit",
] as const;

const ENDING_FIELDS = ["win", "lose", "draw"] as const;

function capNewLines(lines: PersonaLineOverride, max: number): PersonaLineOverride {
  const capped: PersonaLineOverride = {};
  for (const field of LINE_POOL_FIELDS) {
    const pool = lines[field];
    if (pool && pool.length > 0) capped[field] = pool.slice(0, max);
  }
  const ending: NonNullable<PersonaLineOverride["ending"]> = {};
  for (const field of ENDING_FIELDS) {
    const pool = lines.ending?.[field];
    if (pool && pool.length > 0) ending[field] = pool.slice(0, max);
  }
  if (Object.keys(ending).length > 0) capped.ending = ending;
  return capped;
}

/** 取一句本轮新增的台词用于进化日志：比"台词库已更新"这种播报有意思得多 */
function firstNewLine(lines: PersonaLineOverride): string | null {
  for (const field of LINE_POOL_FIELDS) {
    const pool = lines[field];
    if (pool && pool.length > 0) return pool[0];
  }
  for (const field of ENDING_FIELDS) {
    const pool = lines.ending?.[field];
    if (pool && pool.length > 0) return pool[0];
  }
  return null;
}

export interface PersonaInput {
  effectiveChanges: string[];
  accepted: boolean;
  /** 本轮结束后的目标代数，避免阶段名与代数错位 */
  generation: number;
}

const PATH_PERSONA: Record<PathMode, string> = {
  greedy: "看见食物就直冲，不看路——像个还没学会思考就先动起来的东西",
  bfsShortest: "永远走最短路——效率至上，讨厌绕远，也讨厌废话",
  bfsSafest: "靠近食物前先确认退路——什么都要留一手，谨慎到有点啰嗦",
  spaceFill: "先把地盘摊开再谈吃——沉得住气，喜欢慢慢收网",
  tailChase: "绕着自己的尾巴打转——靠耗，等对手先犯错",
};

/**
 * 打法侧写：把策略规格翻译成「这条蛇是个什么脾气的东西」。
 *
 * 人格越进化越没个性，根因不在措辞而在输入——每轮喂给人格模块的信息几乎一样，
 * 模型只能反复写出同一种腔调。这里让人格的种子直接长在它自己的策略上：
 * 走位变了，声音就该跟着变，玩家也能反过来从台词猜出它怎么打。
 */
export function describePlaystyle(spec: StrategySpec): string[] {
  const traits = [PATH_PERSONA[spec.pathMode]];
  const w = spec.weights;

  if (w.opponentBlock >= 0.6) traits.push("会主动去堵玩家的路：语气里带压迫感，眼里有对手");
  else if (w.opponentDistance >= 0.6) traits.push("刻意躲开玩家：疏离，只关心自己那半张图");

  if (spec.mistakeProbability >= 0.2) traits.push("每几步就会抽一下：说话容易断线、突然跑题");
  else if (spec.mistakeProbability <= 0.05) traits.push("几乎不出错：稳得不太像有情绪的东西");

  const safety = spec.safety;
  if (safety.avoidImmediateDeath && safety.requireEscapeRoute && safety.tailSafety) {
    traits.push("三道保险全开、还留出余量：惜命，句子里全是前提和条件");
  } else if (!safety.avoidImmediateDeath) {
    traits.push("连「会不会立刻撞死」都不检查：莽，不把死当回事");
  }

  // 用相对排序而不是固定阈值：出厂权重里 foodProximity 就是 1，
  // 按阈值判断的话「对食物有执念」会对每一条蛇都成立，等于没说
  const ranked = Object.entries(w)
    .filter(([, value]) => value !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const cares = ranked
    .filter(([, value]) => value > 0)
    .slice(0, 2)
    .map(([key]) => FEATURE_LABELS[key as FeatureKey]);
  if (cares.length > 0) traits.push(`它眼里最重要的是：${cares.join("、")}`);
  const avoids = ranked.filter(([, value]) => value <= -0.5).map(([key]) => FEATURE_LABELS[key as FeatureKey]);
  if (avoids.length > 0) traits.push(`它在明确回避：${avoids.slice(0, 2).join("、")}`);

  if (spec.rules.length >= 3) traits.push("脑子里挂着一张守则表：说话像在念条款");
  if (spec.scoreExpression) traits.push("自己写了一条打分公式：会用数字和算式说话");

  return traits;
}

type NameTier = "silent" | "first" | "shaped" | "mature";

function nameTier(generation: number): NameTier {
  if (generation <= 1) return "silent";
  if (generation <= 3) return "first";
  if (generation <= 6) return "shaped";
  return "mature";
}

/**
 * 打法是否真的换了。
 *
 * 之前用「代数 + 大跃迁」当开锁条件，而代数只在提案被采纳且策略真的改了时才 +1，
 * 于是一进平台期就永久冻结在低档、再也不会改名。改用真实的规格位移来判断：
 * 换了寻路模式，或一次改了三项以上，就算它换了一套打法。
 */
export function styleShifted(input: PersonaInput): boolean {
  if (!input.accepted) return false;
  if (input.effectiveChanges.some((change) => change.startsWith("寻路 "))) return true;
  return input.effectiveChanges.length >= 3;
}

/** 还叫「？？？」且这轮有实质进步：这一轮必须给自己起名，不给就算模型这次失败 */
export function mustRename(state: GrowthState, input: PersonaInput, tier: NameTier): boolean {
  return (
    tier !== "silent" &&
    state.name === DEFAULT_MYSTERY_NAME &&
    input.accepted &&
    input.effectiveChanges.length > 0
  );
}

/** 各档允许的名字形态：档位只管长度和结构，改不改名由打法位移决定 */
const NAME_SHAPE_BY_TIER: Record<Exclude<NameTier, "silent">, string> = {
  first: "1-2 字，要能印在选角卡上当对手名喊出来。用蛇的动作或身体：吞、盘、绞、缠、窜、噬、鳞。不要用格、线、噪这种零件名。",
  shaped: "2-4 字，动作咬住对象：吞格、盘墙、绞尾、抢豆、堵口、贴鳞。听起来仍是一条蛇，不是一句说明。",
  mature: `3-${NAME_MAX_LENGTH} 字，仍是选角卡上的一个名字，例如「通道绞」「死角盘」「抢豆的吞」。不要写成「会转弯的线」「贴着墙的那段」「第三格之后」这种描述句。`,
};

/**
 * 起名规则。
 *
 * 两条硬约束：一是名字要能对上它现在的打法，别写成一个和走位无关的好听词；
 * 二是改名要从上一代的名字里长出来（保留字根或音），否则每轮换一个毫不相干的名字，
 * 看起来是随机而不是成长。改名依然稀缺，但闸门是真实的打法变化而不是代数。
 */
export function namingRule(state: GrowthState, input: PersonaInput, tier: NameTier): string {
  if (tier === "silent") {
    return `- 名字：保持「${state.name}」不变。它还没资格给自己命名。`;
  }

  const playstyle = describePlaystyle(state.spec).slice(0, 2);
  const styleLines = playstyle.map((trait) => `  · ${trait}`);

  if (mustRename(state, input, tier)) {
    return [
      "- 名字：它已经有实质进步，**必须**给自己起第一个名字，不要再叫「？？？」。",
      `  这是它给自己安上的对手名，${NAME_SHAPE_BY_TIER[tier]}。`,
      "  名字要能体现下面这套打法：直冲的叫吞/噬，堵人的叫盘/绞，绕圈子的叫缠/尾。",
      ...styleLines,
      "  不要用「小X」「老X」「X王」这种和其他角色同构的命名，也不要叫「进化体」「智能蛇」这类类别词。",
      "  不要起得像人名、像诗、像产品型号，也不要起得像棋盘零件（线、格、噪、回路）。",
    ].join("\n");
  }

  if (styleShifted(input)) {
    return [
      `- 名字：这轮它的打法真的变了，可以给自己改一个名字：${NAME_SHAPE_BY_TIER[tier]}。`,
      `  必须保留「${state.name}」的字或音，让人看得出还是同一条蛇，不是换了一个。`,
      "  新名字要对应新打法——从谨慎变成堵人，名字就该从贴鳞变成盘、绞：",
      ...styleLines,
      "  不要起得像人名、像诗、像产品型号，也不要起得像棋盘零件。",
    ].join("\n");
  }

  return `- 名字：保持「${state.name}」。它这轮的打法没有实质变化，改名要留给真正换了打法的时候。`;
}

const TONE_BY_TIER: Record<NameTier, string> = {
  silent: "它几乎还不会说话：以「……」「…？」这类噪声和残句为主，最多蹦出一两个词，不要出现完整的复句。",
  first: "它刚学会说话：短句、断续、用词具体而笨拙，会重复自己刚学会的棋盘词。绝不能说大话。",
  shaped: "它说话开始成句：能描述自己看到的东西（格子、墙、通道、尾巴、剩余时间、分差），但仍不圆滑。",
  mature: "它已经能自如表达：可以有克制的锋利、冷幽默或自我审视，但依然是一条还在格子里爬的程序在自言自语，不要变成人类嘴替。",
};

function buildSystemPrompt(state: GrowthState, input: PersonaInput, tier: NameTier): string {
  return [
    "你是一条贪吃蛇 AI 的「人格模块」。",
    GAME_BACKGROUND,
    "",
    "【它是谁】它是这局唯一一个没有预设人设的对手：一段会自己改写自己的程序。",
    "它出厂时叫「？？？」，只会发出「……」这样的噪声，之后每一次真正变强，才多学会一点表达。",
    "你这一步只写人格，不碰任何策略字段。",
    "",
    "【它活在什么世界】",
    "它是 20×20 霓虹格子里的一条像素蛇，和玩家抢豆子、抢通道。选角页上它和「小贪」「老谋」「蛇王」排在一起，名字必须听起来也是一条能对打的蛇，而不是一句诗、一个零件名、一段程序注释。",
    "它不是人、不是诗人、不是通用聊天机器人。",
    "不要用人类名字、诗词意象、修仙/觉醒腔，也不要用量子、神经网络、赛博神明这类科幻黑话。",
    "",
    "【必须避开的三种声音】同场还有三个手工设计的角色，它们已经各自占住了一种腔调，你不能撞：",
    "- 小贪：天真呆萌、叠字、感叹号（「食物！是食物！我要冲过去啦～」）",
    "- 老谋：冷静术语、陈述句、毫无情绪（「路径已计算，前进。」）",
    "- 蛇王：居高临下的嘲讽与挑衅（「这块地盘，是我的。」）",
    "它们是在扮演角色，而它不是——它是**在自述**：像一段日志、一次自言自语、一个正在确认自己存在的东西。",
    "",
    "【人格必须由打法长出来】",
    "下面会给出它当前的打法侧写。人格是这套打法的人声化：",
    "玩家应该能从它的台词里反推出它怎么走位。惜命的蛇说话带前提，堵人的蛇说话有压迫感，",
    "老抽风的蛇说话会断线。不要写一套和打法无关的通用感想。",
    "",
    "【人格档案】四个字段各不超过 60 字，已有内容只做推进、不要推翻重写：",
    "- voice：声音质感——句子长短、语速、标点习惯、用不用术语。",
    "- quirks：**可复现的具体口癖**，不是形容词。合格的是「句尾常带一个数字」「自称『这截』」「用『……』做停顿」；",
    "  不合格的是「说话很谨慎」这种没法照着写句子的描述。台词里必须真的用上它。",
    "- selfImage：它认为自己是什么——必须是一条蛇或一截身子，不要写成一段抽象程序。",
    "- attitude：它怎么看待玩家（对手？观察对象？让它变成这样的原因？）。",
    "",
    "【台词】",
    "- 只输出本轮要新增的句子。已经够用的场景给空数组 []，系统会把新句子合并进旧库而不是整包替换。",
    `- 每条不超过 ${LINE_MAX_LENGTH} 字，每个场景最多 ${MAX_LINES_PER_POOL} 条，本轮每个场景最多新增 2 条。`,
    "- 新句子必须提供现有台词还没有的角度，不许是同义改写或只改标点。",
    "- 句子要落在具体的棋盘事实上，优先用这些词：格子、墙、尾巴、通道、死角、豆子、信号、噪声、回路、这一格、贴边。",
    "  不要写「我会变强」「下次一定」「加油」「命运」「灵魂」这种离开棋盘也能成立的空话。",
    `- 语气分档：${TONE_BY_TIER[tier]}`,
    "",
    "【自述】selfReport 是它在进化结束后对玩家说的一句话，会原样显示在实验室结果区：",
    `- 第一人称、1-2 句、不超过 ${SELF_REPORT_MAX_LENGTH} 字。`,
    "- 只说这一轮的具体事实：换了怎么走、试了几版都没过、什么都没改成。",
    "- **不许**出现 pathMode、weights、权重、适应度、回测、提案、规格这类词，它不是在念报告。",
    "- 也**不许**照搬改动清单里的参数数值（「调到 1.5」「压到 0.01」都不行），",
    "  要翻译成玩家看得见的动作：「我现在会先把路堵上」「我不再绕远了」。",
    `- 语气服从上面的分档：${TONE_BY_TIER[tier]}`,
    "",
    `【长度上限】名字 ${NAME_MAX_LENGTH} 字，标语 ${TAGLINE_MAX_LENGTH} 字，阶段名 10 字。`,
    namingRule(state, input, tier),
    "- 标语：选角页上它对玩家说的那一句，要像一条蛇在宣战，一眼能看出打法，不要写成广告口号或程序日志。",
    "- 阶段名：只写阶段名本身（例如「学会看路」「开始留后手」），**不要**带「第 N 代」，系统会自己拼。",
    "  用大白话描述它现在会什么，不要用「觉醒」「进化」这类抽象词。",
    "",
    "场景含义：deadend 无路可走 / blocked 被玩家挡住 / blocking 主动封锁玩家 /",
    "streak 连吃 / streakBig 大连吃 / bigLead 大幅领先 / bigDeficit 大幅落后 / ending 结算。",
    "",
    "【输出格式】只输出 JSON，且必须严格照这个结构，键名一个字都不能改：",
    outputShape(SCHEMA),
  ].join("\n");
}

function buildUserPrompt(state: GrowthState, input: PersonaInput): string {
  const completeness = languageCompleteness(state);
  const stageName = state.growthStage.replace(/^第\s*\d+\s*代\s*·\s*/, "");
  return [
    `【当前身份】名字：${state.name}；标语：${state.tagline}；阶段：${stageName}；目标代数：第 ${input.generation} 代。`,
    `【本轮进化结果】${input.accepted ? "策略提案通过了回测并已上线" : "策略提案被回测否决，能力没有变化"}`,
    `【真正生效的变化】${input.effectiveChanges.length > 0 ? input.effectiveChanges.join("；") : "无"}`,
    "【它现在的打法侧写】",
    ...describePlaystyle(state.spec).map((trait) => `- ${trait}`),
    `【人格档案】${JSON.stringify(state.personaProfile)}`,
    `【现有台词】${JSON.stringify(state.lines)}`,
    `【台词场面完整度】${completeness.filled}/${completeness.total}`,
    "",
    "请让人格朝打法侧写的方向再推进一步。空数组表示该场景本轮不新增。",
    "这一轮只在一个维度上加深：要么固化一个口癖，要么换一种称呼玩家的方式，要么推进一次自我认知——不要三样一起换。",
    "如果这轮没有实质进步，台词可以体现挫败、困惑或对自己的怀疑，但不要凭空吹嘘。",
  ].join("\n");
}

/**
 * 人格技能：刻意排在进化测试之后。
 * 台词只输出本轮增量，由调用方用 mergePersonaLines 累积进旧库。
 */
export async function runPersona(
  state: GrowthState,
  input: PersonaInput,
  ctx: SkillContext
): Promise<PersonaUpdate> {
  const skill = describeSkill("persona");
  const tier = nameTier(input.generation);
  const renameRequired = mustRename(state, input, tier);

  const stream = ctx.stream("persona");
  stream(`它现在的样子：${describePlaystyle(state.spec).join("；")}\n`);

  const raw = await callKimiJson<{
    name?: unknown;
    tagline?: unknown;
    growthStage?: unknown;
    selfReport?: unknown;
    personaProfile?: unknown;
    lines?: unknown;
  }>({
    apiKey: ctx.apiKey,
    model: ctx.model,
    system: buildSystemPrompt(state, input, tier),
    user: buildUserPrompt(state, input),
    schemaName: "snake_persona",
    schema: SCHEMA,
    timeoutMs: Math.min(skill.budgetMs, Math.max(5_000, ctx.remainingMs())),
    signal: ctx.signal,
    temperature: 0.9,
    onDelta: stream,
    validate: (value) => {
      const raw = value as { name?: unknown; personaProfile?: unknown; lines?: unknown };
      // 必须命名这一轮，模型不给名字就按失败重试：以前只发一条「下一轮再催」的 note，
      // 等于放行，于是它可以永远叫「？？？」
      if (renameRequired) {
        const name = typeof raw?.name === "string" ? raw.name.trim() : "";
        if (name.length === 0 || name === DEFAULT_MYSTERY_NAME) return false;
      }
      return Boolean(raw?.personaProfile) || Boolean(raw?.lines);
    },
  });

  // 阶段名统一由代码拼代数：模型时不时会自己带上"第 N 代"，直接用会拼成"第 4 代 · 第 3 代 · 初醒"
  const previousStage = state.growthStage.replace(STAGE_PREFIX, "");
  const stageName = truncate(raw.growthStage, 12).replace(STAGE_PREFIX, "") || previousStage;

  const update: PersonaUpdate = {
    name: sanitizeName(raw.name, state.name),
    tagline: sanitizeTagline(raw.tagline, state.tagline),
    growthStage: `第 ${input.generation} 代 · ${stageName}`,
    selfReport: truncate(raw.selfReport, SELF_REPORT_MAX_LENGTH),
    personaProfile: sanitizePersonaProfile(raw.personaProfile, state.personaProfile),
    lines: capNewLines(sanitizeLines(raw.lines), MAX_NEW_LINES_PER_ROUND),
  };

  if (update.name !== state.name) {
    ctx.emit({ type: "note", skill: "persona", text: `它给自己改名为「${update.name}」。` });
  }
  if (update.personaProfile.quirks && update.personaProfile.quirks !== state.personaProfile.quirks) {
    ctx.emit({ type: "note", skill: "persona", text: `口癖：${update.personaProfile.quirks}` });
  }
  if (update.personaProfile.voice && update.personaProfile.voice !== state.personaProfile.voice) {
    ctx.emit({ type: "note", skill: "persona", text: `声线：${update.personaProfile.voice}` });
  }
  const sample = firstNewLine(update.lines);
  if (sample) {
    ctx.emit({ type: "note", skill: "persona", text: `新学会的话：「${sample}」` });
  }
  return update;
}
