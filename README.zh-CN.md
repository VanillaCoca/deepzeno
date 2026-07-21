<p align="center">
  <h1 align="center">ZENO</h1>
  <p align="center">
    <strong>基于项目的调研工作环境——为那些起点模糊、会一路转向的想法而造</strong>
  </p>
</p>

<p align="center">
  <a href="./README.md">English</a> ｜ <strong>简体中文</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-Private%20Beta-green" alt="Status" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/AI%20SDK-6-black" alt="AI SDK 6" />
  <img src="https://img.shields.io/badge/db-Drizzle%20%2B%20Postgres-blue" alt="Drizzle + Postgres" />
  <img src="https://img.shields.io/badge/license-Private-lightgrey" alt="License" />
</p>

> **状态说明。** 本文档描述 ZENO **当前已实现**的能力。已设计但尚未实现的功能统一收录在
> [路线图](#路线图--尚未实现) 一节,以保证描述真实。

---

## ZENO 是什么？

ZENO 是一个让你调研一个**项目**、而不是一个孤立问题的工作环境。你从一个模糊的想法出发；ZENO 帮你把它拆成多个 topic、逐一调研，并在你的目标不断演变——哪怕最终和起点相差 180°——时，始终保住整个结构。

不同于单次调研工具（Perplexity、Deep Research、普通 AI 聊天），ZENO 不把每个问题当作无状态的一次性提问。它把**项目**——它不断生长的 topic、已确认的发现、悬而未决的问题，以及它们之间的连接——当作可继承的状态。而任何内容，未经你明确确认，都不会成为项目真相。

---

## ZENO 为什么存在？

当你开始认真琢磨一件要紧的事——钱该放哪、要不要移居海外、职业往哪个方向走——你最后真正需要回答的问题，几乎从来不是你最初问的那个。

"我怎么拿到稳定收益？"会变成汇率和宏观风险，变成把一部分资产移到海外，变成需要一个海外身份，变成你究竟在哪生活和工作。一个模糊的担忧，分叉成十几个和起点几乎无关的大 topic。

今天的工具接不住这根线。每个问题都从零开始；你自己这套调研的结构，只存在你脑子里和一堆互不相连的聊天里。ZENO 正是为此而造：用一个项目接住模糊的想法，跟着它转向到哪里、就调研到哪里，并**把你已确认的内容沉淀下来**——让你不必重新推一遍，也让这根线无论目标走多远都不断。

---

## 它如何工作？

### 1. 在项目里工作，而不是孤立的问题
每个项目有多个 topic。每个 topic 承载一段持续的对话——**Sandbox**——你在这里实际思考、探索、深挖。

### 2. 模糊想法变成 topic 和开放问题
你不需要一个成形的问题才能开始。ZENO 读对话，把藏在模糊想法里的开放问题和子 topic 显式拎出来，让项目能跟着你的思路分叉。*（自动开题拆解——L1——正在开发中；目前你可以自己组织 topic，ZENO 从对话里播种候选。）*

### 3. 调研——只留下你确认的
不是每个念头都值得留。ZENO 用三段漏斗（节点状态 `idea` → `pending` → `active`）：

- **Idea（想法）**——ZENO 注意到、但还不确定的内容。安静列着，不要求行动。
- **Candidate（候选）**——高置信度的发现，等你拍板。
- **Truth（真相）**——你已确认的内容。项目的可继承状态。确认后只读，修改走 supersede（废止并替换），不走编辑。

ZENO 通过多种机制从对话里捕获这些（行内标记、"Explore new idea" sweep、手动 sweep 已上线；`/save` 和周期性安全 sweep 在计划中）。原则很简单：**宁可漏掉，也不杜撰**。ZENO 不自动写入真相——每个候选都需要你明确确认。

### 4. Truth Graph 装住整个会演变的调研
右侧面板把项目渲染成一个交互式**图谱画布**（自研 SVG + [ELK](https://github.com/kieler/elkjs) 布局），而非扁平列表——于是你能追溯一个 topic 如何连回最初那个引出它的问题，哪怕目标早已转向。两种范围模式：**All**（真相 + 候选 + 想法，含跨阶段连线）和 **Truth**（仅已确认）。点击任意节点，它的依据、来源、关系、操作在画布下方统一的 detail 区打开。所有细节只在一个地方：没有弹窗，没有嵌套面板。

### 5. 定时复研，而不只是一次
调研可以是一次性的，也可以是一项常驻任务：ZENO 的设计目标是复核那些依赖"会变的世界"的假设，并在你确认过的东西不再成立时回来上报。*（定时复核——Watchtower / L3——在近期路线图上。）*

### 6. 后续会话自动继承你确认的内容
同一项目里每次新对话，都会自动接收相关的已确认真相作为上下文。ZENO 知道你决定了什么、排除了什么、为什么——不用你粘贴任何东西。

### 7. （给构建者）把同一个项目交给编程 agent
当一个调研变成"要动手做"的东西时，ZENO 的 MCP server 把同一份已确认的项目真相提供给编程 agent（Claude Code、Cursor、Codex）——**读取工具**加**写入工具**，全部**候选优先、服务端强制**：任何 MCP 写入都先落入你的待确认列表，经你确认后才成为真相（铁律 4）。这是调研的下游——一条次要路径，不是主线。

---

## ZENO 适合谁

ZENO 是为正在进行一项**真实、会演变的调研**的人造的——一件重要到值得认真调研、又开放到会随你的认知改变形状的事。钱、可能的移居、职业转向、一笔大开销、一个生意想法、一个研究课题。是想对一个模糊问题*认真思考*的人，而不是只想要个快答案的人。

它假设：

- **你做的事会变形。** 你起步时的目标不是你收尾时的目标——你想要一个装得住整段旅程的地方，而不是每次都从空白聊天重来。
- **思考由你来做。** ZENO 负责调研、结构化、把东西拎出来；由你判断什么为真。它回报那些把自己的问题当作值得调查的人。
- **你的调研跨越数天或数周，而非一次坐定就完。** 一次性的问题不需要 ZENO。

**给构建者：** 如果你的项目最终落到"要动手做"，同一份已确认的项目真相会通过 MCP 喂给编程 agent（Claude Code、Cursor、Codex）。那是下游路径，不是 ZENO 存在的理由。

---

## V1 范围

### 当前已实现

- 项目 → 话题 → Sandbox 对话结构
- 三段漏斗（想法 → 候选 → 真相），每条进入真相都需用户确认
- 提取：行内标记、"Explore new idea" sweep、手动 sweep
- Truth Graph 图谱画布（SVG + ELK），支持 **All** / **Truth** 范围模式 + 统一 detail 区
- 聊天中的行内引用——已确认真相（蓝色下划线）、待确认候选（蓝色虚线胶囊）、已 supersede（灰色删除线），均可点击
- Reactivation Anchor——把任意过去的真相节点重新加载到当前对话作为活跃上下文
- Git 风格的不可变历史（用 supersede 替代编辑）
- MCP server：读取工具 + `submit_candidate` + 受控的决策/关系写入
- 项目内每次新对话自动继承真相
- 多 provider 模型路由（Anthropic · Amazon Bedrock · OpenAI）+ 思考深度控制
- 应用内多语言（English · 中文 · Français）

### V1 刻意不做什么

- 不自动写入项目真相（每条都需要用户确认）
- 不执行、写入侧无自主权——只读的自主调研是核心能力（见铁律 0）；执行代码或工具不是
- 不做 BYOK（自带 API Key）——只用平台 key
- 不做对话导入——项目从 ZENO 内部开始
- 不做通用知识库——ZENO 存储项目判断，不存任意笔记
- V1 不支持多用户协作（单一判断主体；多用户在 V2）
- V1 不支持移动端（仅桌面；移动端在 V1.5）

---

## 核心概念

### Truth Substrate（真相 substrate）
跨会话、跨 AI agent、跨工具持续存在的项目级已确认判断。不是聊天记录，不是记忆碎片，而是带有 **kind**（`open_question` / `goal` / `constraint` / `plan` / `hypothesis` / `principle` / `rejection`）、状态、关系、依据的结构化节点。确认后只读，修改通过 supersede。

### Sandbox
每个 topic 下的对话容器。实际的思考和探索在这里发生。用户可以点击"Explore new idea"清空对话并触发批量提取——主动声明"我要切换到另一个想法"。被清空的对话会作为不可变历史保留在服务端，只是视觉上的 chat 被重置。

### Truth Graph（真相图谱）
右侧界面，让项目判断变得可检视：一个交互式图谱画布（SVG + ELK 布局），而非扁平列表。节点按关系布局；画布下方可拖动的 detail 区展示选中节点的依据、来源与操作。范围在 **All**（真相 + 候选 + 想法）与 **Truth**（仅已确认）之间切换。

### Reactivation Anchor
当你把一个过去的真相节点加载到当前对话时，ZENO 会把它设为**活跃上下文锚点**——AI 明白你正在 refine 或延伸这个具体的判断。在这个 session 里提取出的新 candidate 默认会带一个指向锚点的关系提示。

### Inline Reference（行内引用）
AI 在生成回复时，如果判断对话刚刚产出了一个清晰的、值得进入真相的判断，就会嵌入一个标记。这个标记在聊天中渲染为可点击的引用——蓝色下划线表示已确认真相，蓝色虚线胶囊表示待确认 candidate，灰色删除线表示已被 supersede。点击 → 在 detail 区打开。

### 核心循环
**Sandbox 对话 → 提取 → Idea / Candidate 漏斗 → 用户确认 → Truth → 被未来的 session 和 agent 继承**

---

## ZENO 的不同之处

大多数 AI 产品，都是围绕以下单位之一组织的：一段聊天、一个 Prompt、一份文档、一条记忆碎片。调研工具则围绕单个**问题**。

ZENO 围绕的是一个更大的单位：

### **项目（the project）**

一个项目是一套活的结构：topic、发现、开放问题、已确认的判断，以及它们之间的关系。它跨会话、跨 agent 持续存在，并在目标转向 180° 时依然成立。问题是你搜索的东西；项目是你留下的东西。

---

## ZENO 不是什么

- **不是单问题调研工具。** Perplexity、Deep Research、普通 AI 聊天一次回答一个问题，回头就忘。ZENO 装住整个项目和你已确认的内容。
- 不是通用聊天工具
- 不是工具聚合器或导航站
- 不是一次性结果生成器
- 不是给聊天记录套一层"记忆"包装的产品
- 不是编程 agent 的竞品——ZENO 可以**供给**它们，但那是下游，不是重点

---

## 设计原则

ZENO 遵循一条义务和四条铁律，指导每一个设计决策：

- **铁律 0——主动尽职。**
  ZENO 必须在项目上主动行动，不等用户开口：拆解、调研、验证、上报。自主权永远是只读的——一切产出只能以 idea / candidate / evidence 形态进入漏斗，永远不能自行成为真相，永远不执行。铁律 1–4 是边界；义务与边界冲突时，边界优先。

- **铁律 1——永不拥有执行环境，只拥有判断。**
  ZENO 不运行代码、不写文件、不做自动化任务。它维护决策真相。执行交给编程 agent；ZENO 为它们提供上下文。这是一项中立性承诺——正因为 ZENO 永不执行、不与 agent 竞争，所有 agent 才放心接入它。

- **铁律 2——宁漏勿错。**
  保住信任的召回率，胜过最大化召回率。一条错误的真相会污染所有下游工作；漏掉的真相可以以后补上。

- **铁律 3——不把原始转录、随手偏好、自动生成的计划作为真相存储。**
  真相是用户明确确认的内容。对话和真相之间的边界必须清晰。

- **铁律 4——MCP 写入候选优先；真相由用户确认。**
  外部编程 agent 通过 MCP 提交新的 candidate；只有用户能把 candidate 提升为真相。

铁律之外：

- **调查全自动，真相确认制，确认是稀缺资源**——调查可以无限，确认必须稀缺：ZENO 不自动写入真相，也永远不把调查量线性转化为确认请求量。
- **项目状态是真相来源，而不是任何单次对话。**
- **只造必须造的轮子——不做不必要的依赖。**

---

## 路线图 / 尚未实现

以下功能已设计但**尚未实现**——在此列出仅作上下文参考，不作承诺。下面的主动调研项（**L1 开题**、**L2 调研简报**、**Watchtower / L3 监控台**）现在是主要建设重点——正是它们把 ZENO 从一个"装住判断"的地方，变成一个主动"产出调研"的地方。

| 功能 | 阶段 |
|---|---|
| `/save` 选中保存提取 | V1 |
| 周期性安全 sweep（每 N 轮） | V1 |
| MCP 读取前的 agent handoff 阻塞 sweep | V1 |
| Reactivation anchor 随轮次衰减 | V1 |
| 基于信用额度的定价 / 计费 | V1 |
| **L1 开题**——项目创建时的 intake 访谈 + 议题拆解播种 | V1 |
| **L2 调研简报**——节点上点 "Research this" → 带来源的证据简报 | V1.x |
| 多模型 `@mentions`（`@opus`、`@gpt54`） | V1.5+ |
| 移动端 UI | V1.5 |
| **Watchtower（L3 监控台）**——对外部暴露假设的定时复核 | V1.5 |
| **Council（重定义）**——高风险 candidate 确认前的对抗性校验 | V1.5+ |
| **多人协作**——团队级别的判断 substrate | V2 |

---

## 项目状态

🟢 **V1 — 邀请制内测（Private Beta）。** 项目调研循环已上线，凭邀请码开放体验：从模糊想法出发 → 拆成 topic → 调研 → 确认什么为真 → 装进 Truth Graph → 在每次后续会话里继承。当前重点是基于内测使用情况加固研究管线（来源评分、引文校验、模型服务容错）。

---

## 文档

| 文档 | 说明 |
|----------|------|
| [`docs/ir-ui-interaction-v1.3.md`](./docs/ir-ui-interaction-v1.3.md) | IR UI / UX 规格——视觉状态、交互流、组件 |
| [`docs/zeno-truth-graph-rules.md`](./docs/zeno-truth-graph-rules.md) | Truth Graph 布局与交互规则 |
| [`docs/phase-2-risks-and-todo.md`](./docs/phase-2-risks-and-todo.md) | Phase-2 风险与待办 |
| [`docs/superpowers/`](./docs/superpowers/) | 各功能的设计规格与实施计划 |

---

## 技术栈

| 层 | 技术 |
|-------|-----------|
| 框架 | Next.js 16（App Router, Turbopack）· React 19 |
| 语言 | TypeScript |
| AI | Vercel AI SDK 6 · provider：Anthropic、Amazon Bedrock、OpenAI |
| 数据库 | PostgreSQL，经 Drizzle ORM（`drizzle-kit` 迁移） |
| 认证 | Supabase Auth（`@supabase/ssr`） |
| 图布局 | ELK.js（Truth Graph 画布） |
| 富文本 | ProseMirror · CodeMirror · Shiki |
| 流式 / 缓存 | Redis（可恢复流）· Vercel Blob |
| 样式 | Tailwind CSS 4 · Radix UI · Framer Motion |
| 工具链 | Biome / Ultracite · Playwright · pnpm |
| 外部集成 | MCP（Model Context Protocol）——读取工具 + `submit_candidate` + 受控写入 |
| 目标部署 | Vercel |

---
