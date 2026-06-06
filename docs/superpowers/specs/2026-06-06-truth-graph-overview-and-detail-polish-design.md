# Truth Graph Overview & Detail 打磨 — 设计文档

> 日期：2026-06-06
> 目标文件：`components/ir/truth-graph/truth-graph.tsx`、`lib/ir/fit-title.ts`、`components/ir/ir-detail.tsx`
> 配套：`zeno-ir-detail-revision-spec.md`（按钮集语义）、`zeno-confirmability-contract.md`（确认按钮条件显示的数据契约）、`docs/zeno-truth-graph-tokens.css`（视觉 token 单一来源）。

本文档涵盖 4 项用户反馈的打磨，决策已与用户确认（见每节「决策」）。

---

## 1. 节点必须全显示，禁止省略号

**问题**：overview 的每个 IR 节点标题用单行 SVG `<text>`，经 `fitTitleToWidth`（`lib/ir/fit-title.ts`）以 `…` 截断；节点尺寸写死（overview `168×34`、chain `218×44`）。

**决策（用户已批准）**：方案 A —— 纯 SVG 多行换行 + 节点高度自适应。

**实现要点**：
- 新增 `wrapTitleToLines(title, boxWidthPx, fontPx, reserve)`（放 `lib/ir/fit-title.ts`，复用现有 `glyphWidth`）：贪心折行成多行字符串数组。CJK 按字断行；拉丁优先按空格断词，超长单词按字断；不再产出 `…`。
- 高度自适应：`height = padY*2 + lineCount × lineHeight`。每个节点的真实高度在 ELK 布局**之前**算好并写入 `children[].height`（ELK 已按 per-node 尺寸布局，故无重叠）。overview 与 chain 各自的固定宽度不变（168 / 218），只让高度变化。
- 渲染：把单个 `<text>` 改为容器 `<text>` + 多个居中 `<tspan x={cx} dy={lineHeight}>`，垂直整体居中于 box。
- 兜底：行数超过阈值（约 4 行）时整节点降一档字号（13 → 11.5）再重新折行，**始终不省略**。
- 保留 `▷` / `✓` 前缀与 `? ` 后缀逻辑（前缀只占第一行的预留宽度）。
- 完整标题仍保留在 `aria-label` 与 `sr-only` 文本索引中。

**影响**：`nodeLabel` 由「返回单行字符串」改为「返回行数组 + 字号」；`GraphNode` 渲染多行；`createOverviewGraph` / `createChainGraph` 改为传入预算好的高度。`elbowPath` / `chainEdgePath` 基于 box 坐标，自动适配新高度，无需改。

---

## 2. 选中节点的「粗白边」bug

**根因**：`GraphNode` 的 `<g>` 带 `role="button" tabIndex={0}`，点击后获得焦点 → 浏览器默认 focus outline（白色粗圆角环）。overview 与 chain 共用 `GraphNode`，故两处都出现。**与选中描边（绿色 `--z-confirmed`）无关**。

**修复**：`<g>` 加 `className` `focus:outline-none`，并提供 `focus-visible` 的柔和键盘焦点指示（仅键盘 Tab 时出现，鼠标点击不再有白框）。一处改动，overview / chain 同时修复。

---

## 3. 删除「you selected」浮标

**位置**：`truth-graph.tsx` 的 `anchorLabel = isSelected ? "you selected" : isRoot ? "from here" : null`。

**修复**：去掉 `isSelected` 分支。保留 chain 中根节点的 `"from here"`（用户只点名删 "you selected"）。选中态已由颜色（绿）+ `✓` 前缀 + 加粗描边表达，浮标冗余。

---

## 4. Detail 面板：左右分栏 + 右侧固定动作列

**本轮范围（用户已确认）**：只做**按钮 + 布局**。spec §1 的内容区改造（关系分组、前提失效预警、状态人话、来历折叠、edges status 过滤）留到下一轮单独做。

### 4.1 布局
当前是「header / 滚动正文 / 底部按钮」纵向三段，按钮随内容在同块 `flex-wrap` 横排。改为左右两栏：

```
┌─ detail pane (底部 ~2/5 高) ───────────────────────────────┐
│ ┌ 左：内容区 (~62%, 可滚动) ┐ ┌ 右：动作区 (~38%, 固定不滚) ┐│
│ │ 类型 · 标题 · 状态 · 关闭  │ │  [带回 sandbox 重新评估] 主  ││
│ │ 为什么这么定 … 关系 … 来源 │ │  …按 status 分组的其余动作   ││
│ │ （内容多时仅此列滚动）     │ │  [✕ 否决] 破坏性, 置底       ││
│ └──────────────────────────┘ └─────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

- 比例 ~62 / 38（内容 : 动作），用户已确认。
- 右侧动作列**固定**：内容区滚动时按钮不动（左列各自 `overflow-y-auto`，右列不滚）。
- 右列内纵向排列：**主动作置顶、破坏性动作置底**（spec §2.8 原写"主动作在左"是横排语境，改右列纵排后调和为"主动作置顶"，已在此注明）。

### 4.2 按钮样式
对齐顶部 Header island（`workspace-header.tsx` 的 `ISLAND` 风格）：圆角、`--ir-border-default` 细描边、ghost 底色、`size="sm"`；主动作用语义色描边（确认=绿 `--z-confirmed` / 调研·失效=琥珀 `--z-attention`），其余中性。颜色一律引用 token，零字面值。

### 4.3 按钮集（按 spec §2 收敛）
| status | 现在 | 改为 |
|---|---|---|
| active | Supersede / Create next step / Ask AI / Bring to sandbox | **带回 sandbox 重新评估**（单一） |
| pending | Confirm / Edit & Confirm / Ignore | **✓ 确认为 truth**（条件显示）/ **✕ 否决** / **继续讨论** |
| idea | Promote / Dismiss / Bring to sandbox | 保留（Promote 目标=升 candidate） |
| superseded | Restore(禁用) / Bring to sandbox | 保留 |

- 删 Supersede、Create next step、Edit & Confirm 三个按钮。
- 删除底部编辑 Dialog（其两个调用方 Supersede / Edit & Confirm 都没了）。
- 保留 pending 的两个附加逻辑：① supersede 警告框；② 无 topicId 时先指派 topic。

### 4.4 confirmability 兜底（重要）
spec §2.2 要求 `✓ 确认为 truth` 按 candidate 的「明确/模糊」条件显示，依赖 `node.confirmability.status` 字段。**该字段当前 `lib/ir/types.ts` 不存在**（契约里由 Lixian/提取层产出）。

本轮兜底策略（前向兼容）：
- 读 `node.confirmability?.status`。
- `=== "needs_discussion"` → 隐藏确认按钮，显示「这其实是个待解决问题，继续讨论」+ `reason`。
- 否则（含字段缺省 `undefined`）→ **默认显示确认按钮**。字段到位后自动切换，无需再改前端布局。
- 类型层加可选字段 `confirmability?: { status: "ready" | "needs_discussion"; reason: string | null }`，与契约结构一致。

---

## 5. 不在本轮（明确排除）
- spec §1 内容区改造（关系三组人话、前提失效预警、状态解释句、来历折叠、edges status 过滤）。
- assumption「标记为已失效」/ fact 只读处理（属内容+联动，下一轮）。
- confirmability 字段的后端产出（Lixian 侧）。

---

## 6. 验收
- overview / chain 任何节点标题**完整可读**，无 `…`；节点不重叠、不溢出容器。
- 点击/选中任何节点**无白色粗边**；键盘 Tab 仍有可见焦点指示。
- 选中节点上方**无 "you selected"**。
- detail 面板左右分栏；右侧按钮在内容滚动时**固定不动**；按钮样式与顶部 Header 一致；按钮集符合 §4.3。
