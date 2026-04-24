# Zeno V1 — Migration to vercel/chatbot

> **本文件给人看（Sean + Lixian），不是给 Codex 看的。**
> 三个 Phase 文件是给 Codex 执行的。

---

## 重要变更：用 vercel/chatbot，不是 supabase-community 版

原定 fork `supabase-community/vercel-ai-chatbot`。经调研发现该 fork 严重过时：
- Next.js 13（当前主流 15）
- AI SDK v2（当前 v6，API 完全不同）
- `openai-edge` 库（已废弃）
- 无 Drizzle ORM、无 Playwright 测试

**改为 fork `vercel/chatbot`（https://github.com/vercel/chatbot）**，19.6k stars，
Vercel 官方维护，Next.js 15 + AI SDK 6 + Drizzle ORM + 多模型支持。
Supabase Auth 和 Postgres 我们自己加上去——比被困在 Next.js 13 上代价小得多。

---

## 迁移策略

不是代码迁移。现有 Codex demo（A）保留作为参考，在 B 上重新实现。

### 可以直接复用的代码（从现有 repo 复制）

| 文件 | 用途 | 复用方式 |
|------|------|----------|
| `decision-extraction.ts` | 决策提取逻辑 | 核心逻辑不变，适配新的 DB 调用方式 |
| `decision-serializer.ts` | 决策序列化 | 直接复用 |
| `prompting.ts` | 提取 prompt | 直接复用 |
| `tree-panel.ts` | 树面板数据逻辑 | 适配新组件 |
| `json-utils.ts` | 工具函数 | 直接复用 |

### 必须重写的部分（用新 stack 原生方式）

| 原文件 | 原因 | 新方案 |
|--------|------|--------|
| `chat-service.ts` | 手写 streaming，不支持 AI SDK 协议 | 用 AI SDK `useChat` + `streamText` |
| `dashscope.ts` | DashScope 专用 | AI SDK provider（`@ai-sdk/anthropic` 等） |
| `file-store.ts` | 文件存储 | Supabase Postgres |
| `workspace-service.ts` | 本地 workspace 管理 | Supabase tables + RLS |
| `local-mode.ts` | 本地运行模式 | 不需要，Vercel 部署 |

### 不需要迁移的

| 原文件 | 原因 |
|--------|------|
| `debug-log.ts` | 开发调试用，新 stack 有自己的 |
| `runtime-debug.ndjson` | 调试数据 |
| `env.ts` | 会重写 |

---

## 三阶段执行计划

### Phase 1: 搭壳 + 聊天跑通
**文件**: `phase-1-scaffold.md`
**目标**: Fork → Supabase Auth → 三栏布局 → 流式聊天正常 → 数据库 schema 建好
**验收人**: Sean
**验收标准**: 能登录，能聊天，流式输出不卡不乱滚，三栏布局正确
**预计时间**: 2-3 天

### Phase 2: 决策系统 + 提取管道
**文件**: `phase-2-decision-system.md`
**目标**: 完整的决策循环——聊天→提取→候选确认→树面板→context 注入
**验收人**: Sean
**验收标准**: 对话中做出一个决策→自动提取→确认→下次对话时模型知道这个决策
**预计时间**: 5-7 天

### Phase 3: 交互打磨
**文件**: `phase-3-interaction-polish.md`
**目标**: 侧边栏完整实现、sandbox 导航、滚动行为、动画、过渡效果
**验收人**: Sean（这个阶段会有多轮反馈）
**验收标准**: 产品可以拿去给投资人和用户演示
**预计时间**: 5-7 天

---

## Lixian 的工作流程

1. Fork `vercel/chatbot` 到 ESSENTIC 的 GitHub org。
2. 把 Phase 1 文件丢给 Codex，让它在这个 fork 上执行。
3. 跑起来后通知 Sean 验收。
4. Sean 验收通过 → 进入 Phase 2。有反馈 → 修改后重新验收。
5. 重复直到 Phase 3 完成。

**每个 Phase 只给 Codex 看对应的那一个文件。** 不要一次性给三个。

---

## 给 Codex 的上下文提示

如果 Codex 对 vercel/chatbot 的结构不熟悉，可以在 task prompt 里加一行：

```
Read the existing codebase first. Pay attention to:
- app/ directory structure (Next.js App Router)
- lib/ai/ (model configuration)
- lib/db/ (Drizzle ORM schema)
- components/ (UI components using shadcn/ui)
```

Codex 在 repo 内工作时会自动读到这些文件，不需要额外喂。

---

## 现有 demo（A）的处理

保留不动。它的用途：
- Sean 截图/录屏作为交互参考
- 提取 prompt 和序列化逻辑的代码直接复制
- 对比 A 和 B 的体验差异，验证迁移决策是否正确

不要在 A 上继续开发新功能。
