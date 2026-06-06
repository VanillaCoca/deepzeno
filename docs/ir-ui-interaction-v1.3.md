# ZENO V1 — IR UI/UX Interaction Spec (v1.3)

**Owners:**
- Sean (product + frontend implementation review)
- Codex (component implementation, state management)

**Status:** Draft v1.3
**Last updated:** 2026-05-07
**Replaces (in part):** v1.2 §5.4 (Truth Zone) and §4 (Detail pane relations area). v1.2 sections §1–§3, §5.1–§5.3, §6–§9 remain authoritative — this doc does **not** redefine inline refs, Ideas zone, Candidates zone, reactivation anchor, /save flow, or the 4-zone right-panel scaffolding.

**Companion docs:**
- `ir-extraction.md` v1.3 — data layer
- `ir-ui-interaction (1).md` v1.2 — every section this doc does not override
- `prompts/ir-edge-contract.md` (deleted) → see `lib/ir/sweep.ts` `buildSweepSystemPrompt` for the live sweep prompt; the 6-relation enum is enforced at DB level in `supabase/migrations/20260502000001_ir_nodes_and_edges.sql`

---

## 0. What changed from v1.2

| topic | v1.2 | v1.3 |
|---|---|---|
| Truth Zone default view | By Type (kind buckets) | **By Relation (DAG tree)** |
| Truth Zone visual style | flat list per kind, color pill + abbrev | indented DAG tree, char-based glyphs |
| kind disambiguation | colored pill in row | unicode glyph + 3-letter code at row start |
| status disambiguation | dot color | unicode char at row head (color-blind safe) |
| edge type visualization | not rendered in main tree | character on connector, hover for label |
| multi-parent IRs | duplicated independently | rendered once under primary parent + `↑N` shadow markers under secondary parents |
| DAG roots | only `goal` was a root | any node with no incoming relation edges is a root (free principles, free constraints, etc.) |
| Detail pane relations | flat list of all edges | 4 grouped sections: Children / Parents / Co-resolved / Conflicts |

The legacy By Type view is **kept** as a secondary mode (§7), accessible via the view-mode toggle. Zero data churn — same `ir_nodes` + `ir_edges` rows render in either mode.

**Layer scope.** v1.3 covers the **IR graph only** — relations between IR nodes via `ir_edges` (6 enum values). The orthogonal **topic graph** introduced in commit `3dc1cc3` (lifecycle status on `topics`, plus `topic_relations` with 4 enum values: `supersedes/revisits/depends_on/contradicts`) is **not** rendered in the truth tree. Topic-level visualization is out of scope here; see §4.5 for how topic state nonetheless affects IR-tree filtering.

---

## 1. Core principles for the tree

```
1. Structure information lives in CHARACTERS, not in colors.
   Anyone who copy-pastes a tree row into Slack/email must lose nothing.
   Color is decorative; chars are load-bearing.

2. Density beats decoration. Row height 24px. No card backgrounds. No
   pills, no borders between rows. Indentation guides at 0.3 alpha.

3. Multi-parent IRs render ONCE in their primary location, with `↑N`
   shadows in secondary locations. Never duplicate full content.

4. Edges have types and directions. The tree shows BOTH visually:
   - parent kind glyph at row start
   - relation glyph on the connector before each child
   This is non-negotiable — without it, the tree is just a list
   with extra whitespace, which is the v1.2 problem.

5. Click any glyph or connector to filter or inspect. The tree is a
   graph viewer, not just an outline.

6. The Detail pane is the universal display surface (per v1.2 §4).
   v1.3 only refines its relations area (§6).
```

---

## 2. Visual scheme

### 2.1 Status characters (row head, 1 char)

| status | char | rendering | hidden by default? |
|---|---|---|---|
| `active` | `●` | full opacity | no |
| `pending` | `○` | full opacity | no |
| `idea` | `◐` | 70% opacity | no |
| `superseded` | `⊘` | strikethrough text, 50% opacity | yes (toggle in `[⚙]`) |
| `dismissed` | — | not rendered | yes (toggle in `[⚙]`) |

The status char sits at the very start of a node row, in monospace, with a single space after it. Color may be used as **secondary** reinforcement (e.g. `idea` slightly desaturated) but the char is the source of truth.

### 2.2 Kind codes (right-aligned pill, no glyph)

Kind is **NOT** rendered as a glyph in the row body. It appears as a small muted pill on the **right** end of each row, after the short_id. This keeps the row's left edge uncluttered — only the status dot carries semantic color.

| kind | code | color hint (pill background) |
|---|---|---|
| `goal` | `goal` | green-dim |
| `plan/decision` | `dec` | blue-dim |
| `plan/task` | `task` | blue-dim |
| `plan/milestone` | `mst` | blue-dim |
| `constraint` | `cstr` | amber-dim |
| `principle` | `prn` | teal-dim |
| `hypothesis` | `hyp` | purple-dim |
| `open_question` | `q` | yellow-dim |
| `rejection` | `rej` | red-dim |
| `unclassified` | `?` | gray |

Codes are 1–4 chars; the pill auto-sizes (no padding to a fixed width). Background is 8% opacity of the color hint, foreground is 70% opacity. **No glyph icon inside the pill** — code text only. Designed to read at a glance ("oh that's a `dec`") without competing with the title.

### 2.3 Edge rendering — minimal by default

The connector between parent and child is a **plain horizontal line** (`────`) for all default relation types. Only three cases get explicit visual treatment:

| relation | rendering | where |
|---|---|---|
| `implies`, `depends_on`, `refines` (default cases) | `────` plain line, foreground-muted | connector |
| `resolves` (child answers parent question) | `────` line, plus inline label `↳ resolves` after title | inline |
| `contradicts` | `────` line in red, plus inline label `↯ contradicts` after title | inline, red |
| `depends_on` *when parent.kind=`constraint`* | `────` line, plus inline label `· constrained` after title | inline, amber |
| `supersedes` | **not rendered in tree** (lives in Detail version chain) | — |

The inline label sits in the trailing metadata column (between title and short_id), 11px muted text. **Most edges (the default `implies`/`depends_on`/`refines` cases) carry no inline label** — their existence as a tree connection is meaning enough.

Why this is different from v1.3 draft 1: a per-relation glyph zoo (`►┊◌━‖◇`) inside the connector forced the eye to decode 6 different edge symbols on every row, which was exactly the visual noise this redesign is fighting. Default relations need no label; the indent + line carries the structure. Only **interesting** relations (resolves a question, contradicts something, scoped by a constraint) get a label.

### 2.4 Indent guides

```
│       = vertical guide between siblings
├────   = T-junction at a sibling that has more siblings below
└────   = L-junction at the last sibling
```

The junction extends with **4-dash horizontal line** (not a single char) before the row body, so hierarchy reads with weight at a glance. After the junction's dashes there is a 2-space gap, then the row body's status dot. CSS column widths in §3.

### 2.5 Information layering — left / center / right

A row has **three semantic regions** that don't compete:

```
[indent + connector + status dot]    [title — flex grow]    [inline label?]  [short_id]  [kind pill]  [↑N?]
←──── structure ────→                ←── content ──→        ←──── metadata ────→
```

- **Left region (structure)**: indent guides, connector dashes, status dot. Mono-color (foreground at appropriate opacity for status). Carries hierarchy + lifecycle state.
- **Center region (content)**: the title — primary visual element. 14px sans, medium weight, full color. This is what the user reads.
- **Right region (metadata)**: optional inline relation label, then short_id (mono, 4ch), then kind pill, then optional `↑N` shadow marker. All 11–12px, muted. Identifying / categorizing info, not for reading flow.

The three regions read from left to right corresponds to "where am I → what am I → what kind of thing am I" — matches scan order and avoids forcing the eye back-and-forth.

Example fragment (rendered widths approximate, monospace structure / sans content):

```
●  让判断得以积累                                     G1   goal
│
├────  ●  IR 用 Supabase + PostgreSQL 持久化           D17  dec
│        │
│        ├────  ●  Supabase free tier 够用             D2   dec
│        └────  ●  Daily backup pipeline               D8   dec
│
├────  ◌  solo founder 是最早付费人群                   H3   hyp
│
└────  ●  Tree 作为默认视图                  ↳ resolves Q1   D9   dec

●  3-person team · 10-day sprint                      C1   cstr
└────  ●  Supabase + PostgreSQL          · constrained  D2   dec   ↑1
```

Notes:
- Default `implies`/`depends_on` edges: just `────` line, no label
- D9 has inline `↳ resolves Q1` because its edge to Q1 is a `resolves` relation
- D2 under C1 has inline `· constrained` because parent.kind = `constraint`
- D2 also shows `↑1` shadow marker because it appears under both D17 (primary) and C1 (shadow)

---

## 3. Layout & density specs

```
right panel width     : 540px default (was 480), 440px min, 720px max — drag-resizable
                        (the wider default is necessary to give title + metadata
                         enough room without truncation)

row height            : 28px (was 24px — more breathing room for scan)
indent step           : 16px per depth level (room for 4-dash connector + space)
indent guide          : 1px solid rgba(foreground, 0.3)

fonts:
  - status dot               : 14px sans, full color
  - indent / connector dashes: 13px monospace, muted
  - title                    : 14px sans, weight 500 (medium) — HERO of the row
  - inline relation label    : 11px sans, muted (e.g. "↳ resolves", "· constrained")
  - short_id                 : 12px monospace, muted
  - kind pill                : 11px sans, weight 500, with 8% bg + 70% fg of kind hint color

hover row             : background rgba(foreground, 0.04)
selected row          : 2px left accent border, no background fill
trailing shadow marker: ↑N, 11px monospace muted, only on multi-parent rows
```

At depth ≥ 4, indent compresses to 12px to avoid horizontal scroll. At depth ≥ 6, panel scrolls horizontally rather than wrap (devs prefer over-flow over wrap).

Mobile (< 768px): right panel collapses, falls back to Type mode list when expanded.

---

## 4. DAG rendering rules

### 4.1 Choosing roots

**A node is a tree root iff it has no incoming relation edges.** This is the topological-root definition for a DAG. In practice:

- All `goal` IRs are typically roots (nothing implies a goal in V1)
- `principle` IRs are usually roots (free-floating rules)
- `constraint` IRs are usually roots (external limits)
- `hypothesis` IRs may or may not be roots, depending on whether something implies them
- Any IR with at least one incoming `implies`/`depends_on`/`refines`/`resolves` edge is **not** a root

`contradicts` edges do **not** affect root selection — they are bidirectional in spirit, and a contradicts-only node is still a root.

`supersedes` edges do **not** affect tree at all (they live in Detail's version chain, §6.3).

### 4.2 Choosing the primary parent for multi-parent IRs

When a node has multiple incoming non-`supersedes`/non-`contradicts` edges, exactly one of those edges' source nodes becomes the **primary parent**. The node is rendered **fully** under the primary parent; under all other parents, only a 1-line shadow row is rendered.

**Selection rule** (in order):

1. Edge with relation priority: `implies` > `depends_on` > `refines` > `resolves`
2. If tied: parent's `created_at` ascending (older parent wins — stable across re-renders)
3. If still tied: parent's id lexicographic ascending

The selection is computed client-side from the loaded edge set. **It is deterministic and stable** — the same data renders the same tree.

### 4.3 Shadow row format

Under non-primary parents, the multi-parent node renders as a single-line shadow:

```
{indent}{connector}  {status} {kind_glyph} {code} {short_id}   {title:short}    ↑{N}  (also under {primary_parent_short_id})
```

- The shadow row is 1 line, never expandable
- It does not render its own children — clicking it scrolls the tree to the primary location and opens that subtree
- `↑N` indicates total parent count (not just "other" parents — total)
- The "(also under X)" note is **always** the primary parent's short_id, not the other shadow contexts

Visually the shadow row is rendered at 60% opacity to distinguish from primary rows.

### 4.4 Cycle detection

The 6-relation enum + DB CHECK + UNIQUE constraint mostly prevent cycles, but `contradicts` and `refines` can form cycles in malformed data. Renderer must:

1. Track visited node ids during DFS
2. If a node appears again during traversal, render as a shadow with `(cycle)` annotation
3. Log a warning (not an error — don't break the tree on bad data)

### 4.5 Topic scope (interaction with topic lifecycle)

The truth tree renders IR nodes from the **whole project**, not from a single topic. Cross-topic relations are perfectly valid and should appear in the tree like any other edge.

That said, topic-level state filters which IRs are visible by default:

| topic.status | topic.archivedAt | IRs in this topic render? |
|---|---|---|
| `exploring` / `converging` / `decided` / `executing` | null | **yes**, by default |
| `superseded` | null | hidden by default; revealed via `[⚙] → Show superseded` (same toggle that reveals superseded IRs) |
| `dismissed` | null | **never rendered** — treated as deleted from the user's perspective |
| any | non-null (archived) | **never rendered** |

`is_general` topic membership does not affect rendering (general-topic IRs render like any other).

**Unassigned IRs** (rows where `topic_id IS NULL`) form a synthetic root labeled `Unassigned (N)` at the top of the tree, above all other roots. Inside this synthetic root, IRs are rendered with the same row format and edge connectors as elsewhere; if an unassigned IR has an edge to a topic-assigned IR, that edge crosses into the assigned subtree like any cross-topic edge. The synthetic root is collapsed by default but auto-expands on next render when N goes from 0 → ≥ 1 (matches the existing `unassignedExpanded` UX in `ir-panel.tsx`).

**Why "whole project" not "active topic only".** v1.2's flat-by-kind list was already implicitly project-wide. Truth tree v1.3 keeps that scope so that decisions made in one topic remain visible while the user is conversing in another. If we ever need a "current-topic-only" filter, it belongs as a *filter chip* on the existing tree (§5.3), not a redesign.

**What v1.3 explicitly does NOT do regarding topics:**

- Does not group nodes by topic (no `▾ Topic A (5)` headers in tree mode — Type mode keeps its kind grouping)
- Does not render `topic_relations` edges at all (those are a topic-graph concern, not an IR-graph concern)
- Does not render topic lifecycle status badges next to IR rows (lifecycle lives on the topic, not on each IR)

If a user wants to focus on one topic's IRs, they use the existing topic switcher in the project sidebar; it does **not** reshape the truth tree.

---

## 5. Interactions

### 5.1 Mouse

| action | effect |
|---|---|
| click row | select node → Detail pane renders it; tree row gets accent border |
| click `kind_glyph` | toggle filter to that kind only; tree collapses to matching nodes + ancestors |
| click `code` text | same as click glyph (larger hit target) |
| click `short_id` | copy id to clipboard, toast "Copied D17" |
| click connector char | Detail pane shows that edge's metadata (relation, source/target, created_at, future: rationale) |
| click `↑N` shadow marker | popover lists all parents; click one to jump there |
| click `[⚙]` panel header | menu: Show superseded / Show dismissed / View mode (Tree/Type/Flat) |
| click `[⌕]` | inline search (§5.3) |
| hover row 1.2s | tooltip with `source_text_span` excerpt |
| double-click row | toggle expand/collapse for that subtree |

### 5.2 Keyboard

The truth panel is keyboard-navigable when focused. Vim-style bindings:

| key | action |
|---|---|
| `j` / `↓` | next visible row |
| `k` / `↑` | previous visible row |
| `h` / `←` | collapse current; if already collapsed, jump to parent |
| `l` / `→` | expand current; if already expanded, jump to first child |
| `gg` | jump to first root |
| `G` | jump to last visible row |
| `o` / `Enter` | open Detail (focus shifts to Detail) |
| `/` | focus inline search |
| `f` | toggle filter mode (then a kind char to filter, e.g. `fd` = decisions only) |
| `Esc` | clear filter / blur search |
| `[` / `]` | jump to previous / next root |

These bindings are active only when the truth panel itself has focus (click into it or `Tab` from elsewhere).

### 5.3 Inline search

Top-bar `[⌕]` opens an input that filters the tree in-place:

- Plain text → matches `id`, `title`, `content`, `rationale`
- `kind:dec` / `kind:goal` → kind filter
- `status:pending` / `status:idea` → status filter (status:superseded reveals the hidden ones)
- `topic:onboarding` → topic filter (V1.5)
- Multiple terms AND-joined

Filter behavior: the tree shows matching nodes **plus all their ancestors** (preserving structure). Non-matching ancestors render at 40% opacity to stay legible. Esc clears.

---

## 6. Detail pane relations area (overrides v1.2 §4 relations subsection)

When a node is selected, the Detail pane renders its IR content as before (per v1.2 §4) and adds a **Relations** block at the top with **4 collapsible sections**:

```
Relations
─────────
↓ Implies / Children (3)              ← outgoing implies / depends_on / refines / resolves
   ▣ D2  Supabase free tier 够用
   ▣ D8  Daily backup pipeline
   ◌ H3  solo founder 是最早付费人群

↑ Implied by / Parents (1)            ← incoming implies / depends_on / refines / resolves
   ◆ G1  让判断得以积累

‖ Co-resolved (1)                     ← siblings under same `resolves` target (i.e. competing answers to same question)
   ▣ D11 用 Supabase Tree (alternative answer)

↯ Conflicts (0)
   (none)
```

- Each section is a chip list. Each chip is `{kind_glyph} {short_id}  {title_truncated_40}`.
- Clicking a chip switches the selected node (tree highlight follows).
- Section auto-collapses when count = 0 (renders empty placeholder for "(none)").
- The full edge list (with `relation`, direction, created_at) is **NOT** in this block — it's in a separate `[All edges]` collapsible below for power users / debugging.

### 6.1 Why "Co-resolved" is its own section

If `Q1` is an open_question and both `D9` and `D11` have `resolves` edges to `Q1`, then `D9` and `D11` are **co-resolved siblings** — they both answer the same question. This is a relationship users care about when reviewing decisions ("what are the alternative answers we considered?") but is not a direct edge.

The renderer computes co-resolved nodes by: for the selected node N, find all `resolves` edges N→Q, then find all OTHER nodes with `resolves` edges to the same Q. Those are co-resolved siblings.

### 6.2 Why "Conflicts" is its own section

`contradicts` edges are bidirectional in spirit. Whether the edge is N→other or other→N, the user sees them in this section. The chip indicates direction with a small arrow if the user cares (`↯→` or `←↯`).

### 6.3 Version chain (supersedes) lives below Relations

Per v1.2 §4 Section 5 (Version history), `supersedes` edges form a linear-ish chain rendered separately. v1.3 keeps this. The chain renders as:

```
Version chain
─────────────
D5 (superseded 4d ago)  →  D17 (current)  →  ?
       ⊘                       ●
```

Each chain entry is clickable → switches selected node.

---

## 7. View modes

The `[⚙]` menu offers a view-mode toggle:

| mode | when to use | difference from Tree |
|---|---|---|
| **Tree** (default) | exploring relations, design review | DAG-rooted indent, edge glyphs, shadow rendering |
| **Type** (legacy) | quickly counting "how many decisions / constraints" | flat list per kind, no edges shown |
| **Flat** | post-search dumping, copy-paste workflows | one big monospace list sorted by `short_id`, no grouping |

User's choice persists per-project in `localStorage` (`zeno.truth.viewMode.<projectId>`).

In **Type** mode (legacy):
- Same row format as Tree (status / kind / code / short_id / title)
- No connectors, no indent
- Group headers: `▾ Decisions (8)` / `▸ Constraints (3)` / etc.
- Default expanded: `Decisions`, `Constraints`. Others collapsed (matches v1.2).

In **Flat** mode:
- One list, sortable column header click (id / title / kind / status / age)
- Filtered when search active
- Copy-row action in row context menu

---

## 8. Implementation hints for codex

### 8.1 Data shape needed at component boundary

```ts
type TruthTreeData = {
  nodes: Map<string, IRNode>;         // by short_id (e.g. "D17")
  edges: IREdge[];                     // already filtered to status='active'
  // computed lazily by the component:
  // - rootIds: string[]            (no incoming non-supersedes/contradicts edge)
  // - primaryParentOf: Map<string, string | null>
  // - childrenOf: Map<string, string[]>  (ordered by primary parent edge priority)
};
```

The truth panel currently fetches `IRNode[]` and `IREdge[]` separately via SWR. v1.3 needs both in the same render pass. Add a single `useTruthTreeData` hook that returns the structure above, recomputing on data change.

### 8.2 Performance

For projects with > 200 nodes, naive DFS is fine (microseconds). Don't pre-virtualize unless real perf data shows we need to. **react-window is overkill at v1 scale.**

### 8.3 Reusing existing components

- `ir-panel.tsx` should keep its top-bar (search / re-entry indicator / view mode toggle / `[⚙]`) unchanged
- The body (currently `TRUTH_GROUPS.map(...)`) should branch on view mode:
  - `tree` → new `<TruthTree nodes edges />`
  - `type` → existing flat-by-kind rendering (refactor into `<TruthByType nodes />`)
  - `flat` → new `<TruthFlat nodes />`
- Detail pane (`ir-panel.tsx` lines ~190-230) needs the 4-section refactor (§6 above)

### 8.4 Glyph rendering safety

All glyphs in §2 are BMP unicode and render in every modern browser font that supports CJK. **Test on Windows Chrome and macOS Safari at 13px** before merging — `▣` and `▮` are the most likely to look bad on Windows default fonts. If they do, swap to `■` and `▪` respectively.

### 8.5 Color tokens

Use the existing CSS vars `--ir-text-primary` / `--ir-text-secondary` / `--ir-text-tertiary` / `--ir-warning-fg` / etc. Add new ones if needed:

```css
--ir-glyph-goal: rgba(34,197,94, 0.85);      /* green-dim */
--ir-glyph-decision: rgba(59,130,246, 0.85); /* blue-dim */
--ir-glyph-constraint: rgba(245,158,11, 0.85); /* amber-dim */
--ir-glyph-principle: rgba(20,184,166, 0.85); /* teal-dim */
--ir-glyph-hypothesis: rgba(168,85,247, 0.85); /* purple-dim */
--ir-glyph-question: rgba(234,179,8, 0.85);   /* yellow-dim */
--ir-glyph-rejection: rgba(239,68,68, 0.85);  /* red-dim */
--ir-edge-contradicts: rgba(239,68,68, 1);    /* red */
```

These are dark-mode-first; light-mode tokens follow the same naming with adjusted opacity.

---

## 9. Open questions (mark TODO before implementation)

- [ ] **TODO-Sean**: confirm whether `unclassified` rows render in the tree at all, or get hidden by default. Spec leans toward "show with `?` glyph" but you may want them hidden until classified.
- [ ] **TODO-Sean**: keyboard binding for "promote idea → pending" inline (e.g. `p` on a selected idea row). Not in v1.3 unless you want it.
- [ ] **TODO-Sean**: should hovering an `↑N` marker preload the parent contexts (so the popover opens instantly), or load on click? Pre-loading uses bandwidth at panel open; on-click adds 100ms latency. Default is on-click — flag if you want pre-load.

---

## 10. Out of scope for v1.3

Explicitly **not** addressed by this spec:

- AI-suggested new edges (would need a "suggest" UI in Detail — defer to v1.5)
- Edge rationale field (would need DB column on `ir_edges` — defer to v1.5)
- **Topic graph rendering** — the `topic_relations` table (4 relation types: `supersedes/revisits/depends_on/contradicts`) is fully implemented at the data layer but its visualization is out of scope. A separate "Topic Explorer" view, possibly in the project sidebar, will own this. The truth tree shows IR-level relations only.
- **Topic lifecycle indicators on IR rows** — `topic.status` (exploring/converging/decided/executing/superseded/dismissed) does not appear next to IR rows. Only the filtering rules in §4.5 apply.
- **Topic-grouped tree mode** — no "group by topic" view. If users want per-topic focus they use the existing topic switcher in the project sidebar.
- Drag-and-drop reorder
- Node deletion (only supersede + dismiss exist in V1)
- Bulk operations on multiple selected nodes
- Graph view (force-directed visualization) — explicitly rejected for v1, dev users prefer the tree

---

## Appendix A — Visual grammar reference card

For quick scanning during code review:

```
LEFT (structure column):
  │       vertical guide
  ├────   T-junction with 4-dash extension
  └────   L-junction with 4-dash extension

STATUS (single colored dot, only semantic glyph in row body):
  ●  active     ○  pending     ◐  idea     ⊘  superseded     ·  dismissed

CENTER (content):
  Title — 14px sans, weight 500 — the hero of every row

INLINE RELATION LABEL (only on non-default relations):
  ↳ resolves    when edge.relation = resolves
  ↯ contradicts when edge.relation = contradicts (red)
  · constrained when edge.relation = depends_on AND parent.kind = constraint

RIGHT (metadata column, all 11–12px muted):
  D17        short_id (mono, ≤4 chars)
  dec        kind code in colored pill
  ↑N         shadow marker (multi-parent only)
```

