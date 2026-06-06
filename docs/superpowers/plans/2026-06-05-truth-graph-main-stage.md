# Truth Graph Main Stage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the truth graph the full-width primary stage of the workspace, move Ideas/Candidates into an on-demand slide-over drawer, remove the Agent Activity UI, and fix the graph's scaling/long-title rendering.

**Architecture:** Add a `Conversation | Truth Graph` view switch + global Ideas/Candidates count pills to the center area of `workspace-shell`. Decompose the 1203-line `IRPanel` into a `TruthGraphStage` (the Truth Graph view: overview + chain + truth-node detail) and an `IRDrawer` (overlay: idea/candidate lists, triage, re-entry, modals). The old right-side `aside` is retired. The `TruthGraph` SVG switches from stretch-to-fit to fixed-pixel scale with fit-aware titles.

**Tech Stack:** Next.js (App Router) + React client components, Tailwind v4 + design tokens in `app/globals.css` / `docs/zeno-truth-graph-tokens.css`, SWR, ELK.js (`elkjs/lib/elk.bundled.js`), Biome (ultracite) for lint/format, `node:test` for unit tests, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-06-05-truth-graph-main-stage-design.md`

**Testing note:** Tasks 1–4 are structural UI moves; their verification is `pnpm build` + targeted Playwright e2e + Biome, not per-step unit tests (no isolated logic to assert). Tasks 5–6 add real logic and use `node:test` TDD. This deviation from per-step unit TDD is deliberate and matches the move-heavy nature of the refactor.

---

## File Structure

**Created:**
- `components/workspace/workspace-toolbar.tsx` — view switch + Ideas/Candidates count pills. Pure presentational; props for current view, counts, and click handlers.
- `components/ir/ir-drawer.tsx` — slide-over overlay hosting idea/candidate lists, triage actions, re-entry banner, edit/supersede dialog, and idea/candidate detail. Owns the triage state/handlers moved out of `IRPanel`.
- `components/ir/truth-graph-stage.tsx` — the Truth Graph view: full-width `TruthGraph` + selected-truth-node detail pane.
- `components/ir/ir-detail.tsx` — shared selected-node detail (header, rationale, relations, source, status-specific action bar, reclassify, edit dialog). Consumed by both `IRDrawer` and `TruthGraphStage`.
- `components/ir/use-ir-actions.ts` — hook extracting the mutation handlers (`runMutation`, `handleConfirmNode`, `handleBringToSandbox`, `handleCreateNextStep`, `handleReclassify`, `openEdit`, `submitEditDialog`, edit-dialog state) shared by drawer + detail.
- `lib/ir/fit-title.ts` — width-aware, CJK-aware single-line title truncation for graph nodes.
- `tests/unit/fit-title.test.ts` — unit tests for `fitTitleToWidth`.

**Modified:**
- `components/workspace-shell.tsx` — remove Agent Activity; add view state + toolbar; mount `TruthGraphStage` as a view and `IRDrawer` as an overlay; retire the `aside`.
- `components/ir/truth-graph/truth-graph.tsx` — fixed-scale SVG rendering + use `fitTitleToWidth`.
- `components/ir/ir-panel.tsx` — deleted after its pieces are extracted.

**Deleted (UI only, backend stays):**
- Agent Activity imports/JSX in `workspace-shell.tsx`. `components/workspace/agent-activity-panel.tsx`, `lib/agent-activity.ts`, and `app/api/projects/[projectId]/agent-activity/*` remain on disk, unreferenced.

---

## Phase 1 — Structure

### Task 1: Remove Agent Activity from the UI

**Files:**
- Modify: `components/workspace-shell.tsx`

- [ ] **Step 1: Delete the Agent Activity import and icon**

In `components/workspace-shell.tsx`, remove the `ActivityIcon` from the `lucide-react` import (line ~4) and delete the import:
```tsx
import { AgentActivityPanel } from "@/components/workspace/agent-activity-panel";
```

- [ ] **Step 2: Collapse the right-panel mode to IR-only**

Replace the mode types/state (lines ~20–21, ~51–66) so there is no `agent-activity` mode. Delete:
```tsx
type RightPanelMode = "ir" | "agent-activity";
type StoredRightPanelMode = RightPanelMode | "truth";
```
and the `rightPanelMode` `useLocalStorage`, `activeRightPanelMode`, and the `useEffect` that migrates `"truth"`. Anywhere `openRightPanel("agent-activity")` / `setRightPanelMode("agent-activity")` was used is removed in the next steps.

- [ ] **Step 3: Delete the segmented control and the second open button**

Remove the `<div className="flex rounded-lg border …">` segmented control block (the two `Button`s "IR Panel" / "Agent Activity", lines ~141–172) and the standalone "Agent Activity" open `Button` (lines ~202–210). The panel header keeps only the close button.

- [ ] **Step 4: Render the IR panel unconditionally**

Replace the conditional (lines ~184–188):
```tsx
{activeRightPanelMode === "agent-activity" ? (
  <AgentActivityPanel onViewDecision={handleViewDecision} />
) : (
  <IRPanel />
)}
```
with `<IRPanel />`. Remove the now-unused `handleViewDecision` and `setSelectedDecisionId`/`useWorkspace` destructure if no longer referenced (verify with the compiler in Step 5).

- [ ] **Step 5: Verify the build and that Agent Activity is gone from the UI**

Run: `pnpm exec tsc --noEmit` → Expected: no errors referencing `workspace-shell`.
Run: `pnpm exec biome check components/workspace-shell.tsx` → Expected: no errors (fix attribute-sort/format if reported).
Run (PowerShell): `Select-String -Path components -Pattern "agent-activity|AgentActivityPanel|ActivityIcon" -Recurse` → Expected: only matches inside `components/workspace/agent-activity-panel.tsx` (the dormant file), none in `workspace-shell.tsx`.

- [ ] **Step 6: Commit**

```bash
git add components/workspace-shell.tsx
git commit -m "Remove Agent Activity from workspace UI"
```

---

### Task 2: Extract shared IR actions hook

**Files:**
- Create: `components/ir/use-ir-actions.ts`
- Modify: `components/ir/ir-panel.tsx` (temporarily import from the hook to prove parity)

- [ ] **Step 1: Create the hook with the mutation logic moved verbatim**

Create `components/ir/use-ir-actions.ts`. Move these from `ir-panel.tsx` unchanged: `postJSON` (lines 37–53), `EditMode` type, and the handlers `runMutation`, `openEdit`, `submitEditDialog`, `handleReclassify`, `handleBringToSandbox`, `handleCreateNextStep`, `handleConfirmNode`, plus the edit-dialog state (`editMode`, `draftTitle`, `draftContent`, `draftRationale`, `kindChoice`, `assignmentTopicId`, `newTopicLabel`, `isMutating`) and `getAssignmentPayload`. Expose them via a hook:
```ts
export function useIRActions(selectedNode: IRNode | null, mutateDetail: () => Promise<unknown>) {
  // …all state + handlers above…
  return { isMutating, editMode, setEditMode, draftTitle, setDraftTitle,
    draftContent, setDraftContent, draftRationale, setDraftRationale,
    kindChoice, setKindChoice, assignmentTopicId, setAssignmentTopicId,
    newTopicLabel, setNewTopicLabel, runMutation, openEdit, submitEditDialog,
    handleReclassify, handleBringToSandbox, handleCreateNextStep, handleConfirmNode };
}
```
Keep dependencies (`useWorkspace`, `useIR`, `toast`, `postJSON`) inside the hook. `postJSON` is also re-exported for reuse.

- [ ] **Step 2: Consume the hook from `ir-panel.tsx`**

Delete the moved definitions from `ir-panel.tsx`; replace with `const actions = useIRActions(selectedNode, mutateDetail);` and update call sites to `actions.*`.

- [ ] **Step 3: Verify parity**

Run: `pnpm exec tsc --noEmit` → Expected: no errors.
Run: `pnpm exec biome check components/ir/use-ir-actions.ts components/ir/ir-panel.tsx` → Expected: clean.
Run: `pnpm exec playwright test tests/e2e/workspace-phase2.test.ts` → Expected: same pass/fail set as before this task (record baseline first with `git stash` if unsure).

- [ ] **Step 4: Commit**

```bash
git add components/ir/use-ir-actions.ts components/ir/ir-panel.tsx
git commit -m "Extract shared IR actions into useIRActions hook"
```

---

### Task 3: Extract the shared Detail component

**Files:**
- Create: `components/ir/ir-detail.tsx`
- Modify: `components/ir/ir-panel.tsx`

- [ ] **Step 1: Create `IRDetail` from the detail-pane JSX**

Create `components/ir/ir-detail.tsx` exporting `IRDetailPane`. Move the detail JSX (`ir-panel.tsx` lines 865–1155: header, rationale, relations via `DetailRelationList`, source, reclassify section, and the status-specific action bars for `active`/`pending`/`idea`/`superseded`) and the edit `Dialog` (lines 1157–1200). Also move helper components `StatusBadge`, `getNodeTypeLabel`, and `DetailRelationList` (find its definition near line 156). Props:
```tsx
type IRDetailPaneProps = {
  selectedNode: IRNode | null;
  detail: IRDetail | undefined;
  actions: ReturnType<typeof useIRActions>;
  assignableTopics: { id: string; label: string }[];
  onClose: () => void;
};
```
The component reads `actions.*` for handlers/state and calls `selectNode`/`queueReferenceDraft` via `useIR()`/`useWorkspace()` directly (as today).

- [ ] **Step 2: Consume `IRDetailPane` in `ir-panel.tsx`**

Replace the inline detail block + dialog with `<IRDetailPane … />`, passing `selectedNode`, `detail`, `actions`, `assignableTopics`, and `onClose={() => selectNode(null)}`.

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` → Expected: no errors.
Run: `pnpm exec biome check components/ir/ir-detail.tsx` → Expected: clean.
Manual: `pnpm dev`, select a truth node and a candidate; confirm rationale/relations/source render and the action buttons (Supersede, Confirm, Promote, Bring to sandbox, Edit) still work.

- [ ] **Step 4: Commit**

```bash
git add components/ir/ir-detail.tsx components/ir/ir-panel.tsx
git commit -m "Extract shared IRDetailPane component"
```

---

### Task 4: Build the WorkspaceToolbar (view switch + pills)

**Files:**
- Create: `components/workspace/workspace-toolbar.tsx`
- Modify: `components/workspace-shell.tsx`

- [ ] **Step 1: Create the toolbar component**

```tsx
"use client";

import { MessagesSquareIcon, NetworkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkspaceView = "conversation" | "truth-graph";

export function WorkspaceToolbar({
  view,
  onViewChange,
  ideaCount,
  candidateCount,
  onOpenDrawer,
}: {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  ideaCount: number;
  candidateCount: number;
  onOpenDrawer: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--ir-border-default)] px-4 py-2">
      <div className="flex rounded-lg border border-[var(--ir-border-default)] bg-[var(--ir-bg-subtle)] p-0.5">
        {(["conversation", "truth-graph"] as const).map((value) => (
          <Button
            aria-pressed={view === value}
            className={cn(
              "h-7 rounded-md px-2 text-xs",
              view === value
                ? "bg-[var(--ir-bg-panel)] text-[var(--ir-text-primary)]"
                : "bg-transparent text-[var(--ir-text-tertiary)]"
            )}
            key={value}
            onClick={() => onViewChange(value)}
            size="xs"
            variant="ghost"
          >
            {value === "conversation" ? (
              <MessagesSquareIcon className="size-3" />
            ) : (
              <NetworkIcon className="size-3" />
            )}
            {value === "conversation" ? "Conversation" : "Truth Graph"}
          </Button>
        ))}
      </div>
      <Button
        className="h-7 rounded-md border border-[var(--ir-border-strong)] bg-transparent px-2 text-xs hover:bg-[var(--ir-bg-hover)]"
        onClick={onOpenDrawer}
        size="xs"
        variant="outline"
      >
        Ideas ({ideaCount}) · Candidates ({candidateCount})
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Wire view + drawer state into `workspace-shell.tsx`**

The toolbar reads IR counts, so it must render inside `IRProvider`. Move the toolbar mount into the existing `IRProvider` subtree. Add:
```tsx
const [view, setView] = useLocalStorage<WorkspaceView>("workspace-view", "conversation");
const [drawerOpen, setDrawerOpen] = useState(false);
```
Render the toolbar above the center content and switch the center between chat (`children`) and the stage:
```tsx
<div className="flex min-w-0 flex-1 flex-col">
  <ToolbarWithCounts view={view} onViewChange={setView} onOpenDrawer={() => setDrawerOpen(true)} />
  <div className="min-h-0 flex-1">
    {view === "truth-graph" ? <TruthGraphStage /> : children}
  </div>
</div>
```
`ToolbarWithCounts` is a tiny wrapper that calls `useIR()` for `ideas.length`/`candidates.length` and renders `WorkspaceToolbar` (keeps `workspace-shell` from needing IR context directly).

- [ ] **Step 3: Verify the switch renders**

Run: `pnpm exec tsc --noEmit` → Expected: no errors (TruthGraphStage import resolves once Task 5 lands; until then stub `TruthGraphStage` returning `null`).
Manual: `pnpm dev` → toolbar shows two tabs + the counts pill; clicking Truth Graph swaps the center area.

- [ ] **Step 4: Commit**

```bash
git add components/workspace/workspace-toolbar.tsx components/workspace-shell.tsx
git commit -m "Add workspace view switch and Ideas/Candidates pills"
```

---

### Task 5: TruthGraphStage + IRDrawer; retire the aside

**Files:**
- Create: `components/ir/truth-graph-stage.tsx`
- Create: `components/ir/ir-drawer.tsx`
- Modify: `components/workspace-shell.tsx`
- Delete: `components/ir/ir-panel.tsx`

- [ ] **Step 1: Create `TruthGraphStage`**

```tsx
"use client";

import { useSWRConfig } from "swr"; // if needed; else reuse provider
import { useIR } from "@/components/ir/ir-provider";
import { IRDetailPane } from "@/components/ir/ir-detail";
import { TruthGraph } from "@/components/ir/truth-graph";
import { useIRActions } from "@/components/ir/use-ir-actions";
import { useWorkspace } from "@/components/workspace/workspace-provider";
// detail SWR + assignableTopics computed exactly as in ir-panel today
```
It renders, full height: the `TruthGraph` (passing `truth`, `truthEdges`, `selectedNodeId`, `selectNode`, `truthGraphTopics`) in a scroll container, and below it `IRDetailPane` when a node is selected. Move the `detail` `useSWR(irNodeKey(selectedNodeId))`, `selectedNode` resolution, `truthGraphTopics`, and `assignableTopics` memos from `ir-panel.tsx` into this component. Layout: `Overview | Chain` already lives inside `TruthGraph`; the stage just gives it the full center width (`className="flex h-full flex-col"`, graph in `flex-1 overflow-auto`, detail in a fixed-height bottom region).

- [ ] **Step 2: Create `IRDrawer`**

```tsx
"use client";

export function IRDrawer({ open, onClose }: { open: boolean; onClose: () => void }) { … }
```
Move from `ir-panel.tsx`: the `ReEntryBanner` usage + re-entry state/effects (lines 375–518), the Ideas zone, Candidates zone, Unassigned pool zones (lines 744–825 with `ZoneHeader`/`NodeButton`), and `IRDetailPane` for the drawer's selected idea/candidate. Render as a right-edge overlay:
```tsx
<div className={cn("fixed inset-y-0 right-0 z-40 w-[420px] translate-x-full bg-[var(--ir-bg-panel)] shadow-xl transition-transform", open && "translate-x-0")} data-testid="ir-drawer">
  <button aria-label="Close drawer" onClick={onClose} … />
  {/* zones + detail */}
</div>
```
Use `useIRActions` + `useIR` for data/handlers. Include the edit `Dialog` (now inside `IRDetailPane`, so it comes for free).

- [ ] **Step 3: Mount both in `workspace-shell` and delete `IRPanel`**

In `workspace-shell.tsx`: replace the `<aside>` block and `<IRPanel />` with nothing (aside retired); render `<IRDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />` once inside `IRProvider`; `TruthGraphStage` is rendered by the view switch (Task 4). Remove the panel-resize handlers/state and the `right-panel-*` localStorage keys. Delete `components/ir/ir-panel.tsx`.

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit` → Expected: no errors; no remaining import of `ir-panel`.
Run (PowerShell): `Select-String -Path components,app -Pattern "ir-panel|IRPanel" -Recurse` → Expected: no matches.
Run: `pnpm build` → Expected: success.
Manual: opening drawer overlays without reflowing the stage; selecting nodes in graph and drawer both drive detail; triage actions work.

- [ ] **Step 5: Update/)add e2e and commit**

Update `tests/e2e/workspace-phase2.test.ts` selectors that targeted the old panel (`right-panel`, segmented control) to the new `data-testid`s (`ir-drawer`, the toolbar). Run: `pnpm exec playwright test tests/e2e/workspace-phase2.test.ts`.
```bash
git add components/ir/truth-graph-stage.tsx components/ir/ir-drawer.tsx components/workspace-shell.tsx tests/e2e/workspace-phase2.test.ts
git rm components/ir/ir-panel.tsx
git commit -m "Promote truth graph to main stage; move Ideas/Candidates to drawer"
```

---

## Phase 2 — Visual match

### Task 6: Fit-aware title truncation

**Files:**
- Create: `lib/ir/fit-title.ts`
- Create: `tests/unit/fit-title.test.ts`
- Modify: `components/ir/truth-graph/truth-graph.tsx`

- [ ] **Step 1: Write the failing test**

`tests/unit/fit-title.test.ts`:
```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitTitleToWidth } from "../../lib/ir/fit-title.ts";

describe("fitTitleToWidth", () => {
  it("returns short titles unchanged", () => {
    assert.equal(fitTitleToWidth("先转 TD", 160, 13), "先转 TD");
  });
  it("truncates long CJK titles with an ellipsis to fit the box", () => {
    const out = fitTitleToWidth("结构化存储项目判断在AI对话之间无缝衔接保持上下文", 160, 13);
    assert.ok(out.endsWith("…"));
    // CJK ~1em: (160-16 padding)/13 ≈ 11 glyphs incl. ellipsis
    assert.ok([...out].length <= 12);
  });
  it("packs more latin characters than CJK into the same width", () => {
    const cjk = fitTitleToWidth("一二三四五六七八九十一二三四五六七八", 160, 13).length;
    const latin = fitTitleToWidth("abcdefghijklmnopqrstuvwxyzabcdefghij", 160, 13).length;
    assert.ok(latin > cjk);
  });
});
```

- [ ] **Step 2: Run it to confirm failure**

Run: `node --test --experimental-strip-types tests/unit/fit-title.test.ts`
Expected: FAIL — `Cannot find module '../../lib/ir/fit-title.ts'`.

- [ ] **Step 3: Implement `fitTitleToWidth`**

`lib/ir/fit-title.ts`:
```ts
const PADDING_PX = 16; // node inner horizontal padding (both sides)

function glyphWidth(ch: string, fontPx: number) {
  // CJK / full-width ≈ 1em; latin/space/punct ≈ 0.55em
  return /[　-鿿＀-￯]/.test(ch) ? fontPx : fontPx * 0.55;
}

export function fitTitleToWidth(title: string, boxWidthPx: number, fontPx: number) {
  const normalized = title.replace(/\s+/g, " ").trim();
  const budget = boxWidthPx - PADDING_PX;
  let used = 0;
  let out = "";
  for (const ch of normalized) {
    const w = glyphWidth(ch, fontPx);
    if (used + w > budget) {
      const ellipsisW = glyphWidth("…", fontPx);
      while (out && used + ellipsisW > budget) {
        const last = [...out].pop() as string;
        out = out.slice(0, -last.length);
        used -= glyphWidth(last, fontPx);
      }
      return `${out}…`;
    }
    out += ch;
    used += w;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to confirm pass**

Run: `node --test --experimental-strip-types tests/unit/fit-title.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it in the overview node label**

In `components/ir/truth-graph/truth-graph.tsx`, the overview node font is `--z-font-node` (13px) and node width is `OVERVIEW_NODE.width` (168). In `nodeLabel`, replace `truncateIRTitle(node.title, 42)` with `fitTitleToWidth(node.title, OVERVIEW_NODE.width, 13)` (import from `@/lib/ir/fit-title`). Keep the `▷`/`✓` prefixes and `?` suffix. The full title stays in `aria-label`/detail.

- [ ] **Step 6: Verify + commit**

Run: `pnpm exec tsc --noEmit` and `pnpm exec biome check lib/ir/fit-title.ts tests/unit/fit-title.test.ts components/ir/truth-graph/truth-graph.tsx` → Expected: clean.
```bash
git add lib/ir/fit-title.ts tests/unit/fit-title.test.ts components/ir/truth-graph/truth-graph.tsx
git commit -m "Fit truth-graph node titles to their box width"
```

---

### Task 7: Fixed-scale SVG rendering

**Files:**
- Modify: `components/ir/truth-graph/truth-graph.tsx`

- [ ] **Step 1: Render the overview SVG at natural pixel size**

Replace the overview `<svg width="100%" viewBox={\`0 0 ${overviewWidth} ${overviewHeight}\`}>` with fixed pixel dimensions and no upscaling:
```tsx
<svg
  aria-label="Truth graph overview grouped by topic"
  height={overviewHeight}
  role="img"
  viewBox={`0 0 ${overviewWidth} ${overviewHeight}`}
  width={overviewWidth}
>
```
Keep the wrapper `div` as `overflow-auto` so wide/tall graphs scroll instead of scaling. This makes 1 ELK unit = 1 CSS px, so node geometry is constant regardless of node count (kills the ~3× blowup).

- [ ] **Step 2: Apply the same to the chain SVG**

Change the chain `<svg width="100%" …>` (the `layout.chain` branch) to `width={chainWidth} height={chainHeight}` with the same `viewBox`, inside its `overflow-auto` container.

- [ ] **Step 3: Center narrow graphs in the stage**

In the overview/chain scroll containers, add `className="… flex justify-center"` (overview) so a single narrow topic column sits centered in the wide stage rather than hugging the left edge. Use `min-w-max` on the SVG wrapper so centering doesn't clip when content is wider than the pane.

- [ ] **Step 4: Verify against the reported case**

Manual: `pnpm dev`, open the immigration-planning project (1 topic, 7 truths). Expected: nodes render at natural size (~168px wide), titles fit on one line, no horizontal spill; compare side-by-side with `zeno_full_product_immigration_planning.html`.
Run: `pnpm exec biome check components/ir/truth-graph/truth-graph.tsx` → Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/ir/truth-graph/truth-graph.tsx
git commit -m "Render truth graph at fixed pixel scale instead of stretch-to-fit"
```

---

## Self-Review

**Spec coverage:**
- §4 Agent Activity UI-only removal → Task 1. ✓
- §5.1 view switch + global pills + drawer overlay → Tasks 4, 5. ✓
- §5.2 decomposition (TruthGraphStage, IRDrawer, shared detail/actions) → Tasks 2, 3, 5. ✓
- §5.3 selection state in IRProvider drives both surfaces → Tasks 3, 5 (shared `IRDetailPane` + `useIR`). ✓
- §5.4.1 fixed-scale rendering → Task 7. ✓
- §5.4.2 fit-aware titles → Task 6. ✓
- §3 non-goals (assumptions bar, agent backend) → not present in any task. ✓
- §7 testing (unit truncation, e2e view switch/drawer, manual reproduction) → Tasks 5–7. ✓

**Placeholder scan:** No "TBD/TODO"; code shown for new logic; move-tasks cite exact source line ranges. One intentional stub (`TruthGraphStage` returns `null` in Task 4 Step 3) is resolved in Task 5.

**Type consistency:** `useIRActions` return shape (Task 2) is consumed as `actions.*` in `IRDetailPane` props (Task 3) and `IRDrawer`/`TruthGraphStage` (Task 5). `WorkspaceView` type defined in Task 4 is reused in Task 4 Step 2. `fitTitleToWidth(title, boxWidthPx, fontPx)` signature matches between Task 6 test, impl, and call site.

**Risks flagged in spec §8:** decomposition size (mitigated by Tasks 2–3 extracting hook + detail before the big move in Task 5); modal stacking inside drawer (edit Dialog rides along in `IRDetailPane`); empty-project default (set `workspace-view` default to `"conversation"`).
