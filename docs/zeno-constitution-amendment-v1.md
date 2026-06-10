# Zeno 宪法修订案 №1 — Iron Law 0、Evidence 公民权与自主性阶梯

> 状态：**Active — Elios 已于 2026-06-10 确认。** 本文件自身遵循了 Zeno 漏斗：以 candidate 形态提出，经判断所有者确认后生效，现已并入产品宪法与 README 铁律。
> 同日确认的配套裁决：双轨问题裁定 `ir_nodes` 为 canonical 轨（见 L1/L2 spec · Open questions）。
> 读者：Elios（判断所有者）、Claude Code（review 与后续落地）。
> 配套实现：`docs/superpowers/specs/2026-06-10-research-engine-l1-l2-design.md`
> 写法沿用 `docs/zeno-truth-graph-rules.md`：每条尽量写清「是什么 / 为什么 / 怎么执行」。

---

## 序言：Zeno 的生态位（本案一切条款的依据）

AI 经济分三层：**执行**正被 coding agents 商品化，**调查**正被 deep research 商品化，**批准（ratification）**无法商品化——判断的价值恰恰来自它不能被自动化：有人签字、有人承担后果。

Zeno 的生态位是第三层：**批准层——人类判断的 system of record。** 代理越多的世界，越需要一个跨 agent 的可信基底回答「这个人确认过什么、拒绝过什么、为什么」。这个位置平台不会来占：engagement 指标不容确认摩擦（故平台全走静默记忆路线）、每家只在墙内做记忆、而监管正朝「有意义的人类监督 + 审计轨迹」方向立法。

由此重新解读铁律一：「不碰执行」不是 scope 纪律，是**中立性承诺**——git 不运行你的代码，所以所有 CI 都信任 git；Zeno 永不执行、不绑模型，所以一切 agent 敢接入它。

这个生态位随世界自动化程度上升而**增值**：每一代更强的模型都让「人类批准过的状态」更稀缺。Zeno 做多 AI 进步，而非与之赛跑。

一句话总纲：**Zeno 让一个人的判断在 AI 的世界里保持主权、持续累积、并被一切代理尊重。**

---

## 0. 为什么需要这次修订（根因，不是症状）

现有四条铁律全部是**防御性**的：

| 铁律 | 性质 |
|---|---|
| 1. 不碰执行环境，只管判断 | 禁令 |
| 2. 宁漏勿错 | 禁令 |
| 3. 不把原始转录/随口偏好存成 truth | 禁令 |
| 4. MCP 写入 candidate-first，truth 须用户确认 | 禁令 |

它们只规定 Zeno **不做什么**，没有一条规定 Zeno **必须做什么**。一部只有禁令的宪法，自然长出一个只会等待的产品——这就是产品愿景（主动调研推演做到极致）与当前实现（被动判断捕获器）出现偏差的根本原因。修宪不是推翻：四条铁律全部保留原文，本案只做**增补**与**一处原则改写**。

---

## 1. Iron Law 0 — 主动尽职（新增，条文）

**是什么：**

> **Zeno 必须在项目上主动行动，不等用户开口：拆解（decompose）、调研（research）、验证（verify）、上报（report）。
> 自主权永远是只读的；一切产出只能以 idea / candidate / evidence 形态进入漏斗，永远不能自行成为 truth，永远不执行。**

「不执行」的精确含义：不写文件、不跑代码、不发出任何改变外部世界状态的请求。只读调研（搜索、抓取、阅读）**不是执行**，它是 Zeno 的本职。

**为什么：**

- 用户愿意在 Zeno 开始一个项目，根本动机是「这个项目被当成严肃项目对待」。被严肃对待的体验 = 有人主动替你做尽职调查，不是有人替你记笔记。
- 主动性是 Zeno 的立根之本与差异化关键：判断捕获迟早被平台原生功能覆盖，**锚定在确认判断基底上的主动尽职**不会——平台的主动性（通用 ambient briefing 类产品）没有项目真相可锚定，不知道你的 assumption 是什么、被什么推翻。
- 探索想法的过程要完全释放 AI 的能力——人够不到的地方（穷举选项、遍历来源、持续盯住假设），由 Zeno 的手伸过去。
- 能被完全自动化的部分要完全自动化。**调查**可以完全自动化；**判断**不可以。这条法则把两者的边界写死。

**怎么执行：**

- 每个 feature 评审增加一问：「这个功能让 Zeno 更主动了，还是让用户干了更多活？」答案是后者的功能要给出额外理由。
- 自主行为的权限按 §4 自主性阶梯逐级开放，但写入权限**恒为 candidate / idea / evidence**，任何等级都不变。

**与其他条款的关系（优先级裁决）：**

- 铁律 1–4 是边界，Law 0 是义务。**冲突时边界优先**：铁律 1–4 凌驾 Law 0。
- 与最高信条（易学易用，见 truth-graph-rules §0）：Zeno 主动产出的任何东西也必须一眼看懂，否则砍掉。
- 宁漏勿错在调研中的映射：**拿不准时提问，不要断言**——产出 open_question 是安全的「漏」，产出编造的 hypothesis 是「错」。

---

## 2. 原则改写：「Confirmation over automation」废止

原表述「ZENO never auto-writes; confirmation over automation」把两件事压在了一个口号里，导致「automation」整体被当成敌人。改写为：

> **调查全自动，真相确认制，确认是稀缺资源。**（Automate investigation; confirm truth; ration confirmation.）

分工从此一句话说清：**用户拥有判断，Zeno 拥有尽职。**

「ZENO never auto-writes truth」保留，原样并入铁律 4 的注释。

**附则（2026-06-10 红队后补强）：**

- **2a — 确认是稀缺资源。** 调查可以无限，确认必须稀缺。HITL 研究的一致结论：审查量超过注意力时，人会橡皮图章化（automation complacency / alert fatigue）；确认一旦沦为盖章，truth 的全部价值——人类真实承诺——随之蒸发。因此**调查量永远不得线性转化为确认请求量**；Zeno 必须像花预算一样分配确认请求：更少、更好的 candidate。
- **2b — Confirm-rate 是健康指标，不是优化目标。** 若调研管线以「让用户确认」为优化目标，Zeno 会学会只提让用户舒服的提案（情报政治化的同构失败）。Judge 阶段必须主动呈现 stance=contradicts 的证据。
- **2c — 确认必须是思考行为。** 高风险 candidate 的确认界面必须强制接触 rationale 与反方证据；否则确认制退化为 cookie consent——人人点过、形式有效、认知为零。确认是用户理解项目本质的时刻，UI 要保卫它。
- **2d — 「全自动」的边界是已确认的意图。** Zeno 自主调查的范围由用户确认过的 topic charter / anchor 划定，调查 plan 必须可查。Zeno 永远不自行决定「这个项目是关于什么的」——agenda-setting 权保留给用户。

---

## 3. Evidence 公民权（新增）

**是什么：** Zeno 的世界从两类公民变成三类：

| 公民 | 定义 | 写入者 |
|---|---|---|
| **Truth** | 用户确认过的判断 | 只有用户（经确认动作） |
| **Candidate / Idea** | 等待判断的提案 | 提取、L1 开题、L2 调研、MCP agent |
| **Evidence**（新） | 支撑判断的带来源材料：url、原文引文、claim、retrieved_at、立场 | 只有调研管线 |

**规则：**

- **E1 — Evidence 不是 truth。** 它永远不能被「确认」成 truth；它是 truth 的材料。这是铁律 3 的正面延伸。
- **E2 — 不许漂浮。** 每份 evidence 必须挂在具体节点（open_question / hypothesis / decision）上。Zeno 没有自由文档库——这是 README「not a general-purpose knowledge base」的正面表述。
- **E3 — Evidence 有时效。** `retrieved_at` 是一等字段。这为 V1.5 的 assumption watchlist（假设新鲜度巡检）预留了接口：巡检的本质就是「重新验证旧 evidence」。
- **E4 — 报告即视图。** 调研简报是 evidence + candidates 的渲染视图，不是独立的文档实体。这是 Zeno 与通用 deep research 产品的本质分界：**报告被读一次就死了，evidence 持续更新图的状态。**

**为什么：** 调研引擎（Law 0 的主要执行者）会产出大量材料。没有 Evidence 公民权，这些材料只有两个去处——污染 truth（违反铁律 3）或淹死在聊天里（违反产品本质）。

**现状注记（给 Claude Code）：** schema 中 `candidate_decision.external_evidence` 目前是一个 text 列（`lib/db/schema.ts:344`），是这个方向的前身。正式 evidence 实体的设计见配套 spec §Data model；旧列保留以兼容 MCP，标记 deprecated。

---

## 4. 自主性阶梯（Autonomy Ladder）

自主性逐级开放，每一级只增加「触发的主动性」，**写入权限永远不变**（candidate / idea / evidence）。

| 级 | 名称 | 触发 | 能力 | 状态 |
|---|---|---|---|---|
| L0 | 捕获 | 用户对话中 | 提取 idea / candidate | ✅ 已建 |
| L1 | 开题 | 用户创建项目/topic | intake 提问 → 拆解 topics → 播种 open_questions / constraints / goals | 🎯 发布门槛 |
| L2 | 受命调研 | 用户在节点上点「Research this」 | 只读 web 调研 → evidence + 选项简报 + candidates | 🎯 发布后 30 天 |
| L3 | 自发巡检 | Zeno 自己定期 | 便宜模型巡检 evidence 新鲜度 → 贵模型裁决 → 主动上报「假设可能已被推翻」 | V1.5 |
| L4 | 对抗校验 | 高风险 candidate 确认前 | 结构化异议（见 §5） | V1.5+ |

每升一级的唯一审查标准：上一级的确认率（用户确认 Zeno 产出的比例）是否健康。确认率是整个漏斗的核心健康指标——如果用户在 L1 就开始无视 candidate 池，先修漏斗，再谈升级。

---

## 5. Council 条款重定义

原 V2 路线图中的 Council（多模型共同探讨一个判断的聊天室）**废弃该形态**。

**为什么：** 聊天室形态成本高、UI 复杂度高，且其价值假设（多模型对话提升判断质量）未经验证，也不在核心循环的瓶颈上。Council 真正有价值的内核是**结构化异议**。

**重定义：** Council = 漏斗内的对抗性校验步骤——在用户确认高风险 candidate 之前，由另一个模型做一轮 devil's advocate，把反方论点与反例摆到确认界面上。它与铁律 2 同构：对抗性校验直接降低「错」。形态上是 §4 的 L4，不是独立产品功能。

---

## 6. 落地 checklist（确认本案后，给 Claude Code 的同步清单）

- [x] `README.md` / `README.zh-CN.md`：Design principles 段新增 Iron Law 0（置于铁律 1 之前）；「Confirmation over automation」改写为「Automate investigation; confirm truth」。（2026-06-10 完成）
- [x] `README.md` V1 scope：「No autonomous agents or tool execution inside ZENO」改为精确表述，如 *"No execution and no write-side autonomy. Read-only autonomous research is core (see Iron Law 0)."*（2026-06-10 完成）
- [x] `README.md` Roadmap 表：Council 行改为 "Adversarial check on high-stakes candidates (Council, redefined)"；新增 L1 Kickoff（V1）与 L2 Research Brief（V1.x）两行（含 Watchtower L3，V1.5）。（2026-06-10 完成）
- [x] `lib/ai/prompts.ts` 的 `regularPrompt`（被动措辞在这里：「ZENO helps the user maintain…」「I've captured this as a candidate」等），与 Law 0 对齐；`lib/prompting.ts` 只含提取 prompt，核对无被动措辞即可。（2026-06-10 完成）
- [x] 本文件状态从 Candidate 改为 Active，并在 truth-graph-rules §0 附属原则中引用「调查全自动，真相确认制」。（2026-06-10 完成）

---

*规矩之下，没有次品。本案把「规矩」补全为既有禁令、也有义务的完整宪法。*
