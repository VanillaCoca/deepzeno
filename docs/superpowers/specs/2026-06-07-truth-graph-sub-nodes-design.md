# Truth Graph — Sub-nodes / Sub-IR display (design)

> Status: **proposal** (no data model yet). Theme owner: ZENO truth graph.
> Date: 2026-06-07.

## Problem

An IR node may eventually decompose into **sub-nodes / a sub-IR** (e.g. a
decision that breaks into sub-decisions and tasks). The truth graph today is
**flat**: every node sits directly under a topic, and the only structure is
edges (`refines`, `depends_on`, …). We need a way to show "this node contains a
smaller graph" without (a) cluttering the overview, or (b) breaking the existing
overview-by-topic + upstream-chain model.

## Constraints / context

- `ir_nodes` has **no parent/child column** today — hierarchy is only implied by
  edges. So this needs a small data-model addition.
- The overview groups by **topic** and draws no dependency lines (rules §1.1);
  the chain shows the upstream of a selected node. Sub-nodes must not fight these.
- Visual language must stay minimal and color-blind safe (rules §4.7).
- Counts can be large (a parent could hold many children).

## Data model (smallest viable)

Add an optional **`parent_id` (text, FK → ir_nodes.id, ON DELETE set null)** to
`ir_nodes`. A node with `parent_id = X` is a child of X. This is cheaper and
clearer than overloading an edge relation, and keeps containment distinct from
semantic relations (`refines`/`depends_on` still mean what they mean).

Derived: `childCount(node)` = number of nodes whose `parent_id = node.id`.

## Display — recommended: collapsed-by-default + drill-in

1. **Parent affordance.** A node with children renders a small trailing count
   chip, e.g. `⌄ 3`, as a non-color cue (icon + number). It reads as "openable".
2. **Drill-in (primary interaction).** Clicking the chip (not the node body —
   that still selects) **drills into** the parent: the overview is replaced by
   the parent's sub-graph, with the parent pinned at the top as context and a
   **breadcrumb** `Topic / Parent title`. Back returns to the topic overview.
   - Scales to any depth and any child count; keeps the top level uncluttered.
   - Reuses the exact same overview/chain renderer one level down.
3. **Inline expand (small counts only).** For `childCount ≤ 3`, allow an inline
   expand that nests children directly beneath the parent inside its topic
   container (indented), so shallow structure is visible without a drill.
4. **All mode.** Sub-nodes inherit the stage styling (truth/candidate/idea) and
   the count chip; drilling shows the sub-pipeline with the same Truth/All
   toggle.

### Why not the alternatives
- **Always-nested containers** (parent as a box holding children): doesn't scale
  — a few large parents make the overview unreadable.
- **Pure inline expand**: fine for shallow trees, collapses badly for deep/large
  ones; we keep it only as the small-count shortcut.

## Interactions to define when building
- Chain across levels: does the upstream chain cross a parent boundary, or stop
  at it? (Proposed: chain follows edges regardless of nesting; drilling is purely
  a viewport scope.)
- Promote/confirm of a parent vs its children (confirm parent ⇒ children?).
- Breadcrumb + back behavior with the existing back/forward island.

## Rough effort
- DB: 1 column + migration; queries return `parentId` + `childCount`.
- Model: group children under parents; compute counts.
- UI: count chip, drill-in viewport + breadcrumb, optional inline expand.
- No change to the seed/demo until the model lands.

## Build trigger
Implement when sub-IR is actually on the roadmap (the data model addition is the
gating step). Until then this stays a proposal.
