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
