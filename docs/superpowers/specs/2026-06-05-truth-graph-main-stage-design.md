# Truth Graph as Main Stage — Workspace Layout Redesign

**Date:** 2026-06-05
**Branch:** `codex/phase1-db-tests-sync`
**Status:** Design — pending user review

---

## 1. Context & Problem

The truth-graph flowchart (issue: *Truth Graph 可视化 — 流程链形态*) is implemented in
[`components/ir/truth-graph/`](../../../components/ir/truth-graph) and embedded in
[`components/ir/ir-panel.tsx`](../../../components/ir/ir-panel.tsx), which renders inside a
~540px right-side `aside` in [`components/workspace-shell.tsx`](../../../components/workspace-shell.tsx).

Three problems surfaced in testing:

1. **Agent Activity is premature.** Until the truth graph is genuinely good, the Agent Activity
   board adds noise. It should be removed from the UI.
2. **The graph's proportions are wrong** versus the reference demo
   (`zeno_full_product_immigration_planning.html`). Root cause: the overview `<svg>` uses
   `width="100%"` over a `viewBox` whose width equals the ELK *content* width. When few nodes /
   one topic are present, the small content canvas is stretched ~3× to fill the panel, blowing up
   nodes and spilling long CJK titles outside their boxes. The demo instead renders at a **fixed
   scale** and grows vertically, so proportions stay constant. Compounding it, titles truncate by a
   fixed 42-char budget that never fits a node box for real (sentence-length) titles.
3. **Ideas & Candidates compete with the graph.** They are stacked in the same scroll column above
   the Truth Graph; expanding either pushes the graph down. The truth graph should be the single,
   primary surface — not one of three peers in a list.

The deeper issue behind #2: the graph is confined to a narrow side panel, while the demo is a wide,
primary stage. Matching the demo requires both the rendering fix **and** real horizontal room.

## 2. Goals

- Remove the Agent Activity surface from the UI.
- Give the truth graph a full-width primary stage that matches the demo's proportions.
- Move Ideas/Candidates off the graph's vertical space into an on-demand drawer.
- Fix the overview's scaling and long-title rendering.

## 3. Non-Goals (explicitly out of scope)

- **Assumptions / facts bar** (the demo's top "基于 N 条前提" strip). The truth-graph issue defers
  facts/assumptions handling to a separate issue. Not built here.
- **Agent Activity backend.** `lib/agent-activity.ts`, the `app/api/projects/[projectId]/agent-activity/*`
  routes, and DB usage stay in place but dormant ("UI only" removal), so the feature is trivial to
  restore later.
- Mobile/narrow layouts (V1/V2 desktop-only per the rules doc §2.2).
- Any change to truth read-only semantics (no editing of decision state from the graph).

## 4. Confirmed decisions

| Question | Decision |
|---|---|
| Agent Activity removal depth | **UI only** — remove tab, panel mount, and open buttons; leave backend dormant. |
| Ideas/Candidates access | **Slide-over drawer**, overlays from the right, never shifts the graph. |
| Drawer trigger location | **Global toolbar** — count pills visible in both Conversation and Truth Graph views. |
| Truth graph space | **Promote to main stage** via a **view switch** (`Conversation \| Truth Graph`); each full-width. |
| Old right panel | **Retired** for truth purposes (no separate Detail dock). |

## 5. Target Architecture

### 5.1 Layout regions

```
┌───────────┬─────────────────────────────────────────────┐
│           │  Toolbar:  [ Conversation | Truth Graph ]     │
│  Project  │            … Ideas (8) · Candidates (20) ▸    │
│  Sidebar  ├─────────────────────────────────────────────┤
│ (15rem)   │                                               │
│           │   Active view (full width of center area):    │
│           │     • Conversation  → existing chat           │
│           │     • Truth Graph   → Overview | Chain        │
│           │                       + Detail below          │
└───────────┴─────────────────────────────────────────────┘
        Ideas/Candidates Drawer ─ overlays from right edge, on top,
        does not resize or push the active view.
```

- The center area (`SidebarInset` → `flex-1`) hosts a new top **WorkspaceToolbar** and, below it, the
  active view.
- The drawer is a fixed-position overlay (`position: fixed`/portal) so opening it never reflows the
  stage.

### 5.2 Component decomposition

`IRPanel` (1203 lines) is split along the new seams. Selection state remains centralized in the
existing [`IRProvider`](../../../components/ir/ir-provider.tsx) so a click in either surface drives
the shared Detail.

| New unit | Responsibility | Sourced from |
|---|---|---|
| `WorkspaceToolbar` | View switch + Ideas/Candidates count pills (drawer triggers). Lives in `workspace-shell`. | new |
| `TruthGraphStage` | Full-width Overview + Chain + truth-node Detail. The Truth Graph view. | `TruthGraph` + Detail/relations parts of `IRPanel` |
| `IRDrawer` | Ideas / Candidates / Unassigned lists, triage actions, re-entry banner, idea/candidate Detail. | list/zone/modal parts of `IRPanel` |

- `TruthGraph` ([truth-graph.tsx](../../../components/ir/truth-graph/truth-graph.tsx)) stays the
  rendering engine; only its sizing changes (§5.4).
- `IRPanel` is retired once its pieces move; `workspace-shell` mounts `TruthGraphStage` (view) and
  `IRDrawer` (overlay) instead of the `aside`.

### 5.3 State & data flow

- View state (`"conversation" | "truth-graph"`) and drawer-open state live in `workspace-shell`
  (persisted via `useLocalStorage`, mirroring the existing `right-panel-*` pattern). The stale
  `rightPanelMode`/`"truth"` migration code is removed.
- `IRProvider` continues to supply `ideas`, `candidates`, `truth`, `truthEdges`, `selectedNodeId`,
  `selectNode`. No data-layer change. Superseded nodes remain filtered server-side (status=active).
- Selecting a node:
  - from the graph → Detail renders in `TruthGraphStage`.
  - from the drawer → Detail renders in the drawer (idea/candidate context).

### 5.4 Truth-graph rendering fix (#2)

In [truth-graph.tsx](../../../components/ir/truth-graph/truth-graph.tsx):

1. **Fixed scale, no stretch.** Render the overview SVG at 1 unit = 1px: set the SVG `width`/`height`
   to the ELK layout dimensions (px) and place it in an `overflow:auto` container, instead of
   `width="100%"` over a content-sized `viewBox`. Node geometry is then constant regardless of node
   count. The chain pane uses the same fixed-scale treatment for consistency.
   - At the new full-stage width, ELK `rectpacking` (already adopted) yields 2–3 topic columns like
     the demo; with a single topic it is one readable column at natural size (no blowup).
2. **Fit-aware titles.** Replace the fixed 42-char `truncateIRTitle` budget in node labels with a
   width-aware truncation that fits the node box at the node font size (CJK chars ≈ 1em, latin ≈
   0.5em), one line, ellipsis. Full title remains available in Detail and via the node's
   `aria-label`/`<title>` tooltip (rules §8: truncate to one line, full text in detail).
3. No literal values introduced — sizes feed ELK (numeric inputs, unavoidable); all rendered visual
   values keep referencing `tokens.css` vars (the prior `--z-transition` fix stays).

The Phase-1 layout change already removes the *stretch* trigger for narrow panels by giving the
graph the full stage; Phase 2 makes scale explicit so it holds at any width.

## 6. Milestones

**Phase 1 — Structure**
1. Remove Agent Activity UI: the `IR Panel / Agent Activity` segmented control, the
   `AgentActivityPanel` mount, and both "Agent Activity" open buttons in `workspace-shell`.
2. Add `WorkspaceToolbar` (view switch + Ideas/Candidates pills) to the center area.
3. Extract `IRDrawer` from `IRPanel`; mount as a right-edge overlay opened from the pills.
4. Extract `TruthGraphStage`; render it as the `Truth Graph` view at full center width. Retire the
   right-side `aside` and `IRPanel`.

**Phase 2 — Visual match**
5. Fixed-scale overview + chain rendering (§5.4.1).
6. Fit-aware title truncation (§5.4.2).
7. Detail pane styling aligned to the demo (header pill, body, relations row).

## 7. Testing

- **Unit** ([tests/unit/truth-graph.test.ts](../../../tests/unit/truth-graph.test.ts)): keep
  passing; add a case for fit-aware truncation (given box width + title → fits one line).
- **Component/visual**: with 1 topic / 7 nodes (the reported case), assert the overview SVG `width`
  equals the layout px width (not stretched) and node boxes are at natural size; titles do not
  exceed their box.
- **E2E** (Playwright, existing `tests/e2e/`): view switch toggles Conversation ⇄ Truth Graph;
  Ideas/Candidates pills open the drawer without the stage reflowing; Agent Activity entry points are
  gone.
- **Manual**: re-run the immigration-planning project that produced the bad screenshot and compare
  side-by-side with the demo.

## 8. Risks & Mitigations

- **IRPanel decomposition is large (1203 lines).** Mitigate by phasing: Phase 1 moves blocks with
  minimal logic change; Detail/editing logic is relocated, not rewritten.
- **Drawer vs. existing modals.** `IRPanel` hosts editing/draft modals; ensure they continue to work
  from inside the drawer (z-index/stacking with the overlay).
- **View-switch persistence** could strand a user on the graph view of an empty project. Default to
  Conversation when a project has < graph-threshold truths.
- **Long-title fit on CJK vs latin** is heuristic; acceptable because Detail always holds full text.

## 9. Open questions

None blocking. Assumptions bar and Agent Activity backend are deferred by decision, not uncertainty.
