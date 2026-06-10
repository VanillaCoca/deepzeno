<p align="center">
  <h1 align="center">ZENO</h1>
  <p align="center">
    <strong>面向长周期项目的判断原生 AI 工作环境</strong>
  </p>
</p>

<p align="center">
  <a href="./README.md">English</a> ｜ <strong>简体中文</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-V1%20In%20Development-yellow" alt="Status" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/AI%20SDK-6-black" alt="AI SDK 6" />
  <img src="https://img.shields.io/badge/db-Drizzle%20%2B%20Postgres-blue" alt="Drizzle + Postgres" />
  <img src="https://img.shields.io/badge/license-Private-lightgrey" alt="License" />
</p>

> **状态说明。** 本文档描述 ZENO **当前已实现**的能力。已设计但尚未实现的功能统一收录在
> [路线图](#路线图--尚未实现) 一节,以保证描述真实。

---

## ZENO 是什么？

ZENO 是一个让项目判断跨会话、跨话题、跨 AI agent 持续存在的 AI 工作环境。你已经做过的决策、定下的约束、悬而未决的问题，不必每次回到项目都重新拼装一次。

不同于普通 AI 聊天工具，ZENO 不把聊天记录当作真相来源。ZENO 把**经过用户确认的判断**作为项目可继承的状态。未经明确确认的内容，不会进入项目真相。

---

## ZENO 为什么存在？

在长周期项目中使用 AI 时，真正的问题往往不是"模型不够聪明"，而是**项目判断无法积累**。

随着项目推进：

- 上下文被埋进聊天记录
- 之前的决策被遗忘
- 决策依据逐渐消失
- 不同 AI agent 一次次从零开始

65% 的开发者将"缺失上下文"列为 AI 代码质量差的首要原因（Stack Overflow 2026）。维护了完善上下文文件的项目，agent 错误减少 40%，任务完成速度提升 55%（Anthropic Agentic Coding Report 2026）。人们已经在手动解决这个问题——维护 CLAUDE.md 文件、写 session handoff notes、构建 18,000 行的 PROJECT_JOURNAL 系统。ZENO 让这件事变成系统能力，而不是手工劳动。

---

## 它如何工作？

### 1. 在项目里持续工作，而不是孤立对话
每个项目有多个话题。每个话题承载一段持续的对话——**Sandbox**——你在这里实际思考、探索、做决策。

### 2. 三段漏斗：想法 → 候选 → 真相
并不是每个念头都该成为项目真相。ZENO 采用三段漏斗结构（由节点状态 `idea` → `pending` → `active` 支撑）：

- **Idea（想法）**——ZENO 在对话里识别到、但还不确定是不是决策的中等置信内容。安静地列在那里，不要求行动。
- **Candidate（候选）**——高置信度的判断，等你拍板。
- **Truth（真相）**——已确认的判断。项目的可继承状态。确认后只读，修改通过 supersede（废止并替换），不通过编辑。

### 3. 提取机制
ZENO 通过多种机制从对话中捕获判断，按用户信号强度排序：

| 机制 | 触发方式 | 状态 |
|---|---|---|
| Inline marker（行内标记） | AI 在生成回复时直接标记明确的判断 | ✅ 已上线 |
| Explore 时的 sweep | 你点击"Explore new idea"，最强信号 | ✅ 已上线 |
| 手动 sweep | 你主动对当前对话触发一次提取扫描 | ✅ 已上线 |
| `/save` | 你选中文本主动保存 | 🔜 计划中 |
| 周期性安全 sweep | 每 N 轮自动触发兜底 | 🔜 计划中 |
| Agent handoff sweep | 编程 agent 通过 MCP 读取真相前的阻塞扫描 | 🔜 计划中 |

原则很简单：**宁可漏掉一个判断，也不杜撰一个**。ZENO 不自动写入真相——每个 candidate 都需要你明确确认。

### 4. Truth Graph 让判断可检视
右侧面板把项目判断渲染成一个交互式**图谱画布**（自研 SVG + [ELK](https://github.com/kieler/elkjs) 布局），而不是一个扁平列表。两种范围模式：**All**（真相 + 候选 + 想法，含跨阶段连线）和 **Truth**（仅已确认真相）。点击任意节点，它的完整详情（依据、来源、关系、操作）会在画布下方统一的 detail 区域打开。所有细节只在一个地方呈现：没有弹窗，没有嵌套面板。

### 5. 后续会话自动继承真相
同一项目中的每次新对话，都会自动接收相关的已确认真相作为上下文。AI 知道你决定了什么、否定了什么、为什么——不需要你粘贴任何东西。

### 6. 编程 agent 通过 MCP 读取你的真相
当你交接给编程 agent（Claude Code、Cursor、Codex）时，ZENO 的 MCP server 把同一份项目真相提供给它。它暴露**读取工具**（项目/话题上下文、决策、开放问题、否决项、IR 搜索/读取）以及**写入工具**——`submit_candidate`（只能提交候选）和一组受控的决策/关系修改工具。设计意图是**候选优先**：外部 agent 提出，用户确认什么才成为真相。

---

## ZENO 适合谁

ZENO V1 是为**用 AI 做长周期项目的 solo founder 和独立构建者**打造的。更精确地说：那些既是判断主体、又是执行者的人——在思考型 AI（做产品/策略决策）和编程型 AI（做实施）之间来回切换。

V1 不面向所有人。它假设：

- **你认真对待项目上下文。** 你已经在手动维护 CLAUDE.md / AGENTS.md / 交接笔记；ZENO 把这件事自动化、结构化。
- **你是单一判断主体。** V1 假设由一个人拍板。多人团队协作是 V2。
- **你在多个 AI agent 之间切换。** Claude、GPT、Gemini 做思考；Claude Code / Cursor / Codex 做实施。ZENO 给它们提供同一份判断 substrate。
- **你的项目以周或月为周期。** 短期一次性任务不需要 ZENO。

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

大多数 AI 产品，都是围绕以下单位组织的：聊天记录、Prompt、文档、记忆碎片。

ZENO 围绕的是另一种单位：

### **判断（Judgment）**

判断不是一段文本。它有 kind、状态、依据、与其他判断的关系，以及在项目中的后续影响。这是判断在时间和 agent 之间持续的基础。

---

## ZENO 不是什么

- 不是通用聊天工具
- 不是工具聚合器或导航站
- 不是多模型壳子
- 不是一次性结果生成器
- 不是给聊天记录套一层"记忆"包装的产品
- 不是编程 agent 的竞品——ZENO **供给**它们，不替代它们

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

以下功能已设计但**尚未实现**——在此列出仅作上下文参考，不作承诺。

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

🟡 **V1 — 开发中。** ZENO V1 尚未发布。当前重点是构建核心的判断连续性循环：Sandbox 对话 → 提取 → 3 段漏斗 → 用户确认 → 真相 → 被未来的 session 和编程 agent 继承。

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
