# CyberSnake / 电子蛇战争

在限时竞速中，与会思考、会说话的 AI 蛇一决高下。

这是一份 **AI 产品经理（游戏行业）** 岗位的求职作品：一个可直接体验的 Demo + 一套完整的 AI 产品设计文档，用来证明"把 AI 能力设计成玩家可感知、有情感连接的游戏体验"的产品设计能力，而不只是一段跑得动的代码。

## 核心亮点

- **三档 AI 人格，而不是三档数值难度**：小贪（呆萌新手，贪心决策 + 20% 失误率）、老谋（冷静策略家，BFS 安全寻路）、蛇王（阴险嘲讽，BFS + 空间控制 + 压制模式），难度梯度由决策算法本身的能力差异驱动，而不是简单调参。
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
- 部署目标：[Vercel](https://vercel.com/)

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

## 目录结构

```
docs/                      设计文档（DESIGN.md / UI_DESIGN.md）
scripts/simulate.ts        AI 胜率粗验脚本（npx tsx scripts/simulate.ts [局数]）
src/
  app/                     四个页面：/ 首页、/select 选角、/play 游戏、/about 设计说明
  game/
    engine.ts              核心 tick 推进：移动 → 碰撞 → 计分 → 胜负判定
    board.ts                网格/BFS 等纯函数工具
    ai/
      greedy.ts             小贪：贪心 + 20% 失误
      bfs.ts                老谋：BFS 安全寻路 + 自堵检测
      advanced.ts           蛇王：BFS + 空间控制 + 压制模式
      roster.ts             AICharacter 数据结构与三档角色定义
    persona/
      lines.ts              完整台词库（按角色/状态/情绪分组）
      emotion.ts             情绪强度状态机
      useAIState.ts          将引擎状态 + 情绪映射为当前台词的 hook
  components/                棋盘、HUD、AI 肖像面板、选角卡片、结算弹层
```

## AI 胜率粗验

由于没有真实用户数据，`scripts/simulate.ts` 用一个 BFS 策略的"稳健玩家代理"分别对战三档 AI 各 N 局，粗略核对难度梯度是否符合预期（小贪 ≪ 老谋 ≈ 蛇王 ≥ 老谋）：

```bash
npx tsx scripts/simulate.ts 200
```
