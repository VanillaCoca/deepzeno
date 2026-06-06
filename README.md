<p align="center">
  <h1 align="center">ZENO</h1>
  <p align="center">
    <strong>A judgment-native AI workspace for long-cycle projects</strong><br/>
    <strong>面向长周期项目的判断原生 AI 工作环境</strong>
  </p>
</p>


<p align="center">
  <img src="https://img.shields.io/badge/status-V1%20In%20Development-yellow" alt="Status" />
  <img src="https://img.shields.io/badge/stack-Next.js%20%2B%20Supabase-blue" alt="Stack" />
  <img src="https://img.shields.io/badge/license-Private-lightgrey" alt="License" />
</p>

---

## What is ZENO? ｜ ZENO 是什么？

ZENO is an AI workspace where project judgment persists across sessions, topics, and AI agents — so the decisions, constraints, and open questions you've already worked through don't have to be reconstructed every time you return.

ZENO 是一个让项目判断跨会话、跨话题、跨 AI agent 持续存在的 AI 工作环境。你已经做过的决策、定下的约束、悬而未决的问题，不必每次回到项目都重新拼装一次。

Unlike normal AI chat tools, ZENO does not treat conversation history as the source of truth. It treats **confirmed judgment** as the durable state of a project. Nothing enters project truth without explicit user confirmation.

不同于普通 AI 聊天工具，ZENO 不把聊天记录当作真相来源。ZENO 把**经过用户确认的判断**作为项目可继承的状态。未经明确确认的内容，不会进入项目真相。

---

## Why ZENO exists ｜ ZENO 为什么存在？

When people use AI in long-cycle projects, the problem is rarely "the model is not smart enough."  
The real problem is that **project judgment does not accumulate**.

在长周期项目中使用 AI 时，真正的问题往往不是"模型不够聪明"，而是**项目判断无法积累**。

Over time:

- context gets buried in chat history  
- prior decisions get forgotten  
- rationale disappears  
- different AI agents start from zero again and again  

随着项目推进：

- 上下文被埋进聊天记录  
- 之前的决策被遗忘  
- 决策依据逐渐消失  
- 不同 AI agent 一次次从零开始  

65% of developers cite missing context as the top cause of poor AI code quality (Stack Overflow 2026). Projects with well-maintained context files see 40% fewer agent errors and 55% faster task completion (Anthropic Agentic Coding Report 2026). People are already solving this manually — maintaining CLAUDE.md files, writing session handoff notes, building 18,000-line PROJECT_JOURNAL systems. ZENO makes this structural, not manual.

65% 的开发者将"缺失上下文"列为 AI 代码质量差的首要原因（Stack Overflow 2026）。维护了完善上下文文件的项目，agent 错误减少 40%，任务完成速度提升 55%（Anthropic Agentic Coding Report 2026）。人们已经在手动解决这个问题——维护 CLAUDE.md 文件、写 session handoff notes、构建 18,000 行的 PROJECT_JOURNAL 系统。ZENO 让这件事变成系统能力，而不是手工劳动。

---

## How it works ｜ 它如何工作？

### 1. Work inside a project, not isolated chats ｜ 在项目里持续工作，而不是孤立对话
Each project has multiple topics. Each topic hosts an ongoing conversation — the **Sandbox** — where you actually think, explore, and decide.

每个项目有多个话题。每个话题承载一段持续的对话——**Sandbox**——你在这里实际思考、探索、做决策。

### 2. Three-stage funnel: Idea → Candidate → Truth ｜ 三段漏斗：想法 → 候选 → 真相
Not every thought is project truth. ZENO uses a three-stage funnel:

并不是每个念头都该成为项目真相。ZENO 采用三段漏斗结构：

- **Idea** — mid-confidence things ZENO has noticed in your conversation but isn't sure are decisions yet. Quietly listed; no action required.  
  **Idea**——ZENO 在对话里识别到、但还不确定是不是决策的中等置信内容。安静地列在那里，不要求行动。

- **Candidate** — high-confidence judgments waiting for your confirmation. From AI inline detection, sweep extraction, or your own `/save`.  
  **Candidate**——高置信度的判断，等你拍板。来源可以是 AI 行内识别、批量扫描提取，或你自己 `/save`。

- **Truth** — confirmed judgments. The durable state of your project. Read-only afterward; changes go through supersede, not edit.  
  **Truth**——已确认的判断。项目的可继承状态。确认后只读，修改通过 supersede（废止并替换），不通过编辑。

### 3. Five extraction mechanisms ｜ 五种提取机制
ZENO captures judgment from your conversation through five mechanisms, ordered by user signal strength:

ZENO 通过五种机制从对话中捕获判断，按用户信号强度排序：

| Mechanism | Trigger | 触发方式 |
|---|---|---|
| `/save` | You select text and save it manually | 你选中文本主动保存 |
| Inline marker | AI marks a clear judgment as it writes | AI 在生成回复时直接标记明确的判断 |
| Sweep on "Explore new idea" | You click "Explore new idea" — primary signal | 你点击"Explore new idea"，最强信号 |
| Safety sweep | Auto-trigger every 20 turns | 每 20 轮对话自动触发兜底 |
| Agent handoff sweep | Before a coding agent reads your truth via MCP | 编程 agent 通过 MCP 读取真相之前 |

The principle is simple: **prefer to miss a judgment than to make one up**. ZENO never auto-writes truth — every candidate requires your explicit confirmation.

原则很简单：**宁可漏掉一个判断，也不杜撰一个**。ZENO 不自动写入真相——每个 candidate 都需要你明确确认。

### 4. Truth panel makes judgment inspectable ｜ 真相面板让判断可检视
The right panel shows your project's confirmed truth as an interactive tree. Two view modes: **By Type** (grouped by goal / decision / constraint / open question) and **By Relation** (organized by dependency chains). Click any node — its full detail (rationale, source, relations) appears in a unified detail pane below. Inspired by Claude Code's single-expansion-area pattern: no modals, no nested panels, just one place where details live.

右侧面板以交互式树展示项目已确认的真相。两种视图模式：**按类型**（按 goal / decision / constraint / open question 分组）和**按关系**（按依赖链组织）。点击任意节点，它的完整详情（依据、来源、关系）会显示在下方统一的 detail 区域。设计灵感来自 Claude Code 的单一展开区模式：没有弹窗，没有嵌套面板，只有一个地方承载所有细节。

### 5. Future sessions inherit truth automatically ｜ 后续会话自动继承真相
Every new conversation in the same project automatically receives the relevant confirmed truth as context. The AI knows what you've decided, what you've rejected, and why — without you pasting anything.

同一项目中的每次新对话，都会自动接收相关的已确认真相作为上下文。AI 知道你决定了什么、否定了什么、为什么——不需要你粘贴任何东西。

### 6. Coding agents read your truth via MCP ｜ 编程 agent 通过 MCP 读取你的真相
When you hand off to a coding agent (Claude Code, Cursor, Codex), ZENO's MCP server gives it the same project truth — read-only. Before the first read, ZENO checks if your conversation has unprocessed turns; if so, it runs a blocking sweep so the agent never acts on stale judgment. **Truth is read-only via MCP**: external agents can propose new candidates, but never write to truth directly.

当你交接给编程 agent（Claude Code、Cursor、Codex）时，ZENO 的 MCP server 把同一份项目真相提供给它——只读。在首次读取前，ZENO 会检查你的对话是否有未处理的轮次；如果有，会先做一次阻塞 sweep，确保 agent 不会基于过期的判断行动。**MCP 通道下，真相只读**：外部 agent 可以提出新 candidate，但不能直接写入真相。

---

## Who ZENO is for ｜ ZENO 适合谁

ZENO V1 is built for **solo founders and independent builders running long-cycle projects with AI**. More precisely: people who are both the judgment owner and the implementer, switching between thinking AI (for product/strategy decisions) and coding AI (for execution).

ZENO V1 是为**用 AI 做长周期项目的 solo founder 和独立构建者**打造的。更精确地说：那些既是判断主体、又是执行者的人——在思考型 AI（做产品/策略决策）和编程型 AI（做实施）之间来回切换。

V1 is not for everyone. It assumes:

V1 不面向所有人。它假设：

- **You take project context seriously.** You already maintain CLAUDE.md / AGENTS.md / handoff notes manually; ZENO automates and structures this.  
  **你认真对待项目上下文。** 你已经在手动维护 CLAUDE.md / AGENTS.md / 交接笔记；ZENO 把这件事自动化、结构化。

- **You are the single judgment owner.** V1 assumes one person makes the calls. Multi-person team coordination is V2.  
  **你是单一判断主体。** V1 假设由一个人拍板。多人团队协作是 V2。

- **You work across multiple AI agents.** Claude, GPT, Gemini for thinking; Claude Code / Cursor / Codex for implementation. ZENO gives them all the same judgment substrate.  
  **你在多个 AI agent 之间切换。** Claude、GPT、Gemini 做思考；Claude Code / Cursor / Codex 做实施。ZENO 给它们提供同一份判断 substrate。

- **Your projects span weeks or months.** Short one-off tasks don't need ZENO.  
  **你的项目以周或月为周期。** 短期一次性任务不需要 ZENO。

---

## V1 scope ｜ V1 范围

### What V1 does ｜ V1 做什么

- Project-scoped AI chat with persistent truth context  
  项目级 AI 对话，带持久化真相上下文
- Five extraction mechanisms with three-stage funnel (Idea → Candidate → Truth)  
  五种提取机制 + 三段漏斗（想法 → 候选 → 真相）
- "Explore new idea" boundary action — main user signal that triggers extraction  
  "Explore new idea"边界动作——触发提取的主要用户信号
- Reactivation Anchor — load any past truth node back into the conversation as active context  
  Reactivation Anchor——将任意过去的真相节点重新加载到当前对话作为活跃上下文
- Truth panel with By Type / By Relation views and unified detail pane  
  真相面板，支持按类型/按关系两种视图，统一的 detail 区
- Git-style immutable history (supersede instead of edit; full time-travel queries)  
  Git 风格的不可变历史（用 supersede 替代编辑；支持完整的时间回溯查询）
- MCP server: 5 read tools + `submit_candidate` (candidate-only writes from external agents)  
  MCP server：5 个读取工具 + `submit_candidate`（外部 agent 只能提交候选，不能写入真相）
- Agent handoff coverage check — blocking sweep before coding agent reads truth  
  Agent handoff coverage check——编程 agent 读取真相前做阻塞 sweep
- Credit-based pricing with flagship thinking models  
  基于信用额度的定价，使用旗舰思考模型

### What V1 does not do ｜ V1 不做什么

- No auto-writing to project truth (every entry requires user confirmation)  
  不自动写入项目真相（每条都需要用户确认）
- No autonomous agents or tool execution inside ZENO  
  ZENO 内部不做自主 agent 或工具执行
- No BYOK (bring your own key) — platform keys only  
  不做 BYOK（自带 API Key）——只用平台 key
- No conversation import — projects start fresh in ZENO  
  不做对话导入——项目从 ZENO 内部开始
- No general-purpose knowledge base — ZENO stores project judgment, not arbitrary notes  
  不做通用知识库——ZENO 存储项目判断，不存任意笔记
- No multi-user collaboration in V1 (single judgment owner; multi-user is V2)  
  V1 不支持多用户协作（单一判断主体；多用户在 V2）
- No mobile UI in V1 (desktop only; mobile in V1.5)  
  V1 不支持移动端（仅桌面；移动端在 V1.5）

---

## Core concepts ｜ 核心概念

### Truth Substrate ｜ 真相 substrate
Project-level confirmed judgment that persists across sessions, AI agents, and tools. Not chat history. Not memory snippets. Structured nodes with kind (goal / constraint / plan / hypothesis / principle / open_question / rejection), status, relations, and rationale. Read-only after confirmation; modifications go through supersede.

跨会话、跨 AI agent、跨工具持续存在的项目级已确认判断。不是聊天记录，不是记忆碎片，而是带有 kind（goal / constraint / plan / hypothesis / principle / open_question / rejection）、状态、关系、依据的结构化节点。确认后只读，修改通过 supersede。

### Sandbox ｜ Sandbox
The chat container under each topic. Where actual thinking and exploration happens. A user can "Explore new idea" to clear the chat and trigger sweep extraction — declaring "I want to switch to a different idea." The cleared conversation is preserved server-side as immutable history; only the visual chat is reset.

每个 topic 下的对话容器。实际的思考和探索在这里发生。用户可以点击"Explore new idea"清空对话并触发批量提取——主动声明"我要切换到另一个想法"。被清空的对话会作为不可变历史保留在服务端，只是视觉上的 chat 被重置。

### Truth Panel ｜ 真相面板
The right-side interface where project judgment becomes inspectable. Vertical 4-zone stack: Ideas (collapsed by default) → Candidates → Truth (main display) → Detail (universal display below a draggable divider). Inspired by Claude Code's single-expansion pattern.

右侧面板，让项目判断变得可检视。垂直 4 区结构：Ideas（默认折叠）→ Candidates → Truth（主显示）→ Detail（统一详情区，由可拖动分隔线分开）。设计灵感来自 Claude Code 的单一展开区模式。

### Reactivation Anchor ｜ Reactivation Anchor
When you load a past truth node into the current conversation, ZENO sets it as the **active context anchor** — the AI knows you're refining or extending this specific judgment. Any new candidates extracted in this session default to having a relation hint pointing at the anchor. After 20 turns, the anchor weakens; loading another node replaces it.

当你把一个过去的真相节点加载到当前对话时，ZENO 会把它设为**活跃上下文锚点**——AI 明白你正在 refine 或延伸这个具体的判断。在这个 session 里提取出的新 candidate 默认会带一个指向锚点的关系提示。20 轮之后锚点会减弱；加载新节点会替换原锚点。

### Inline Reference ｜ 行内引用
When AI generates a response and it judges that the conversation has just produced a clear truth-worthy judgment, it embeds a marker. The marker renders inline in the chat as a clickable reference — blue underlined for active truth, blue dashed pill for pending candidate, gray strikethrough for superseded. Click → open in detail pane.

AI 在生成回复时，如果判断对话刚刚产出了一个清晰的、值得进入真相的判断，就会嵌入一个标记。这个标记在聊天中渲染为可点击的引用——蓝色下划线表示已确认真相，蓝色虚线胶囊表示待确认 candidate，灰色删除线表示已被 supersede。点击 → 在 detail 区打开。

### Core loop ｜ 核心循环
**Sandbox conversation → Extraction (5 mechanisms) → Idea / Candidate funnel → User confirmation → Truth → Inherited by future sessions and agents**

**Sandbox 对话 → 提取（5 种机制）→ Idea / Candidate 漏斗 → 用户确认 → Truth → 被未来的 session 和 agent 继承**

---

## What makes ZENO different ｜ ZENO 的不同之处

Most AI products are built around one of these units:

- chat history  
- prompts  
- documents  
- memory snippets  

大多数 AI 产品，都是围绕以下单位组织的：

- 聊天记录  
- Prompt  
- 文档  
- 记忆碎片  

ZENO is built around a different unit:

ZENO 围绕的是另一种单位：

## **Judgment**

A judgment is not just text.  
It has a kind, a status, a rationale, relations to other judgments, and consequences inside a project.

判断不是一段文本。  
它有 kind、状态、依据、与其他判断的关系，以及在项目中的后续影响。

That is the foundation of judgment continuity across time and agents.

这是判断在时间和 agent 之间持续的基础。

---

## What ZENO is NOT ｜ ZENO 不是什么

- Not a general-purpose chatbot  
  不是通用聊天工具

- Not a tool aggregator or navigation hub  
  不是工具聚合器或导航站

- Not a multi-model shell  
  不是多模型壳子

- Not a one-shot result generator  
  不是一次性结果生成器

- Not a chat history wrapper with "memory" branding  
  不是给聊天记录套一层"记忆"包装的产品

- Not a competitor to coding agents — ZENO **feeds** them, doesn't replace them  
  不是编程 agent 的竞品——ZENO **供给**它们，不替代它们

---

## Design principles ｜ 设计原则

ZENO follows four iron laws that guide every design decision:

ZENO 遵循四条铁律，指导每一个设计决策：

- **Iron Law 1 — Never own execution environment, only judgment.**  
  ZENO does not run code, write files, or do automated tasks. It maintains decision truth. Coding agents do execution; ZENO supplies their context.  
  **铁律 1——永不拥有执行环境，只拥有判断。**  
  ZENO 不运行代码、不写文件、不做自动化任务。它维护决策真相。执行交给编程 agent；ZENO 为它们提供上下文。

- **Iron Law 2 — Prefer to miss than to make up (宁漏勿错).**  
  Trust-preserving recall beats maximum recall. A wrong truth poisons all downstream work; a missed truth can be added later.  
  **铁律 2——宁漏勿错。**  
  保住信任的召回率，胜过最大化召回率。一条错误的真相会污染所有下游工作；漏掉的真相可以以后补上。

- **Iron Law 3 — Don't store raw transcripts, casual preferences, or auto-generated plans as truth.**  
  Truth is what the user explicitly confirms. The boundary between conversation and truth must be sharp.  
  **铁律 3——不把原始转录、随手偏好、自动生成的计划作为真相存储。**  
  真相是用户明确确认的内容。对话和真相之间的边界必须清晰。

- **Iron Law 4 — MCP write is candidate-only; truth read-only.**  
  External coding agents can propose new candidates via MCP, but they can never directly write or modify truth. Only the user can promote a candidate to truth.  
  **铁律 4——MCP 写入只能是 candidate；真相只读。**  
  外部编程 agent 可以通过 MCP 提交新的 candidate，但永远不能直接写入或修改真相。只有用户能把 candidate 提升为真相。

Beyond the iron laws:

铁律之外：

- **Confirmation over automation** — ZENO never auto-writes; the user always reviews.  
  **确认优于自动化**——ZENO 不自动写入；用户始终把关。

- **Project state is the source of truth, not any single conversation.**  
  **项目状态是真相来源，而不是任何单次对话。**

- **Build only what must be built — no unnecessary wheels.**  
  **只造必须造的轮子——不做不必要的依赖。**

---

## Beyond V1 ｜ V1 之后

These features are explicitly NOT in V1, but are part of ZENO's longer-term roadmap. Listed here for context, not commitment.

以下功能明确不在 V1 范围内，但是 ZENO 长期路线图的一部分。在此列出仅作上下文参考，不作承诺。

### Multi-Model @Mentions (V1.5+) ｜ 多模型 @ 调度（V1.5+）
Different AI agents working inside the same project context, reading from the same truth state. `@opus` for deep reasoning, `@gpt54` for breadth. Today, the same effect is partially achieved through MCP — any model with MCP support can read ZENO's truth.

不同的 AI agent 在同一项目上下文内协作，读取同一份真相状态。`@opus` 做深度推理，`@gpt54` 做广度分析。当前通过 MCP 已经能部分实现——任何支持 MCP 的模型都可以读取 ZENO 的真相。

### Council (V2) ｜ Council（V2）
Structured multi-model deliberation on a single judgment. Several agents independently produce their take on a candidate; the user reviews their disagreements before confirming. Built for high-stakes decisions where one model's blind spot matters.

针对单一判断的结构化多模型会审。多个 agent 独立产出各自的看法；用户在确认前审查它们的分歧。为重大决策而设——单个模型的盲点在这种场景下会真的造成问题。

### Multi-user Collaboration (V2-B) ｜ 多人协作（V2-B）
A different product shape than V1. V2-B will support team-level decision substrate where multiple judgment owners co-maintain truth.

与 V1 是不同形态的产品。V2-B 将支持团队级别的判断 substrate，多个判断主体共同维护真相。

---

## Status ｜ 项目状态

🟡 **V1 — In active development**

ZENO V1 has not launched yet.  
The current focus is building the core judgment-continuity loop: Sandbox conversation → 5-mechanism extraction → 3-stage funnel → user confirmation → truth → inherited by future sessions and coding agents.

ZENO V1 尚未发布。  
当前重点是构建核心的判断连续性循环：Sandbox 对话 → 5 种机制提取 → 3 段漏斗 → 用户确认 → 真相 → 被未来的 session 和编程 agent 继承。

---

## Documentation ｜ 文档

| Document | Description ｜ 说明 |
|----------|----------------------|
| [`development-guide.md`](./development-guide.md) | V1 execution plan — phases, tasks, acceptance criteria<br/>V1 执行计划——阶段、任务、验收标准 |
| [`zeno-memory-system-v1_3.md`](./zeno-memory-system-v1_3.md) | Memory system architecture and specification<br/>记忆系统架构与规格 |
| [`ir-extraction.md`](./ir-extraction.md) | IR extraction mechanism — schema, API, triggers, prompts<br/>IR 提取机制——schema、API、触发器、prompt |
| [`ir-ui-interaction.md`](./ir-ui-interaction.md) | UI / UX spec — visual states, interaction flows, components<br/>UI / UX 规格——视觉状态、交互流、组件 |
| [`migrations-setup.md`](./migrations-setup.md) | Supabase migration runbook<br/>Supabase migration 执行手册 |

---

## Tech Stack ｜ 技术栈

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| Database | Supabase (PostgreSQL) |
| AI Integration | Vercel AI SDK |
| Deployment | Vercel |
| External integration | MCP (Model Context Protocol) — read tools + submit_candidate |

---

