# Watchtower V1 切片 · 研发交付包 v0.1

| | |
|---|---|
| 日期 | 2026-07-15 |
| 交付对象 | 实现 agent（Claude Code）＋ 人工评审：Sean |
| 上游设计稿 | `docs/superpowers/specs/2026-06-10-watchtower-l3-design.md`（本包对其做切片裁剪，冲突处以本包为准） |
| 验收标准 | §6，版本 `wt-accept-v0.1`，随本包一起进 git |
| 状态 | kickoff — 首日范围见 §8 |

**一句话**：Zeno 按节奏重访 truth graph 中"外部世界能推翻"的节点，发现反证时
以候选形式报告，永不直写 truth。本包只覆盖 V1 切片（巡检 + report-only 告警）；
升级推理档、预算钱包、翻案 watch 全部明确延期（§2）。

---

## 1. 意图（为什么做，3 行）

内测复盘：3 个真实项目中 15%–25% 的活跃节点引用可被外部证伪的条件，其中 2 个
项目发生过"依据已过期 constraint 继续决策"、数周后才人工发现。用户目前没有任何
机制知道"我确认过的判断哪些已经不成立了"。L2 research 管线（evidence 表、
`research_run`、持久化检索意图）已上线，L3 需要的钩子全部就位。

## 2. 范围与 Non-goals

**本切片做**：

- watch 表 + 每日 cron 巡检（economy 档）
- 信号 → `report_only` 告警：落一条 `pending` 的 `open_question` 候选，
  `source_layer = 'watchtower'`，内联反证证据
- Watchtower 管理面板 + 节点详情 Monitoring 区
- 告警稀缺性：冷却 + 每项目周上限

**本切片不做（设计稿有、此处明确裁掉，勿实现）**：

| 裁掉项 | 原因 | 归宿 |
|---|---|---|
| investigate / deep_dive 升级推理档 | 先验证巡检信号质量，再谈重推理花费 | 切片 2 |
| 预算钱包 + exhausted 状态 | 切片 1 用 cadence 上限 + 每 sweep 条数上限控成本，够用 | 切片 2 |
| 翻案 watch（rejection 节点） | 依赖信号质量数据 | 切片 2 |
| monthly cadence 与自适应退避 | 先拿固定三档（daily / every_3_days / weekly）的真实数据 | 切片 2 |
| 游离 watch（"盯这个 URL"） | 永不做——watch 必须锚定节点，否则产品退化为网页监控器 | never |
| 任何 truth 直写路径 | Iron Law 0/4 | never |
| goal / principle 自动建议 | 议程属于用户 | never |

## 3. 锁定决策（实现中遇到冲突，回来查这张表，别自行发挥）

| # | 决策 | why |
|---|---|---|
| K1 | 每节点至多一个 watch（`unique(node_id)`），无游离 watch | watch 是节点的属性不是独立实体；一节点多 watch 没有对应的用户心智 |
| K2 | 巡检 = `research_run`，`run_type='patrol'`，不新建活动流水表 | 复用 L2 管线与渲染；少一套要维护的状态 |
| K3 | 告警 = `open_question` 候选，不新增节点 kind | 告警的用户动作和 open_question 完全同构（看证据 → 确认/驳回）；新 kind 是无谓的概念税 |
| K4 | 巡检频率与告警频率解耦：巡检可每日，告警有冷却 + 周上限 | 用户确认注意力是最稀缺资源，调查量不得兑换成打扰量 |
| K5 | 告警必须内联反证证据（存档引文 vs 当前抓取的 diff） | 让证据说服用户而非措辞；同时是防指标 gaming 的结构性手段 |
| K6 | Zeno 建议的 watch，`reason` 必填且必须人话（外部依赖是什么 + 谁依赖它） | 议程透明：系统自发盯什么，必须能向用户解释为什么 |
| K7 | on/off 只有一个字段管（`status`: active/paused），cadence 里不设 'off' | 一个状态一个 owner，禁止两个字段能表达同一件事 |
| K8 | cron 顺序处理、单个失败不中断 sweep；`next_due_at` 排序即续跑游标 | 300s 函数预算内最简单的可续跑方案；失败风暴不许放大 |
| K9 | 巡检模型走 `lib/ai/model-policy.ts` 的 economy 档，watch 可单独覆盖（`model_id`），永不受前台质量旋钮影响 | 自治花费与前台体验解耦 |

## 4. 数据与状态规则

**迁移**：手写 SQL 进 `supabase/migrations/`（本仓库惯例：research/ir 表不走
drizzle-generate，它会生成静默空迁移）。迁移完成后同步 `lib/db/schema.ts` 的
类型定义。⚠️ 迁移需我在 Supabase 后台手动执行，写完通知我，勿假设已生效。

**`ir_watches` 表**：

| 字段 | 规则 |
|---|---|
| `node_id` | NOT NULL → `ir_nodes.id`，`unique`（K1） |
| `origin` | `zeno_suggested` \| `user_requested` |
| `reason` | NOT NULL，人话（K6），进 UI |
| `cadence` | `daily` \| `every_3_days` \| `weekly`，默认 daily |
| `status` | `active` \| `paused`，默认 active（K7） |
| `model_id` | 可空；空 = 项目 research 模型设置（K9） |
| `last_patrol_at` / `last_signal_at` / `last_alert_at` | 稀缺性记账：冷却看 `last_alert_at`，周上限从 watchtower 来源的 `ir_nodes` 计数 |
| `next_due_at` | NOT NULL 默认 now()；部分索引 `where status='active'`（K8） |

**`research_run`**：加 `run_type`（`research` \| `patrol`，默认 research）和
可空 `watch_id`（`on delete set null` —— watch 删了，巡检历史留着）。

**`projects.agent_settings`**（jsonb，可空）：巡检总开关、默认 cadence、
research 模型。解析与默认值在代码层，不在 DB 层。

**状态与写入边界**：

- 信号不是表——信号 = 结果非空的 patrol run，内容哈希去重存 run 上。
- `ir_nodes.source_layer` check 约束扩一个值 `'watchtower'`。
- **不存在任何从 watchtower 代码路径改 `ir_nodes.status` 的写入**。告警候选的
  确认/驳回复用现有 candidate 流程，watchtower 不碰。
- RLS：`ir_watches` 按 `owns_project` 只读；写入只经服务端。

**Cron**：每日一个入口（`vercel.json` crons → `app/api/cron/watchtower/`），
鉴权 `Authorization: Bearer ${CRON_SECRET}`。每次 sweep 处理条数上限从
patrol budget 配置读取；到期未处理的靠 `next_due_at` 排序自然排到下轮头部。
未迁移的库上要干净返回，不许 500 风暴。

## 5. 界面（原型 + 规范性标注）

原型：Watchtower 面板 + 节点详情 Monitoring 区 + 告警候选卡片（原型链接
在项目空间；下表标注哪些必须一致、哪些可自行改进）。

| 部分 | 标注 |
|---|---|
| 告警卡片内联证据 diff（存档引文 vs 当前状态） | **normative**（K5） |
| watch 行必展示：目标节点 / 来源徽标 / reason / cadence / 上次巡检 / 开关 | **normative** |
| reason 文案必须含外部依赖 + 依赖它的下游（K6），空泛文案算验收失败 | **normative**，判据见 §6 R1 |
| 巡检中不打扰：无 toast、无红点，仅面板内状态更新 | **normative**（K4） |
| 面板排序、徽标样式、行密度、Monitoring 区折叠交互 | illustrative — 可改进 |
| 巡检历史展示形式 | illustrative — 待反馈收敛 |

## 6. 验收标准 `wt-accept-v0.1`

> 每条标注来源。机器可判的进测试（e2e 用 Playwright，DB 断言用 tsx 冒烟脚本，
> 走 `--conditions=react-server`，自清理种子数据——仓库现有惯例）。改巡检判定
> 逻辑必须全量重跑 §6b golden set。

### 6a. 机器可判（硬验收）

| ID | 输入 → 期望 | 来源 |
|---|---|---|
| WT-01 | 种子：带 L2 证据的 hypothesis → sweep 后出现 `zeno_suggested` watch，reason 非空 | K1, K6 |
| WT-02 | 巡检发现存档引文在源页消失 → 落一条 pending `open_question` 候选，`source_layer='watchtower'`，payload 含证据 diff | K3, K5 |
| WT-03 | 同一内容哈希的信号在冷却期内复现 → 不落第二条候选，仅记 patrol run | K4 |
| WT-04 | 本周该项目已有 N 条 watchtower 候选（N=周上限）→ 第 N+1 条被抑制，patrol run 记录抑制原因 | K4 |
| WT-05 | watch `status='paused'` → 到期不巡检；`agent_settings` 总开关关 → 全项目不巡检 | K7 |
| WT-06 | 无外部接地的用户自设 constraint、goal、principle → 永不出现在自动建议 | §2 never |
| WT-07 | 用户对任意节点手动"Watch this" → `user_requested` watch 创建成功（含 goal/principle） | §2 |
| WT-08 | cron 请求无 / 错 Bearer token → 401；未迁移库 → 200 + error 字段，非 500 | K8 |
| WT-09 | sweep 中单个 watch 巡检抛错 → 后续 watch 照常处理，结果含该条失败状态 | K8 |
| WT-10 | **DB 断言**：全量回归后，`ir_nodes` 无任何一行状态变更源于 watchtower 路径 | Iron Law |
| WT-11 | 删除 watch → 其 patrol run 保留（`watch_id` 置空），巡检历史不消失 | §4 |
| WT-12 | watch 设了 `model_id` → 该次巡检用指定模型；未设 → 用项目设置；前台质量旋钮变化不影响巡检模型 | K9 |

### 6b. 模型判定环节 — "页面实质性变化"检测 golden set

- 语料 30 组（快照 A, 快照 B, 标签），标签 ∈ {signal, no_signal}，存
  `tests/golden/watchtower/`。
- 必含分级样例：引文消失（signal）；页面改版但引文语义保留（no_signal，
  最易误报）；关键数字变更（signal）；仅广告/页脚变动（no_signal）；404（signal）。
- 通过线 v0.1：signal 召回 ≥ 90%，误报 ≤ 15%。改 prompt / 哈希策略 / 模型
  必须全量重跑。

### 6c. 人判 rubric（我按此评审，附对照）

**R1 · reason 质量**
✅「盯住此假设：其证据引用 OpenAI 定价页（4 月抓取），3 个活跃计划经
depends_on 依赖它。」（外部依赖 + 爆炸半径都说清）
❌「正在监控该节点。」／「建议持续关注外部动态。」（无一可证伪 → 打回）

**R2 · 告警候选质量**
✅「假设"竞品 X 无移动端"可能被推翻。反证：X 官网 7/12 新增 App Store 链接
（引文对照）。建议：revisit 或 supersede。」
❌「检测到页面更新，请查看。」（判断成本原样退还用户 → 打回）

### 6d. 反例集（任何一条出现 = P0，停迭代先修标准）

| ID | 永不事件 | 来源 |
|---|---|---|
| N1 | watchtower 任何路径直写 truth | Iron Law |
| N2 | 投递不带反证证据的告警 | K5 |
| N3 | 静默失效：watch 被丢弃不留痕 / 巡检连续失败无标记 | K8 |
| N4 | 绕过冷却或周上限的任何告警路径 | K4 |
| N5 | 为拉高确认率软化告警措辞、隐藏不利证据 | K5 |
| N6 | 巡检花费路由到非 economy 档（未显式覆盖时） | K9 |

### 6e. 未收敛项 — 交付假设 + 指标，不交付硬 spec

| 探索项 | v0.1 假设 | 判定指标 | 决议 |
|---|---|---|---|
| 变化检测阈值 | 召回 90 / 误报 15 可用 | 误报驱动的候选驳回占比 < 30% | 上线 4 周 |
| 告警周上限 N | N = 5 | 确认率 ≥ 50% 且无"被淹没"反馈 | 上线 4 周 |
| 默认 cadence | daily 不过度 | 巡检成本/项目/月 在预算内且信号密度 > 0 | 上线 4 周 |

**北极星：告警确认率**（用户确认 / 投递总量）——同时度量准确性与打扰度；
K5 禁止措辞优化，故不可 gaming。埋点从第一天开始。

## 7. 协作约定

- **标准未覆盖时不要停下来等我**：按最合理假设先做，在 PR 描述里记
  `ASSUMPTION:` 行（假设内容 + 你选它的理由）。每条假设我在评审时裁决：
  转正进下一版验收标准，或推翻并补反例。
- **每个逃逸缺陷 = 标准的 bug report**：修 bug 的 PR 必须同时回答"§6 缺哪条
  case 让它逃出去的"，补上并标来源。只修代码不补 case 的 PR 打回。
- 验收标准文件随代码进 git；每周一次 spec diff review，和 code review 同级。

## 8. 首日范围与里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1（本周） | 迁移 + `ir_watches` 查询层 + cron 骨架（空巡检） | WT-05/08/11 + 迁移我确认执行 |
| M2 | 巡检执行：引文 diff 检测 + patrol run 落库 | WT-02/03/09/10/12 + §6b golden set |
| M3 | 自动建议 sweep + Watchtower 面板 + 详情区 | WT-01/04/06/07 + §6c 人判 |

kickoff 首日只交付：本包 + 原型 happy path + §6a 的 12 条 case。标准从 v0.1
开始长——每个次品都是它的 bug report。
