# 案例:ZENO 裁决收件箱(Judgment Inbox)的 PRD + 验收标准

> **这份文档演示什么。** 在 ZENO 已上线的 `ir_nodes` 判断脊柱之上,补一个当前缺失的
> 一等表面:**跨话题的裁决收件箱**。所有等你拍板的 candidate 汇到一处,按后果排序,
> 逐条就地裁决;把 supersede 的 redline 与"确认前爆炸半径预览"嵌进裁决视图。
> 走一遍 D0 问题陈述 → D1 收缩版 PRD → D2 可运行原型(规范性标注)→ D3 验收标准
> (核心交付物)→ D4 迭代机制。
>
> **一句话背景。** ZENO 的整个论点是"确认是稀缺资源",但**确认这个动作本身是目前
> 支撑最弱的地方**:candidate 从 5 个生产者(inline / sweep / mcp / research /
> watchtower)源源不断落成 `pending` 节点,而用户要在 Truth Graph 里逐个找到、选中、
> 打开 detail 才能裁决——没有汇合入口,没有按后果的优先级,裁决时刻也缺少"这次拍板
> 会移动什么"的信息。收件箱把稀缺注意力这件事,从原则变成一个可度量的表面。

---

## 现状锚点(为什么本轮几乎不需要造新东西)

每一条设计都落在已存在的代码上;这是"收缩范围"的前提,不是背景装饰。

| 需要的能力 | 已存在的实现 | 结论 |
|---|---|---|
| 统一的 pending 队列来源 | `ir_nodes.status ∈ {idea,pending,active,superseded,dismissed}`;`sourceLayer ∈ {inline,sweep,manual,mcp,kickoff,research,watchtower}`——**每个生产者都写 pending ir_node** | 收件箱 = 一条跨 topic 读 `status='pending'` 的查询,无新写模型 |
| Watchtower 告警进队 | `patrol.ts` 信号过闸后 `createIRNodeForUser({ initialStatus:'pending', sourceLayer:'watchtower', kind:'open_question' })` 并挂 `evidence` | 告警**天然进收件箱**,不需单独接线 |
| 爆炸半径数据 | `ir_edges.relation ∈ {supersedes,resolves,depends_on,implies,contradicts,refines}`;`listIREdgesForProject` 已有 | 依赖图现成,爆炸半径可算 |
| supersede 的 redline | 一个 supersede 候选 = pending 节点 + `supersedes` 边指向 active 目标;`createSupersedingIRNodeForUser` 已有;**`lib/editor/diff.js`(13KB diff 引擎)已在仓库** | redline 不造轮子 |
| 写路径 | `/api/ir/[id]/confirm | dismiss | promote | supersede | reclassify` + `use-ir-actions.ts` 全套 handler,含话题指派与 confirmability 闸门 | 收件箱只读+导航,复用现有端点 |
| pending 计数 | `countIRNodesByStatus` 已有 | header badge 现成 |

---

## D0 · 问题陈述(半页,kickoff 前)

**用户与场景。** ZENO 的用户是既做判断、又做执行的 solo founder。项目推进中,等他拍板的
candidate 从五个源头累积:对话行内标记、Explore/手动 sweep、MCP agent、L2 research、
L3 Watchtower。这些 candidate 全部落成 `pending` 的 `ir_nodes`,散落在各个 topic 的
Truth Graph 里。要裁决一条,用户必须**先在图里找到它**,选中节点,打开 detail 面板,
再确认。没有"所有待我裁决之物"的汇合视图,没有按后果的排序,裁决时刻也不告诉他"确认
这条会重塑哪些下游"。

**证据(需求真伪)。** 产品的第一性原则是"确认是稀缺资源、调查全自动"——即系统会把
调查量做大,却刻意不把调查量线性转成打扰量。这条原则的**受力点**正是裁决动作:五个
生产者持续注入 pending,而消费端(用户的确认)只有一个 per-节点、藏在图里的入口。稀缺
资源被分配得好不好,目前既不可见、也无优先级。Watchtower 的存在(周期性产出告警候选)
会让这个消费端更早成为瓶颈——它本来就是设计来"不请自来地"往队列里加高后果 candidate 的。

**要做的事(一句话)。** 给"确认"这个稀缺动作一个专门的、跨话题的、按爆炸半径排序的
收件箱;每条 candidate 就地可裁决,且裁决视图内联展示裁决所需信息(supersede 的 redline、
确认前的爆炸半径预览、告警的反证证据),让每一次稀缺的拍板都是**知情的**拍板。

**Non-goals(明确不做,防 scope drift):**

1. **不新增任何写入真相的代码路径。** 收件箱读 `pending` ir_nodes,写全部经现有
   `/api/ir/[id]/*` 端点(铁律 1/4:永不拥有执行环境;真相由用户经既有闸门确认)。
2. **不做批量一键确认 / 不做自动确认。** 每次裁决是一次刻意的个体动作。批量按钮会把
   调查量兑换成盖章量,正是产品禁止的(确认是稀缺资源)。
3. **不改变提取逻辑,不改变"什么成为 candidate"。** 收件箱只呈现与排序已经 `pending`
   的东西,永不制造新 candidate。
4. **不裁决 `idea` 状态节点。** `idea` 是低置信、"安静列着不要求行动"的一层;收件箱
   只收 `pending`(等你拍板的 candidate)。idea 留在图里,不进队列——否则稀释稀缺。
5. **本轮不做移动端。** 但收件箱正是将来最该上手机的东西:裁决轻、思考重,把裁决收件箱
   而非整个 Sandbox 搬上手机,是 V1.5 的正解。此处记为指向,不实现。
6. **不做跨项目聚合。** V1 单判断人假设不变,收件箱按项目独立(跨项目是后话)。

---

## D1 · PRD(收缩版)

> **为什么这么短。** 可运行原型(D2)与 D3 已承载"长什么样、什么算做对了";本文档只保留
> 原型表达不了的东西:意图与边界、关键决策及理由、数据与状态规则、验收入口。

### 1. 意图与边界

- 做什么:见 D0。一个项目级的裁决收件箱,读跨话题 `pending` ir_nodes,按爆炸半径排序,
  逐条就地裁决,裁决视图内联 redline / 爆炸半径预览 / 证据。
- 不做什么:见 D0 non-goals。
- 为什么现在做:`ir_nodes` 脊柱、L2 research、L3 Watchtower 均已上线,五个生产者都在往
  `pending` 注入,而消费端(裁决)是全系统支撑最弱的一环。补齐它是把核心论点"确认是稀缺
  资源"从原则变成可度量表面的最短路径。

### 2. 关键决策日志(decision log,每条可回答 why)

| # | 决策 | 理由(why) |
|---|---|---|
| K1 | 收件箱按**项目**跨话题读 `ir_nodes.status='pending'`,不是 per-topic | 确认注意力是 per-人-per-项目 的稀缺资源;当前 per-topic detail 把这一份注意力切碎,控制台角色要求一个汇合入口 |
| K2 | 排序 = **爆炸半径**(依赖图下游影响),不是时间、不是置信度 | 稀缺注意力应先给最高后果的裁决;依赖图本身就是优先级函数,不另造一套打分体系(镜像 Watchtower K1) |
| K3 | **无"全部确认" / 无批量放行**,逐条裁决 | 铁律:确认稀缺且刻意;批量按钮把调查量兑换成盖章量,正是产品禁止的。dismiss 陈旧 idea 是另一回事,不在本轮 |
| K4 | 裁决视图内联展示"裁决所需信息":supersede→redline;任意→爆炸半径预览;告警→证据 diff | 看不到后果的裁决是抛硬币;稀缺动作的意义就在于它是知情动作(= 嵌入的建议 3) |
| K5 | 复用 `/api/ir/[id]/confirm|dismiss|promote|supersede`,收件箱只是读+导航面 | 铁律 4(candidate-first、服务端强约束);一条写路径少一套要维护的正确性;话题指派/边副作用/decision_log 的确认逻辑已存在且测过 |
| K6 | 收件箱是**项目级一等表面**(与 Truth Graph 并列、可寻址),非弹窗 | 它是你反复回来清理的地方;控制台角色要求可寻址、跨 session 持续、将来可深链上手机 |
| K7 | watchtower/research 的 `open_question` 告警,其爆炸半径**继承它所质疑的目标节点**,而非自身 | "假设 X 是否还成立"的裁决后果 = X 若错的后果 = X 的爆炸半径;open_question 自身还没有下游 |
| K8 | 收件箱必须继承 detail 的两条既有闸门:`confirmability='needs_discussion'` 不给一键确认;`topicId=null` 确认前强制指派 | 收件箱不能成为绕过慎重确认的后门,否则把"慎重确认"降级成"快速确认",违反铁律 2(宁漏勿错) |

### 3. 数据与状态规则(原型演示不出的部分)

- **无需 schema 变更(v0.1)。** 读:跨 topic 的 `pending` ir_nodes(按 project);
  `ir_edges`(算爆炸半径);`evidence`(告警的证据 diff);supersede 目标节点的 `content`
  (redline)。爆炸半径为 server 端**即时计算,不落库**。
- **爆炸半径定义。** 对节点 N:取"实锚目标" T = N 通过 `supersedes/resolves/contradicts`
  边指向的 active 节点(若有),否则 T = N;爆炸半径 = 沿 `depends_on/refines/implies` 边、
  (传递地)指向 T 的 **active** 节点集合大小,深度封顶 D(v0.1:D=3),去重。边方向以
  `ir_edges` 实际写入语义为准(实现期核对建边代码)。这是**近似**,像 Watchtower 承诺
  "带预算的自适应"而非精确——UI 上诚实呈现为"≈"而非精确计数时不误导。
- **排序。** 先分层:Tier A(重塑已确认真相:supersedes/contradicts/resolves 一个 active
  节点)高于 Tier B/C(纯新增 candidate);层内按爆炸半径降序,再按 `createdAt` 升序
  (老的先,不让 pending 腐烂)。排序公式是未收敛项(见 3d)。
- **写入边界。** 收件箱全部裁决动作复用 `/api/ir/[id]/*` 端点;不存在任何直接改
  `ir_nodes.status` 的收件箱代码路径(与 MCP / Watchtower 同一铁律)。
- **计数。** header 的 pending badge = 该项目 `countIRNodesByStatus('pending')`;一次裁决后
  SWR 重拉,节点离队(confirm→active / dismiss→dismissed / supersede→旧 superseded+新 active),
  badge 同步。

### 4. 验收入口

验收标准见 D3(独立版本化文档,`judgment-inbox-acceptance-v0.x`)。本 PRD 不复述验收
细节——PRD 说明意图,D3 定义"什么算做对了"。

---

## D2 · 可运行交互原型(说明页)

原型用扣子编程搭建(dogfooding),覆盖:收件箱列表(每行:目标标题 / kind 徽标 /
来源层徽标 / 爆炸半径 / 所属话题 / 存在时长)、逐条裁决抽屉(rationale + 关系 +
【supersede→redline】/【告警→证据】/ 爆炸半径预览 + 确认/讨论/忽略动作,复用
`IRDetailPane` 的 `ActionColumn` 语义)、header 的 pending badge。

**规范性标注(normative vs illustrative)——不标注的后果是 agent 把原型里的偶然细节
当成需求原样复制:**

| 部分 | 标注 | 说明 |
|---|---|---|
| supersede 候选的裁决视图必须内联 redline(目标 `content` vs `proposedContent` 逐句对照) | **normative** | K4 的载体,不可省略;复用 `lib/editor/diff.js` |
| 任意候选的裁决视图必须展示爆炸半径预览,且**点名具体下游节点**(不止一个数字) | **normative** | K4 / R1 |
| watchtower/research 告警候选必须内联展示证据(引文 + stance),不得只给结论 | **normative** | K4(镜像 Watchtower N2) |
| `needs_discussion` 节点不出现"确认"按钮,只出现"进 sandbox 讨论" | **normative** | K8 |
| `topicId=null` 节点确认前强制指派 topic | **normative** | K8 |
| 无"全部确认"控件 | **normative** | K3 |
| 徽标配色、爆炸半径可视化形式(条/数字/环)、抽屉宽度、次级排序键的展示 | illustrative | 研发/agent 可自行改进 |
| 收件箱是独立 route 还是 stage 内一个 tab | illustrative | 只要满足 K6"项目级可寻址"即可 |

---

## D3 · 验收标准(核心交付物)

> `judgment-inbox-acceptance-v0.1` · 2026-07-23 · changelog 在文档尾部
> 每条 case 标注来源(哪个决策/反例产生了它)——provenance 是这套标准的一等公民,
> 和 ZENO 里每个 truth 节点带 rationale 是同一个思想。

### 3a. 机器可判层(test cases / eval set)

**确定性行为(e2e / 集成测试,硬验收):**

| ID | 输入 → 期望输出 | 来源 |
|---|---|---|
| JI-01 | 项目内 2 个话题共 3 个 `pending` 节点 → 收件箱列出全部 3 条(跨话题),每行含目标标题 / kind / 来源层 / 爆炸半径 / 所属话题 / 存在时长 | K1 |
| JI-02 | 一个 supersede 候选(有 `supersedes` 边指向 active 目标)→ 裁决视图渲染 redline:目标 `content` vs `proposedContent` 逐句 diff | K4 |
| JI-03 | 一个 `sourceLayer='watchtower'` 的 pending `open_question`(挂 `evidence`)→ 裁决视图渲染证据(quote + stance);其爆炸半径 = 被质疑节点的下游数(非 0) | K4, K7 |
| JI-04 | 从收件箱确认一条 → 调 `/api/ir/[id]/confirm`,节点转 active 且离队,`decision_log` 出现 created;图里可见 | K5 |
| JI-05 | 收件箱不存在任何"全部确认 / 批量放行"控件(断言其不存在) | K3 |
| JI-06 | `idea` 状态节点不出现在收件箱 | D0-NG4 |
| JI-07 | 从收件箱 dismiss 一条 → 调 `/api/ir/[id]/dismiss`,节点转 dismissed 离队 | K5 |
| JI-08 | 节点有 N 个沿 `depends_on` 的 active 下游(深度 ≤ D)→ 爆炸半径 = N;叶子节点 = 0 | K2 |
| JI-09 | header 的 pending badge 数 == 收件箱条目数;一次裁决后二者同步减少 | D1§3 |
| JI-10 | 一个 `topicId=null` 的 pending 节点 → 收件箱在确认前要求指派 topic(复用 `getAssignmentPayload` 契约),不得绕过 | K8 |
| JI-11 | 一个 `confirmability='needs_discussion'` 的 pending 节点 → 收件箱不给"确认",只给"进 sandbox 讨论" | K8 |
| JI-12 | **数据库断言**:全量回归后,不存在任何 `ir_nodes.status` 变更源于收件箱自身代码路径(全部经 `/api/ir/[id]/*`) | 铁律 1/4, D0-NG1 |

**模型判定环节(golden set 分级样例)——"爆炸半径预览质量"检测器:**

- 语料:20 组(节点 + 其子图,人工标注的"合格预览文本")。
- 必含分级样例:多下游 supersede(高半径,预览须点名 top-N 下游)/ 叶子 create(半径 0,
  预览须说"无下游依赖")/ watchtower 告警(半径继承目标)/ 环形依赖(去重后不虚高)。
- 通过线:预览点名的下游节点集合与人工标注的 Jaccard ≥ 0.8;半径数值误差 ≤ 1(深度 D 内)。

### 3b. 人判层(rubric ＋ 好/坏对照)

**R1 · 爆炸半径预览质量**——光写"影响若干下游"没有判定力,给对照:

- ✅ 合格:「确认后将重塑 3 个下游:`D12` 上线计划(depends_on)、`T7` 迁移任务
  (depends_on)、`H4` 成本假设(refines)。」(点名 + 关系 + 数量)
- ❌ 不合格:「影响若干下游节点。」(只有形容词,无一可核对)
- ❌ 不合格:把一个孤立的 create 候选标成高爆炸半径(排序噪声,违反 K2)

**R2 · 裁决视图信息完备性**:

- ✅ 合格(supersede):并排 redline + 一句"这条取代 `C3`『OpenAI 按 token 计价』" +
  爆炸半径预览 + 确认/讨论/忽略。
- ❌ 不合格:supersede 候选只显示新表述,不显示被取代的旧真相(把 diff 成本退还给用户,
  命中 N3)。

### 3c. 反例集(不允许发生什么——信息密度高于正例)

| ID | 永不事件 | 来源 |
|---|---|---|
| N1 | 收件箱任何路径直接改写 `ir_nodes.status`(绕过 `/api/ir` 端点) | 铁律 1/4 |
| N2 | 出现"全部确认"或任何一键批量放行 | K3 |
| N3 | 对 supersede 候选不展示 redline 就允许确认 | K4 |
| N4 | 把 `idea` 节点灌进裁决队列(稀释稀缺) | D0-NG4 |
| N5 | 用排序把"顺眼/容易确认"的排前面,而非按后果 | K2(镜像 Watchtower K4 的不可 gaming) |
| N6 | 收件箱绕过 `needs_discussion` / topic 指派闸门做快速确认 | K8 |
| N7 | 收件箱制造新 candidate(把呈现层写成生产者) | D0-NG3 |

### 3d. 严格度分级:探索项交付"假设 ＋ 指标",不交付硬 spec

| 探索项 | 当前假设(v0.1 起点值) | 判定指标 | 决议时点 |
|---|---|---|---|
| 排序公式 | Tier A 优先 + 层内爆炸半径降序 + 老的先 | 用户在队列里手动跳过/重排 top 项的比例 < 30% | 内测 2–4 周 |
| 爆炸半径深度封顶 D | D = 3 足够区分高低后果 | D=3 与 D=∞ 的排序 Kendall τ > 0.9(离线) | 实现期一次性 |
| 收件箱形态 | 独立 route(可寻址、将来可上手机) | 用户从其它视图跳到收件箱的频次 / 是否请求深链 | 内测 |

**北极星**:pending 停留时长中位数 ↓,且确认率不因排序讨好而虚高——由证据与后果本身
说服用户(K2 禁止排序 gaming,使北极星不可 gaming)。它与 Watchtower 的"告警确认率"
是同一族指标:都度量"稀缺注意力被分配得多好"。

### Changelog

- v0.1(2026-07-23):首批 12 条机器判定 case + 2 组 rubric + 7 条反例。来源全部为设计
  决策(K1–K8)与 non-goals;尚无逃逸缺陷来源的 case——**这正常:缺陷来源的 case 只能靠
  D4 闭环长出来,追求首日完备违背迭代论。**

---

## D4 · 迭代机制

**触发器(每个都生成一个标准 patch 候选):**

- 逃逸缺陷:内测用户报告的每个收件箱缺陷 → 归因到 D3 的缺口(缺 case?rubric 无判定力?
  反例集漏了一类?)→ 补一条带来源标注的 case。骂人不产生 case,归因才产生。
- 研发假设:标准未覆盖时研发**不阻塞等产品**,按最合理假设先做并记入假设日志;假设进入
  下一版标准(转正为 case,或被推翻并补反例)。
- 3d 探索项到期:数据回来 → 探索项要么硬化为 3a 的 case,要么修正假设续期。

**节奏**:每周一次 spec diff review——像 code review 一样 review 验收标准的变更。标准文件
进 git,diff 可见。

**假设日志示例:**

> 2026-07-23 · 标准未定义"一个 pending 节点同时 supersedes 一个 active 且被另一个 pending
> `contradicts`"时的排序层归属。假设:归 Tier A(以 supersedes 为准),contradicts 关系
> 在预览里额外提示。→ 待下版标准裁决:转正 or 推翻。

**闭环声明**:kickoff 首日交付的最小集 = D0 + D2 happy path + D3 的 JI-01/02/04/05/06 +
non-goals。不追求完备,追求**闭环从第一天就在转**。

---

## 附 A · 实现地图(切片一,供 coding 直接对接)

> 全部为"读 + 导航 + 复用写端点",无 schema 变更、无新写路径。

**服务端**
- 新增 `lib/ir/inbox-queries.ts`:
  - `listPendingInboxForUser({ projectId, userId })` — 跨 topic 拉 `pending` ir_nodes
    (复用/扩展 `listIRNodesForUser`)。
  - `computeBlastRadius(node, edges)` — 用 `listIREdgesForProject` 的边,按 D1§3 定义算,
    深度封顶 D=3;返回 `{ radius, topDownstream: IRNode[] }` 供 R1 预览点名。
  - 组装每条为 `{ node, tier, blastRadius, topDownstream, isSupersede, supersedeTargetId,
    evidence?, redlineTargetContent? }`。
- 新增 `app/api/ir/inbox/route.ts`(GET,projectId)→ 返回排序后的队列。
- **不新增任何写端点。**

**前端**
- 新增 `components/ir/judgment-inbox.tsx`(列表)+ 逐条裁决视图(复用 `IRDetailPane` /
  `ActionColumn` 的 pending 分支语义,新增 redline block 与爆炸半径 block)。
- redline 复用 `lib/editor/diff.js`(已存在)。
- 裁决动作复用 `use-ir-actions.ts` 的 `handleConfirmNode` / `handleDismissCandidate` /
  `handleBringToSandbox`(含话题指派与 needs_discussion 闸门,K8 免费继承)。
- 入口:项目级 route 或 stage tab(K6);header badge 复用 `countIRNodesByStatus`。

**测试**
- JI-01/06/08 → `inbox-queries` 单测(含爆炸半径与 idea 排除)。
- JI-02/03/10/11 → 组件/集成测。
- JI-05/12 → 断言无批量控件、无直接 status 改写(grep + e2e)。

---

## 附 B · 面试讲法(30 秒版)

1. **同构点**:裁决收件箱把"确认是稀缺资源"从一句原则,变成一个**可度量的表面**——
   北极星(pending 停留时长 ↓ + 不可 gaming 的确认率)度量的是稀缺注意力被分配得多好,
   与 Watchtower 的告警确认率是同一族指标。
2. **最短路径**:五个生产者都已写 `pending` ir_node,Watchtower 告警已进队,依赖图与
   diff 引擎都现成——所以这不是新造子系统,是给已存在的消费端补一个一等入口。范围收缩
   本身就是判断。
3. **防守点**:为什么不加"全部确认"提速?因为那会把稀缺的确认降级成盖章,直接违反产品
   的第一性原则——**能做但刻意不做,是这个设计里信息密度最高的一条。**
