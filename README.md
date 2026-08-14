# CyberSnake / 电子蛇战争

在限时竞速中，与会思考、会说话的 AI 蛇一决高下。

一个可直接体验的 Demo + 一套完整的 AI 产品设计文档，主张是：把 AI 能力设计成玩家可感知、有情感连接的游戏体验，而不只是一段跑得动的代码。

## 核心亮点

- **三档 AI 人格，而不是三档数值难度**：小贪（呆萌新手，贪心决策 + 20% 失误率）、老谋（冷静策略家，BFS 安全寻路）、蛇王（阴险嘲讽，BFS + 空间控制 + 压制模式），难度梯度由决策算法本身的能力差异驱动，而不是简单调参。
- **第四位挑战者「？？？」：一个有技能清单的自学习 Agent**。它出厂时是个连话都不会说、开局就撞墙的纯新手。攒够 3 场败绩或平局后，玩家可以在选角页亲手发起一次进化（它连胜时不强制复盘），由 Kimi 依次执行五个技能：**诊断** → **进化**（提出一版策略 DSL）→ **进化测试**（混合对手池 9 局回测）→ **人格**（累积台词与人格档案）→ **记忆整理**。大模型的提案不会被直接采信：跑不赢现役就把每局复盘拿去重新诊断，用未通过原因换一份问题清单再提案，同一轮最多提 3 版。流水线由客户端分步请求、服务端逐步把关。对局中的每一步决策仍由本地纯函数完成。详见 [`docs/DESIGN.md` 第五章](docs/DESIGN.md)。
- **情绪强度状态机**：小贪的慌张度、蛇王的嘲讽值会随局势（比分差、是否濒死）动态变化，同一状态下的台词也会因情绪不同而切换。
- **拳皇式选角页**：进入对局前可预览三档 AI 的头像、称号与代表性台词，鼠标悬停即可"听见"这个角色更多的声音。
- **结算彩蛋台词**：胜/负/平三种结局，AI 都有专属的"心声"台词收尾。
- **决策引擎与人格表达解耦**：`game/ai/*` 只负责"怎么走"，`game/persona/*` 只负责"怎么说"，新增角色只需要在 `roster.ts` 里追加一条记录。

完整设计思路见 [`docs/DESIGN.md`](docs/DESIGN.md)（AI 产品设计）与 [`docs/UI_DESIGN.md`](docs/UI_DESIGN.md)（UI/交互设计），网站内的 [`/about`](/about) 页面也直接渲染了 `DESIGN.md` 全文。

## 技术栈

- [Next.js 16](https://nextjs.org/)（App Router）+ TypeScript + Tailwind CSS v4
- [shadcn/ui](https://ui.shadcn.com/) + [8bitcn/ui](https://www.8bitcn.com/)（像素风组件库，"复制源码到项目"的注册表模式）
- 自托管 `Press Start 2P` 像素字体（`next/font/local`）
- 纯函数式游戏引擎（`src/game/`），不依赖 React，可独立单测/模拟
- 部署目标：腾讯云 [CloudBase 云托管](https://docs.cloudbase.net/recipes/deploy-nextjs-to-cloudbase-run)（国内可访问）；也兼容 [Vercel](https://vercel.com/)

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:3000> 即可体验。

```bash
npm run build   # 生产构建
npm run lint    # ESLint 检查
```

### 环境变量（可选）

只有第四位挑战者「？？？」的进化需要大模型。复制 `.env.local.example` 为 `.env.local` 并填入 Kimi 密钥：

```bash
MOONSHOT_API_KEY=sk-...
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1   # 国际站密钥请改为 https://api.moonshot.ai/v1
MOONSHOT_MODEL=kimi-k2.7-code-highspeed     # 可选，默认即此值
```

两个坑值得先说清楚：

- **基址必须与密钥来源匹配**。国内平台（platform.moonshot.cn）与国际站（platform.moonshot.ai）的密钥互不通用，用错基址会直接返回 `401 Invalid Authentication`。
- **不要用 `kimi-k2.7-code`（无 highspeed）**。实测单次约 80 秒，会把整轮进化拖垮；`kimi-k2.7-code-highspeed` 约 8 秒即可。流水线已拆成多次短请求，单步不再依赖 50 秒总预算。

密钥只在服务端 Route Handler（`src/app/api/ai-reflect`）中读取，不会下发到浏览器；线上部署时配到云托管（或 Vercel）的环境变量即可。**不配置也不影响游戏本身**——这条蛇能正常对战，只是永远停留在新手状态。

## 部署到腾讯云 CloudBase 云托管

国内访问请走云托管容器，不要用静态网站托管（会丢掉 `/api/ai-reflect` 进化接口）。仓库已包含 `output: "standalone"`、`Dockerfile` 和 `.dockerignore`。推荐：**先推到 GitHub，再在云托管里绑定仓库**，之后 `git push` 会自动构建。

### 1. 推到 GitHub

```bash
git push -u origin master
```

仓库需包含根目录的 `Dockerfile`。`.env.local` 已被 gitignore，密钥不会进仓库。

### 2. 在 CloudBase 绑定 GitHub

打开 [云托管控制台](https://tcb.cloud.tencent.com/) → 当前环境 → **云托管** → **新建服务 / 通过 Git 仓库部署**（[官方说明](https://docs.cloudbase.net/run/deploy/deploy/deploying-git)）：

1. 绑定 GitHub 账号（私有仓库必须授权；公开仓库也可填仓库 URL）
2. 选择本仓库、分支 `master`
3. 端口填 `3000`（与 Dockerfile 的 `EXPOSE` / `PORT` 一致）
4. 构建目录留空（仓库根目录）
5. 开通公网访问，并打开 **自动部署**（push 到该分支即重新构建）

### 3. 配置环境变量

部署后到服务设置里加上（改完需发新版本）：

```bash
MOONSHOT_API_KEY=sk-...
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_MODEL=kimi-k2.7-code-highspeed
```

默认域名形如 `https://<服务名>-xxxx.ap-shanghai.app.tcloudbase.com`，浏览器可能先出测试提示页。自己的短域名需要 ICP 备案后再绑到 HTTP 网关。

本地若要验证镜像：

```bash
docker build -t snakebattle:local .
docker run -p 3000:3000 -e MOONSHOT_API_KEY=sk-... snakebattle:local
```

也可用 CLI 直接上传本地代码（不经过 GitHub）：

```bash
npm i -g @cloudbase/cli
tcb login
tcb env list
tcb env use <环境ID>
tcb cloudrun deploy --port 3000
```

## 目录结构

```
docs/                      设计文档（DESIGN.md / UI_DESIGN.md）
scripts/simulate.ts        AI 胜率粗验脚本（npx tsx scripts/simulate.ts [局数]）
scripts/train.ts           自学习 AI 的离线预训练脚本，产出可导入的种子存档
src/
  app/                     四个页面：/ 首页、/select 选角、/play 游戏、/about 设计说明
    api/ai-reflect/        分步进化接口：{step,state,context}，NDJSON 流式推送，密钥不出服务端
  game/
    engine.ts              核心 tick 推进：移动 → 碰撞 → 计分 → 胜负判定
    board.ts                网格/BFS 等纯函数工具
    replay.ts               紧凑对局记录、确定性重放与复盘摘要提取
    simulate.ts             可播种的整局模拟器与混合对手池适应度评估
    ai/
      greedy.ts             小贪：贪心 + 20% 失误
      bfs.ts                老谋：BFS 安全寻路 + 自堵检测
      advanced.ts           蛇王：BFS + 空间控制 + 压制模式
      strategy/             ？？？：策略 DSL（规格 / 特征 / 表达式 / 规则 / 执行器）
      roster.ts             AICharacter 数据结构与四位角色定义
    growth/
      skills/
        types.ts            技能契约与 SKILL_REGISTRY、进化事件类型
        kimi.ts             Kimi 客户端：结构化输出 + 逐级降级重试
        diagnose.ts         技能 1 诊断：根因 / 假设 / 预期效果
        evolve.ts           技能 2 进化：输出完整 StrategySpec + 逐项归因
        verify.ts           技能 3 进化测试：静态护栏 + 混合对手池回测
        persona.ts          技能 4 人格：增量台词 + 人格档案
        memory.ts           技能 5 记忆整理：把历史压缩成长期经验笔记
        pipeline.ts         单步入口 + mergeEvolutionResult；离线训练仍可整轮调用
      evolutionClient.ts    客户端按步消费 NDJSON
      evolutionStore.ts     进化状态机（顺序调度、提案最多 3 次、跨页锁定挑战）
      useMysteryGrowth.ts   对局侧逻辑：只累积对局数据与就绪判定
    persona/
      lines.ts              完整台词库（按角色/发言节点分组，支持动态覆盖）
      emotion.ts             情绪强度状态机
      useAIState.ts          将引擎状态 + 情绪映射为当前台词的 hook
  lib/
    growthStorage.ts        成长存档的类型、校验、导入导出、进化门禁判定
    growthStore.ts          存档的进程内缓存与订阅（useSyncExternalStore）
  components/                棋盘、HUD、AI 肖像面板、选角卡片、结算弹层
```

## AI 胜率粗验

由于没有真实用户数据，`scripts/simulate.ts` 用一个 BFS 策略的"稳健玩家代理"分别对战三档 AI 各 N 局，粗略核对难度梯度是否符合预期（小贪 ≪ 老谋 ≈ 蛇王 ≥ 老谋）：

```bash
npx tsx scripts/simulate.ts 200
npx tsx scripts/simulate.ts 200 --adaptive   # 额外跑一遍自学习 AI 的新手规格
```

## 自学习 AI 的离线预训练

现场演示时不可能真的打上百局，所以 `scripts/train.ts` 会用同一套技能流水线（玩家一方由 BFS 代打，进化事件打到控制台）批量迭代若干轮"模拟 3 局 → 完整进化"，产出一份已经成长过的种子存档，可在选角页的「成长存档 → 导入」里载入：

```bash
$env:MOONSHOT_API_KEY="sk-..."; npx tsx scripts/train.ts 10 growth-seed.json
```
