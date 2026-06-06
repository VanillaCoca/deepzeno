# Truth Graph Overview & Detail 打磨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 truth graph 节点标题完整可读（不省略）、消除选中白边与 "you selected" 浮标、并把 detail 面板改成「左内容右固定按钮」的双栏布局且按钮集按 spec 收敛。

**Architecture:** 折行与节点高度测量做成 `lib/ir/fit-title.ts` 里的纯函数（可单测，遵循仓库"逻辑入 lib 并测试"惯例）；`truth-graph.tsx` 在 ELK 布局前用这些函数算出每个节点真实高度，渲染多行 `<tspan>`；`ir-detail.tsx` 重构为双栏，右栏动作列按 status 渲染、对齐顶部 Header 视觉。

**Tech Stack:** TypeScript, React, SVG, ELK (elkjs), Next.js；测试用 `node:test` + `tsx`；lint/format 用 `ultracite`，类型用 `tsc`。

参考 spec：`docs/superpowers/specs/2026-06-06-truth-graph-overview-and-detail-polish-design.md`。

---

## File Structure

- `lib/ir/fit-title.ts` — **修改**：新增纯函数 `wrapTitleToLines`（贪心折行）与 `fitNodeTitle`（折行 + 超长缩字号 + 高度）。保留现有 `fitTitleToWidth`（仍被单测覆盖）。
- `tests/unit/fit-title.test.ts` — **修改**：追加 `wrapTitleToLines` / `fitNodeTitle` 测试。
- `components/ir/truth-graph/truth-graph.tsx` — **修改**：节点高度自适应 + 多行渲染；修复 focus 白边；删 "you selected"。
- `lib/ir/types.ts` — **修改**：`IRNode` 加可选 `confirmability` 字段。
- `components/ir/ir-detail.tsx` — **修改**：双栏布局 + 右侧固定动作列 + 按钮集收敛 + 删编辑 Dialog。

---

## Task 1: `wrapTitleToLines` 纯函数（折行，不省略）

**Files:**
- Modify: `lib/ir/fit-title.ts`
- Test: `tests/unit/fit-title.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/fit-title.test.ts` 顶部 import 旁追加 import：

```ts
import { fitTitleToWidth, wrapTitleToLines } from "../../lib/ir/fit-title.ts";
```

（删除原来的单独 `import { fitTitleToWidth } ...` 行，合并成上面一行。）

在文件末尾追加：

```ts
describe("wrapTitleToLines", () => {
  it("returns a single line for a short title", () => {
    assert.deepEqual(wrapTitleToLines("先转 TD", 168, 13), ["先转 TD"]);
  });

  it("wraps a long CJK title into multiple lines with no ellipsis", () => {
    const lines = wrapTitleToLines(
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文",
      168,
      13
    );
    assert.ok(lines.length >= 2, `expected multiple lines, got ${lines.length}`);
    for (const line of lines) {
      assert.ok(!line.includes("…"), `line should not be truncated: ${line}`);
      assert.ok(
        measureWidth(line, 13) <= 168 - PADDING_PX,
        `line "${line}" width ${measureWidth(line, 13)} exceeds budget`
      );
    }
    // No characters dropped (spaces normalized away in this CJK case).
    assert.equal(
      lines.join(""),
      "结构化存储项目判断在AI对话之间无缝衔接保持上下文"
    );
  });

  it("breaks latin text at word boundaries, not mid-word", () => {
    const lines = wrapTitleToLines("alpha beta gamma delta epsilon", 120, 13);
    assert.ok(lines.length >= 2);
    // Every line is made of whole words from the original.
    const words = new Set("alpha beta gamma delta epsilon".split(" "));
    for (const line of lines) {
      for (const word of line.split(" ")) {
        assert.ok(words.has(word), `unexpected fragment: "${word}"`);
      }
    }
  });

  it("reserves first-line width for prefix/suffix", () => {
    const withReserve = wrapTitleToLines("一二三四五六七八九十", 168, 13, "✓  ?");
    const without = wrapTitleToLines("一二三四五六七八九十", 168, 13);
    // Reserving space can only push more characters to later lines.
    assert.ok(withReserve[0].length <= without[0].length);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/unit/fit-title.test.ts`
Expected: FAIL — `wrapTitleToLines is not a function` / not exported.

- [ ] **Step 3: 实现 `wrapTitleToLines`**

在 `lib/ir/fit-title.ts` 末尾追加（保留现有 `fitTitleToWidth` 不动）：

```ts
function isCjk(ch: string) {
  return /[　-鿿＀-￯]/.test(ch);
}

function widthOf(text: string, fontPx: number) {
  return [...text].reduce((sum, ch) => sum + glyphWidth(ch, fontPx), 0);
}

/**
 * Greedy line wrap that never truncates. CJK breaks per character; latin
 * breaks at spaces, and an overlong latin word falls back to per-character
 * breaking. `reserveText` shrinks only the first line's budget (for an
 * indicator prefix/suffix the caller renders separately).
 */
export function wrapTitleToLines(
  title: string,
  boxWidthPx: number,
  fontPx: number,
  reserveText = ""
): string[] {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [""];
  }

  const fullBudget = Math.max(1, boxWidthPx - PADDING_PX);
  const reserveWidth = widthOf(reserveText, fontPx);
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  let breakAt = -1; // index in `line` where a space allows a break

  const budget = () =>
    Math.max(1, fullBudget - (lines.length === 0 ? reserveWidth : 0));

  for (const ch of normalized) {
    const w = glyphWidth(ch, fontPx);

    if (line !== "" && lineWidth + w > budget()) {
      if (!isCjk(ch) && breakAt >= 0 && breakAt < line.length) {
        const head = line.slice(0, breakAt).trimEnd();
        const tail = line.slice(breakAt).trimStart();
        lines.push(head);
        line = tail;
        lineWidth = widthOf(line, fontPx);
      } else {
        lines.push(line.trimEnd());
        line = "";
        lineWidth = 0;
      }
      breakAt = -1;
    }

    if (ch === " ") {
      if (line === "") {
        continue; // drop leading space on a fresh line
      }
      line += ch;
      lineWidth += w;
      breakAt = line.length; // may break after this space
      continue;
    }

    line += ch;
    lineWidth += w;
    if (isCjk(ch)) {
      breakAt = line.length; // may break after any CJK char
    }
  }

  if (line.trimEnd() !== "" || lines.length === 0) {
    lines.push(line.trimEnd());
  }
  return lines;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/unit/fit-title.test.ts`
Expected: PASS — 原有 4 个 + 新增 4 个全过。

- [ ] **Step 5: 提交**

```bash
git add lib/ir/fit-title.ts tests/unit/fit-title.test.ts
git commit -m "feat(ir): add wrapTitleToLines for non-truncating node titles"
```

---

## Task 2: `fitNodeTitle` 纯函数（折行 + 超长缩字号 + 高度）

**Files:**
- Modify: `lib/ir/fit-title.ts`
- Test: `tests/unit/fit-title.test.ts`

- [ ] **Step 1: 写失败测试**

在 import 行补上 `fitNodeTitle`：

```ts
import {
  fitNodeTitle,
  fitTitleToWidth,
  wrapTitleToLines,
} from "../../lib/ir/fit-title.ts";
```

文件末尾追加：

```ts
describe("fitNodeTitle", () => {
  const base = {
    width: 168,
    baseFont: 13,
    padY: 9,
    maxLines: 4,
    shrinkFont: 11.5,
  };

  it("computes height for a single short line", () => {
    const r = fitNodeTitle({ title: "先转 TD", ...base });
    assert.equal(r.lines.length, 1);
    assert.equal(r.fontPx, 13);
    assert.equal(r.height, base.padY * 2 + r.lineHeight);
  });

  it("grows height with line count", () => {
    const r = fitNodeTitle({
      title: "结构化存储项目判断在AI对话之间无缝衔接保持上下文",
      ...base,
    });
    assert.ok(r.lines.length >= 2);
    assert.equal(r.height, base.padY * 2 + r.lines.length * r.lineHeight);
  });

  it("shrinks font when wrapping would exceed maxLines", () => {
    const long = "一二三四五六七八九十".repeat(8); // 80 CJK chars
    const r = fitNodeTitle({ title: long, ...base });
    assert.equal(r.fontPx, base.shrinkFont);
  });

  it("returns raw title lines without indicator prefix/suffix", () => {
    const r = fitNodeTitle({ title: "先转 TD", ...base, reserveText: "✓  ?" });
    assert.ok(!r.lines[0].startsWith("✓"));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/unit/fit-title.test.ts`
Expected: FAIL — `fitNodeTitle is not a function`.

- [ ] **Step 3: 实现 `fitNodeTitle`**

在 `lib/ir/fit-title.ts` 末尾追加：

```ts
export type NodeTitleLayout = {
  lines: string[];
  fontPx: number;
  lineHeight: number;
  height: number;
};

/**
 * Wrap a node title to fit `width`; if it needs more than `maxLines`,
 * re-wrap one font size down (`shrinkFont`). Never truncates. Returns raw
 * title lines (no indicator) plus the box height needed to contain them.
 */
export function fitNodeTitle({
  title,
  width,
  baseFont,
  reserveText = "",
  padY,
  maxLines,
  shrinkFont,
}: {
  title: string;
  width: number;
  baseFont: number;
  reserveText?: string;
  padY: number;
  maxLines: number;
  shrinkFont: number;
}): NodeTitleLayout {
  let fontPx = baseFont;
  let lines = wrapTitleToLines(title, width, fontPx, reserveText);
  if (lines.length > maxLines) {
    fontPx = shrinkFont;
    lines = wrapTitleToLines(title, width, fontPx, reserveText);
  }
  const lineHeight = Math.round(fontPx * 1.3);
  const height = padY * 2 + lines.length * lineHeight;
  return { lines, fontPx, lineHeight, height };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --import tsx --test tests/unit/fit-title.test.ts`
Expected: PASS — 全部通过。

- [ ] **Step 5: 提交**

```bash
git add lib/ir/fit-title.ts tests/unit/fit-title.test.ts
git commit -m "feat(ir): add fitNodeTitle for adaptive node height"
```

---

## Task 3: truth-graph 节点多行渲染 + 高度自适应

**Files:**
- Modify: `components/ir/truth-graph/truth-graph.tsx`

> 无组件测试框架；本任务靠 `tsc` + `ultracite` + 运行 app 目测验收。

- [ ] **Step 1: 改 import 与节点尺寸常量**

把第 4 行：

```ts
import { fitTitleToWidth } from "@/lib/ir/fit-title";
```

改为：

```ts
import { fitNodeTitle } from "@/lib/ir/fit-title";
```

把第 71-72 行：

```ts
const OVERVIEW_NODE = { width: 168, height: 34 };
const CHAIN_NODE = { width: 218, height: 44 };
```

改为：

```ts
const OVERVIEW_DIMS = { width: 168, baseFont: 13, padY: 9 };
const CHAIN_DIMS = { width: 218, baseFont: 13, padY: 13 };
const NODE_MAX_LINES = 4;
const NODE_SHRINK_FONT = 11.5;

// Reserve text is stable per node (worst-case indicator width) so a node's
// height never changes when it becomes selected/root — avoids relayout jitter.
function nodeReserveText(node: IRNode) {
  return `✓ ${node.kind === "open_question" ? " ?" : ""}`;
}

function measureNode(
  node: IRNode,
  dims: { width: number; baseFont: number; padY: number }
) {
  return fitNodeTitle({
    title: node.title,
    width: dims.width,
    baseFont: dims.baseFont,
    reserveText: nodeReserveText(node),
    padY: dims.padY,
    maxLines: NODE_MAX_LINES,
    shrinkFont: NODE_SHRINK_FONT,
  });
}
```

- [ ] **Step 2: createOverviewGraph / createChainGraph 用真实高度**

`createOverviewGraph` 内 `children: group.nodes.map(...)`（约 114-118 行）改为：

```ts
      children: group.nodes.map((node) => ({
        id: node.id,
        width: OVERVIEW_DIMS.width,
        height: measureNode(node, OVERVIEW_DIMS).height,
      })),
```

`createChainGraph` 内 `children: [...chainNodeIds].map(...)`（约 137-141 行）改为：

```ts
    children: [...chainNodeIds].map((nodeId) => {
      const node = model.nodeById.get(nodeId);
      const height = node
        ? measureNode(node, CHAIN_DIMS).height
        : CHAIN_DIMS.padY * 2 + 17;
      return { id: nodeId, width: CHAIN_DIMS.width, height };
    }),
```

> `createChainGraph` 需访问 `model.nodeById`，它已有 `model` 形参，无需改签名。

- [ ] **Step 3: 删除 `nodeLabel`，改 GraphNode 多行渲染**

删除 `nodeLabel` 函数（约 274-287 行，整个函数）。

在 `GraphNode` 内，把：

```ts
  const tone = nodeTone({ isOnChain, isSelected, node });
  const strokeWidth = isSelected
    ? "var(--z-stroke-w-target)"
    : "var(--z-stroke-w)";
  const title = nodeLabel({ isRoot, isSelected, node });
  const anchorLabel = isSelected ? "you selected" : isRoot ? "from here" : null;
  const selectNode = () => onSelect(node.id);
```

改为：

```ts
  const tone = nodeTone({ isOnChain, isSelected, node });
  const strokeWidth = isSelected
    ? "var(--z-stroke-w-target)"
    : "var(--z-stroke-w)";
  const dims = box.width >= CHAIN_DIMS.width ? CHAIN_DIMS : OVERVIEW_DIMS;
  const { lines, fontPx, lineHeight } = measureNode(node, dims);
  const displayPrefix = isRoot ? "▷ " : isSelected ? "✓ " : "";
  const displaySuffix = node.kind === "open_question" ? " ?" : "";
  const renderLines = lines.map(
    (line, index) =>
      `${index === 0 ? displayPrefix : ""}${line}${index === lines.length - 1 ? displaySuffix : ""}`
  );
  const cx = box.x + box.width / 2;
  const blockTop = box.y + (box.height - lines.length * lineHeight) / 2;
  const anchorLabel = isRoot ? "from here" : null;
  const selectNode = () => onSelect(node.id);
```

> 说明：`anchorLabel` 去掉 `isSelected` 分支即完成点③「删 you selected」，保留 root 的 "from here"。

把 `<text>...{title}</text>` 块（约 365-377 行）整段替换为：

```tsx
      <text
        dominantBaseline="central"
        fill={tone.text}
        fontFamily="var(--z-font-sans)"
        fontSize={fontPx}
        fontWeight={isSelected ? "600" : "500"}
        textAnchor="middle"
        textDecoration={tone.decoration}
      >
        {renderLines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: line order is stable for a given title
          <tspan key={index} x={cx} y={blockTop + lineHeight / 2 + index * lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
```

- [ ] **Step 4: 类型与 lint**

Run: `npx tsc --noEmit`
Expected: 无错误（注意 `fitTitleToWidth` 已不再被 import；若其它处仍引用会报错——本文件唯一引用已替换）。

Run: `pnpm check`
Expected: 无错误（biome-ignore 注释已就位）。

- [ ] **Step 5: 提交**

```bash
git add components/ir/truth-graph/truth-graph.tsx
git commit -m "feat(truth-graph): full multi-line node titles with adaptive height, drop 'you selected'"
```

---

## Task 4: 修复选中「粗白边」(focus outline)

**Files:**
- Modify: `components/ir/truth-graph/truth-graph.tsx`

- [ ] **Step 1: 给可聚焦的 `<g>` 去掉默认 outline 并加柔和键盘焦点环**

在 `GraphNode` 的 `<g>` 上，把：

```tsx
      className="cursor-pointer"
```

改为：

```tsx
      className="cursor-pointer outline-none [&:focus-visible>:first-child]:[stroke:var(--z-confirmed)] focus-visible:[outline:none]"
```

> 解释：`outline-none` 移除点击后浏览器画的白色粗 focus 环（点③的根因）。`:focus-visible`（仅键盘 Tab）时把节点的第一个子元素（`<rect>`/`<polygon>` 形状）描边提亮为确认绿，保留可达性指示，鼠标点击不再出现白框。overview 与 chain 共用 `GraphNode`，一处修复两处生效。

- [ ] **Step 2: 类型与 lint**

Run: `npx tsc --noEmit`
Expected: 无错误。

Run: `pnpm check`
Expected: 无错误。

- [ ] **Step 3: 运行 app 目测验收（点①②③）**

启动 dev（参考 `/run` skill 或 `pnpm dev`），打开 Truth Graph：
- 节点标题**完整无 `…`**，多行居中，不重叠不溢出。
- 点击任一节点**无白色粗边**；键盘 Tab 到节点有柔和绿色焦点描边。
- 选中节点上方**无 "you selected"**；chain 根节点仍显示 "from here"。

- [ ] **Step 4: 提交**

```bash
git add components/ir/truth-graph/truth-graph.tsx
git commit -m "fix(truth-graph): remove default focus outline white border on node select"
```

---

## Task 5: `IRNode` 加可选 `confirmability` 字段

**Files:**
- Modify: `lib/ir/types.ts`

- [ ] **Step 1: 在 `IRNode` 类型里加可选字段**

打开 `lib/ir/types.ts`，在 `export type IRNode = { ... }`（约 42 行起）内，于已有字段之后追加一行：

```ts
  confirmability?: {
    status: "ready" | "needs_discussion";
    reason: string | null;
  } | null;
```

> 与 `zeno-confirmability-contract.md` §2 的结构一致。可选 + 可空，便于字段未产出时前向兼容（见 Task 6 兜底）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add lib/ir/types.ts
git commit -m "feat(ir): add optional confirmability field to IRNode"
```

---

## Task 6: ir-detail 双栏布局 + 固定动作列 + 按钮集收敛

**Files:**
- Modify: `components/ir/ir-detail.tsx`

> 本任务整文件替换 `IRDetailPane` 及其 import/Dialog。范围 = 按钮 + 布局；内容区文案/关系重构留下一轮。

- [ ] **Step 1: 用以下完整内容替换 `components/ir/ir-detail.tsx`**

```tsx
"use client";

import {
  ArrowDownToLineIcon,
  CheckIcon,
  CircleDotIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { useIR } from "@/components/ir/ir-provider";
import { kindPresentation } from "@/components/ir/kind-presentation";
import type { useIRActions } from "@/components/ir/use-ir-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import type { IRDetail, IRNode } from "@/lib/ir/types";

// Shared action-button look, aligned with the floating WorkspaceHeader island:
// full-width, rounded, hairline border, ghost fill, hover tint.
const ACTION_BTN =
  "w-full justify-start gap-2 rounded-lg border border-[var(--ir-border-default)] bg-transparent text-[var(--ir-text-secondary)] hover:bg-[var(--ir-bg-hover)]";
const ACTION_CONFIRM =
  "w-full justify-start gap-2 rounded-lg border border-[var(--z-confirmed)] bg-transparent text-[var(--z-confirmed)] hover:bg-[var(--ir-bg-hover)]";
const ACTION_SANDBOX =
  "w-full justify-start gap-2 rounded-lg border border-[var(--z-attention)] bg-transparent text-[var(--z-attention-text)] hover:bg-[var(--ir-bg-hover)]";
const ACTION_PROMOTE =
  "w-full justify-start gap-2 rounded-lg border border-[var(--ir-accent-blue-border)] bg-transparent text-[var(--ir-accent-blue)] hover:bg-[var(--ir-bg-hover)]";

export function StatusBadge({ status }: { status: IRNode["status"] }) {
  return (
    <span className="text-[11px] lowercase text-[var(--ir-text-secondary)]">
      {status}
    </span>
  );
}

function DetailRelationList({
  detail,
  onSelect,
}: {
  detail: IRDetail;
  onSelect: (nodeId: string) => void;
}) {
  const relatedById = new Map(
    detail.relatedNodes.map((node) => [node.id, node])
  );

  if (detail.edges.length === 0) {
    return (
      <p className="text-sm text-[var(--ir-text-tertiary)]">No relations.</p>
    );
  }

  return (
    <div>
      {detail.edges.map((edge) => {
        const isOutgoing = edge.fromNode === detail.node.id;
        const targetId = isOutgoing ? edge.toNode : edge.fromNode;
        const related = relatedById.get(targetId);

        return (
          <button
            className="flex w-full items-center gap-2 border-b border-[var(--ir-border-default)] px-1 py-2 text-left text-sm hover:bg-[var(--ir-bg-hover)]"
            key={edge.id}
            onClick={() => onSelect(targetId)}
            type="button"
          >
            <span className="text-[11px] lowercase text-[var(--ir-text-tertiary)]">
              {isOutgoing ? edge.relation : `${edge.relation} by`}
            </span>
            <span className="min-w-0 flex-1 text-[var(--ir-text-primary)]">
              {targetId} · {related?.title ?? "Unknown"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ActionColumn({
  actions,
  detail,
  selectedNode,
}: {
  actions: ReturnType<typeof useIRActions>;
  detail: IRDetail | undefined;
  selectedNode: IRNode;
}) {
  const { queueReferenceDraft } = useWorkspace();
  const confirmability = selectedNode.confirmability;
  // Forward-compatible default: until Lixian produces the field, treat absent
  // as confirmable (contract zeno-confirmability-contract.md §4).
  const needsDiscussion = confirmability?.status === "needs_discussion";

  if (selectedNode.status === "active") {
    return (
      <Button
        className={ACTION_SANDBOX}
        onClick={() => actions.handleBringToSandbox(selectedNode)}
        size="sm"
        variant="outline"
      >
        <ArrowDownToLineIcon className="size-4" />
        带回 sandbox 重新评估
      </Button>
    );
  }

  if (selectedNode.status === "pending") {
    return (
      <>
        {detail?.edges.some(
          (edge) =>
            edge.fromNode === selectedNode.id &&
            edge.relation === "supersedes"
        ) ? (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] px-2 py-2 text-xs text-[var(--ir-warning-fg)]">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
            确认这条会把一条旧 IR 节点标记为已取代。
          </div>
        ) : null}
        {selectedNode.topicId ? null : (
          <div className="flex flex-col gap-2 rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2">
            <p className="text-xs font-medium text-[var(--ir-text-primary)]">
              确认前先归入一个判断
            </p>
            <select
              className="h-8 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] px-2 text-xs"
              onChange={(event) =>
                actions.setAssignmentTopicId(event.target.value)
              }
              value={actions.assignmentTopicId}
            >
              {actions.assignableTopics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.label}
                </option>
              ))}
            </select>
            <Input
              className="h-8 rounded border-[var(--ir-border-default)] bg-[var(--ir-bg-panel)] text-xs focus-visible:ring-0"
              onChange={(event) => actions.setNewTopicLabel(event.target.value)}
              placeholder="或新建一个判断"
              value={actions.newTopicLabel}
            />
          </div>
        )}
        {needsDiscussion ? (
          <div className="rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 py-2 text-xs text-[var(--ir-text-secondary)]">
            这其实是个待解决问题，继续讨论。
            {confirmability?.reason ? (
              <span className="mt-1 block text-[var(--ir-text-tertiary)]">
                {confirmability.reason}
              </span>
            ) : null}
          </div>
        ) : (
          <Button
            className={ACTION_CONFIRM}
            disabled={actions.isMutating}
            onClick={() => actions.handleConfirmNode(selectedNode)}
            size="sm"
            variant="outline"
          >
            <CheckIcon className="size-4" />
            确认为 truth
          </Button>
        )}
        <Button
          className={ACTION_SANDBOX}
          onClick={() => actions.handleBringToSandbox(selectedNode)}
          size="sm"
          variant="outline"
        >
          <ArrowDownToLineIcon className="size-4" />
          继续讨论
        </Button>
        <Button
          className={cn(ACTION_BTN, "mt-auto")}
          disabled={actions.isMutating}
          onClick={() => actions.handleDismissCandidate(selectedNode)}
          size="sm"
          variant="outline"
        >
          <XIcon className="size-4" />
          否决
        </Button>
      </>
    );
  }

  if (selectedNode.status === "idea") {
    return (
      <>
        <Button
          className={ACTION_PROMOTE}
          disabled={actions.isMutating}
          onClick={() => actions.handlePromoteIdea(selectedNode)}
          size="sm"
          variant="outline"
        >
          <CircleDotIcon className="size-4" />
          升为候选
        </Button>
        <Button
          className={ACTION_SANDBOX}
          onClick={() => actions.handleBringToSandbox(selectedNode)}
          size="sm"
          variant="outline"
        >
          <ArrowDownToLineIcon className="size-4" />
          带回 sandbox 讨论
        </Button>
        <Button
          className={cn(ACTION_BTN, "mt-auto")}
          disabled={actions.isMutating}
          onClick={() => actions.handleDismissIdea(selectedNode)}
          size="sm"
          variant="outline"
        >
          <XIcon className="size-4" />
          忽略
        </Button>
      </>
    );
  }

  if (selectedNode.status === "superseded") {
    return (
      <>
        <Button className={ACTION_BTN} disabled size="sm" variant="outline">
          恢复
        </Button>
        <Button
          className={ACTION_SANDBOX}
          onClick={() => actions.handleBringToSandbox(selectedNode)}
          size="sm"
          variant="outline"
        >
          <ArrowDownToLineIcon className="size-4" />
          带回 sandbox 讨论
        </Button>
      </>
    );
  }

  // Fallback (e.g. dismissed): a single reference action.
  return (
    <Button
      className={ACTION_BTN}
      onClick={() =>
        queueReferenceDraft(
          `> [${selectedNode.id}] ${selectedNode.title}\n> ${selectedNode.content ?? selectedNode.title}`
        )
      }
      size="sm"
      variant="outline"
    >
      <ArrowDownToLineIcon className="size-4" />
      带回 sandbox 讨论
    </Button>
  );
}

export type IRDetailPaneProps = {
  actions: ReturnType<typeof useIRActions>;
  detail: IRDetail | undefined;
  selectedNode: IRNode | null;
};

/**
 * Must be rendered inside both `IRProvider` and `WorkspaceProvider` —
 * it reads `selectNode` and `queueReferenceDraft` from those contexts.
 */
export function IRDetailPane({
  actions,
  detail,
  selectedNode,
}: IRDetailPaneProps) {
  const { selectNode } = useIR();

  if (!selectedNode) {
    return (
      <div
        className="flex h-full flex-col justify-center px-4 text-sm text-[var(--ir-text-tertiary)]"
        data-testid="ir-detail-pane"
      >
        <p className="font-medium text-[var(--ir-text-primary)]">Detail</p>
        <p>Select an idea, candidate, IR node, or inline reference.</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-[220px] overflow-hidden"
      data-testid="ir-detail-pane"
    >
      {/* LEFT: scrollable content (~62%) */}
      <div className="flex min-w-0 basis-[62%] flex-col overflow-hidden border-r border-[var(--ir-border-default)]">
        <div className="flex items-start justify-between gap-2 border-b border-[var(--ir-border-default)] px-3 py-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--ir-text-secondary)]">
              {kindPresentation(selectedNode.kind, selectedNode.subtype).label}
            </p>
            <h3 className="mt-1 break-words text-base font-medium leading-[1.35] text-[var(--ir-text-primary)]">
              {selectedNode.title}
            </h3>
            <div className="mt-1">
              <StatusBadge status={selectedNode.status} />
            </div>
          </div>
          <Button
            className="rounded border border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
            onClick={() => selectNode(null)}
            size="icon-sm"
            variant="outline"
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <section className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
              Rationale
            </p>
            <p className="whitespace-pre-wrap text-sm leading-[1.55] text-[var(--ir-text-primary)]">
              {selectedNode.rationale ||
                selectedNode.content ||
                selectedNode.title}
            </p>
          </section>

          <section className="mt-4 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
              Relations
            </p>
            {detail ? (
              <DetailRelationList detail={detail} onSelect={selectNode} />
            ) : (
              <p className="text-sm text-[var(--ir-text-tertiary)]">
                Loading...
              </p>
            )}
          </section>

          <section className="mt-4 space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--ir-text-tertiary)]">
              Source
            </p>
            <p className="text-sm leading-[1.55] text-[var(--ir-text-secondary)]">
              {selectedNode.sourceLayer ?? "manual"} ·{" "}
              {new Date(selectedNode.createdAt).toLocaleString()}
            </p>
          </section>

          {selectedNode.kind === "unclassified" ? (
            <section className="mt-4 space-y-2 border border-[var(--ir-warning-stripe)] bg-[var(--ir-warning-bg)] p-2">
              <p className="text-xs font-semibold text-[var(--ir-warning-fg)]">
                Kind: not yet classified
              </p>
              <div className="flex gap-2">
                <select
                  className="h-8 min-w-0 flex-1 rounded border border-[var(--ir-border-default)] bg-[var(--ir-bg-elevated)] px-2 text-xs"
                  onChange={(event) => actions.setKindChoice(event.target.value)}
                  value={actions.kindChoice}
                >
                  <option value="plan:decision">plan / decision</option>
                  <option value="plan:task">plan / task</option>
                  <option value="plan:milestone">plan / milestone</option>
                  <option value="goal:_">goal</option>
                  <option value="constraint:_">constraint</option>
                  <option value="open_question:_">open question</option>
                  <option value="hypothesis:_">hypothesis</option>
                  <option value="principle:_">principle</option>
                  <option value="rejection:_">rejection</option>
                </select>
                <Button
                  className="rounded border-[var(--ir-border-strong)] bg-transparent hover:bg-[var(--ir-bg-hover)]"
                  disabled={actions.isMutating}
                  onClick={() => actions.handleReclassify(selectedNode)}
                  size="sm"
                  variant="outline"
                >
                  Use
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {/* RIGHT: fixed action column (~38%) */}
      <aside className="flex basis-[38%] flex-col gap-2 overflow-y-auto px-3 py-3">
        <ActionColumn
          actions={actions}
          detail={detail}
          selectedNode={selectedNode}
        />
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。若报「`openEdit` / `editMode` 等未使用」——它们在 `use-ir-actions.ts` 仍是导出成员，本文件不再调用不会报错；TS 不会因"导出但未被某消费者使用"报错。

- [ ] **Step 3: lint/format**

Run: `pnpm check`
Expected: 无错误。若 biome 提示 import 排序，运行 `pnpm fix` 后复查。

- [ ] **Step 4: 运行 app 目测验收（点④）**

打开某个 truth 节点的 detail：
- 左内容（~62%）可滚动；右动作列（~38%）随左侧滚动**保持不动**。
- 按钮样式与顶部 Header island 一致（圆角、细描边、hover 提示）；确认=绿、带回 sandbox/继续讨论=琥珀、否决=置底中性。
- active 只剩「带回 sandbox 重新评估」；pending 显示 确认 / 继续讨论 / 否决（无 Edit & Confirm）；编辑 Dialog 已不存在。

- [ ] **Step 5: 提交**

```bash
git add components/ir/ir-detail.tsx
git commit -m "feat(ir-detail): two-column layout with fixed action rail, consolidated buttons"
```

---

## Task 7: 整体验收

**Files:** 无（仅运行命令）

- [ ] **Step 1: 单元测试全绿**

Run: `node --import tsx --test tests/unit/fit-title.test.ts tests/unit/truth-graph.test.ts`
Expected: all pass。

- [ ] **Step 2: 类型 + lint**

Run: `npx tsc --noEmit`
Run: `pnpm check`
Expected: 均无错误。

- [ ] **Step 3: 对照 spec 验收清单逐条目测**

按 design 文档 §6：节点完整无省略号 / 无白边 / 键盘焦点可见 / 无 "you selected" / detail 双栏 + 右栏固定 + 按钮对齐 Header + 按钮集正确。

- [ ] **Step 4: 最终提交（若有 lint fix 等零散改动）**

```bash
git add -A
git commit -m "chore: truth graph overview & detail polish verification"
```
```

---

## Self-Review

**Spec coverage:** design §1（节点全显示）→ Task 1-3；§2（白边）→ Task 4；§3（you selected）→ Task 3 Step 3；§4.1-4.2（双栏+样式）→ Task 6；§4.3（按钮集）→ Task 6 ActionColumn；§4.4（confirmability 兜底）→ Task 5 + Task 6 `needsDiscussion`。全部覆盖。

**Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码。

**Type consistency:** `wrapTitleToLines`/`fitNodeTitle`/`NodeTitleLayout` 在 Task 1-2 定义，Task 3 `measureNode` 调用签名一致；`confirmability` 字段 Task 5 定义、Task 6 读取结构一致（`status` / `reason`）。
