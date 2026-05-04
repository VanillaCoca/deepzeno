# ZENO V1 — IR UI/UX Interaction Spec

**Owners:**
- Sean (product + frontend implementation review)
- Codex (component implementation, state management)

**Status:** Draft v1.2
**Last updated:** 2026-05-02
**Replaces:** v1.1 (removed: Sandbox 灵动岛 / bottom-pane pool. Added: right-side 4-zone panel — Ideas / Candidates / Truth / Detail. Moved: Reactivation Anchor indicator to Chat header. Renamed: "Clear" button → "Explore new idea". Strengthened: Detail pane as universal display surface.)
**Companion docs:** `ir-extraction.md` v1.3 (data layer); `migrations-setup.md` (DB setup)

**Audience tag legend** (used in section headers throughout):
- `[Owner: Codex — Frontend]` — React component / UI state / interaction code
- `[Owner: Sean — Decision]` — open question requiring Sean's call
- `[Audience: All]` — design context; read by everyone

> **Document scope discipline.** This file describes only what users see and click. It does not redefine schema, API request/response shapes, prompt content, or DB triggers — those live in `ir-extraction.md` v1.3 and are referenced by section number. When a UI flow depends on backend behavior, this doc cites the extraction doc; it does not duplicate.

---

## 0. Purpose [Audience: All]

本文档定义 ZENO V1 的**视觉呈现**和**交互行为**——inline reference 怎么渲染、右侧 panel 怎么布局、detail 区怎么响应、candidate confirm 怎么走、idea 区怎么显示、/save 怎么操作、reactivation anchor 怎么提示、"Explore new idea" 按钮做什么。

数据层(schema、提取机制、API contract、prompt 设计)见 `ir-extraction.md` v1.3。

**职责严格分离**:
- 这份文档**不**重复 API endpoint 的 request/response 字段——只用名字引用
- 这份文档**不**重复 schema 字段定义——只用 status / kind 名字引用
- 这份文档**不**重复 prompt 内容——只描述 UI 何时触发哪个流程

---

## 1. Core Design Principles [Audience: All]

```
1. ZENO 没有"卡片"这个视觉元素。所有 IR 节点是 inline reference + 统一 detail 容器。
2. 右下 Detail pane 是 universal display surface —— Truth / Candidate / Idea / 
   Superseded / Inline ref click 全部汇入这里。受 Claude Code 启发的单一展开区设计。
3. Right Panel 只显示 confirmed (active) Truth 在主区;Ideas / Candidates 是上方堆叠区。
4. Confirm 必须显式——用户必须看到 detail 后再点 Confirm,没有 inline 一键 confirm。
5. 视觉区分 status:active / pending / idea / superseded 四态必须可辨。
6. Idea 不抢 Candidate 的注意力。Right Panel 的 Idea zone 默认折叠。
7. 中间 Sandbox 区是项目下当前 idea 的对话容器。"Explore new idea" 按钮 = 主动声明换 idea。
```

---

## 2. Three-Pane Layout [Audience: All]

```
┌─────────────┬──────────────────────────┬───────────────────────────┐
│             │  Chat Header             │  Right Panel              │
│  Left:      │  ⚓ Anchor: D17 (strong) │  Since last visit: 2c·1⚠  │
│  Project /  │           [Explore new   │  ─────────────────────    │
│  Topic Nav  │            idea]         │  ▸ Ideas (3)              │
│             │  ────────────────────    │  ─────────────────────    │
│  - ZENO     │                          │  ▾ Candidates (2)         │
│    > Gen.   │  Sandbox (chat stream)   │    ◇ D5 · ...             │
│    > Prod.  │                          │    ◇ Q3 · ...             │
│    > Tech   │  Aarav: Let's discuss... │  ─────────────────────    │
│             │                          │  Truth · [By Type ▾] [⌕] │
│  - Click    │  AI: That's a [[D5]]     │  ▾ Decisions (8)          │
│    Coll.    │  decision because...     │    D1, D2, D5...          │
│             │                          │  ▸ Constraints (3)        │
│             │                          │  ▸ Tasks (12)             │
│             │                          │  ...                      │
│             │                          │ ═══ draggable divider ═══ │
│             │                          │                           │
│             │                          │  Detail (universal)       │
│             │  [Input box]             │  D5 · V1 uses Vercel...   │
│             │                          │  [action bar]             │
└─────────────┴──────────────────────────┴───────────────────────────┘
```

- **Left pane**: project + topic navigation (existing UI, no IR changes)
- **Center pane**: Chat header + Sandbox (chat stream) + input. **No bottom灵动岛 in v1.2.**
- **Right pane**: vertical 4-zone stack with draggable divider above Detail

### 2.1 What Lives Where (Quick Reference)

| Element | Location | Section |
|---|---|---|
| Inline IR reference (in chat) | Center, in chat stream | §3 |
| Reactivation anchor indicator | Center, chat header | §6 |
| "Explore new idea" button | Center, chat header (right side) | §7 |
| /save selection toolbar | Center, on text selection | §8.2 |
| Re-entry indicator | Right, top of panel | §5.1 |
| Ideas zone | Right, upper-middle (collapsed default) | §5.2 |
| Candidates zone | Right, middle (expanded default) | §5.3 |
| Truth tree | Right, main display area | §5.4 |
| Detail pane (universal) | Right, below divider | §4 |

---

## 3. Inline Reference Rendering [Owner: Codex — Frontend]

### 3.1 Visual States

Inline references in chat have **three rendered states**: active, pending, superseded. Idea state does NOT appear inline (see §3.5).

#### State A: `active` (confirmed truth)

```
... that aligns with D5 perfectly ...
              ─┬─
               └─ Blue text, no background
                  Hover: subtle underline
                  Click: detail pane shows D5
```

```css
.inline-ref[data-status="active"] {
  color: #2563eb;            /* blue-600 */
  text-decoration: none;
  cursor: pointer;
  font-weight: 500;
}
.inline-ref[data-status="active"]:hover {
  text-decoration: underline;
}
```

#### State B: `pending` (candidate)

```
... so the new ◇D5 should resolve Q3 ...
               ─┬─
                └─ Light blue background pill, ◇ prefix
                   Click: detail pane shows D5 with [Confirm] [Edit] [Ignore]
```

```css
.inline-ref[data-status="pending"] {
  color: #1e40af;
  background: #dbeafe;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px dashed #93c5fd;
  cursor: pointer;
  font-weight: 500;
}
.inline-ref[data-status="pending"]::before {
  content: "◇ ";
  opacity: 0.6;
}
```

#### State C: `superseded` (historical, replaced)

```
... originally we chose D̶3̶ but now we use D5 ...
                       ─┬─
                        └─ Gray text with strikethrough
```

```css
.inline-ref[data-status="superseded"] {
  color: #6b7280;
  text-decoration: line-through;
  cursor: pointer;
}
```

#### State D: `dismissed` (user-rejected candidate)

Dismissed candidates **do not render** as inline references. The marker is replaced with plain text (the title only, gray, no interaction).

### 3.2 Inline Reference Format

```
{prefix}{number} · {title_truncated}
```

Examples:
- `D5 · V1 uses Vercel + Supabase`
- `Q3 · What should V1 measure?`
- `T7 · Implement candidate confirm UI`

Truncation at 40 characters with `…` suffix. Full title in tooltip on hover.

### 3.3 React Component

```tsx
interface InlineRefProps {
  id: string;  // 'D5', 'Q3', etc.
}

function InlineRef({ id }: InlineRefProps) {
  const node = useIRNode(id);  // SWR hook, cached per id
  
  if (!node) return <span className="inline-ref-skeleton">{id}</span>;
  
  return (
    <span 
      className="inline-ref"
      data-status={node.status}
      onClick={() => selectNode(id)}
      title={node.title}
    >
      {node.id} · {truncate(node.title, 40)}
    </span>
  );
}
```

Storage in `chat_turns.content`: marker replaced with placeholder `<inline-ref id="D5"/>`. React markdown renderer custom rule maps placeholder to `<InlineRef>`.

### 3.4 Lifecycle Behavior

When candidate confirmed (pending → active):
- All `<InlineRef>` instances across all chat turns instantly update visual to `active`
- Implementation: SWR cache invalidation on confirm; subscribed components re-render

When node superseded (active → superseded):
- All inline-refs to that node update to `superseded` visual

**ID reissue (unclassified case)**: when an `unclassified` U7 is reclassified to D12, all inline-refs in chat turns referencing U7 update via Realtime subscription on `unclassified_reissued` event. Codex: subscribe to event, mutate SWR cache, re-render. The placeholder `<inline-ref id="U7"/>` in stored content is rewritten in-place to `<inline-ref id="D12"/>` lazily on next render or via background job.

### 3.5 Why Idea Does Not Appear Inline

Idea status nodes come exclusively from sweep extraction (mid-confidence, async). They never appear in inline markers (which are real-time, high-confidence by definition — see ir-extraction.md §5).

Showing ideas inline would clutter chat with low-commitment marks, dilute the visual signal of pending candidates, and force in-flow user processing — opposite of the design intent ("set aside for later review").

Ideas surface only in the Right Panel Ideas zone (§5.2) and the Detail pane (§4) when clicked.

---

## 4. Detail Pane: Universal Display Surface [Owner: Codex — Frontend]

The Detail pane is the lower half of the Right Panel, separated from the upper zones by a **draggable horizontal divider**. **All IR display happens here** — Truth, Candidate, Idea, Superseded all share this single surface.

This is the "Claude Code-style single expansion area" pattern: instead of modals, side panels, or inline expansions, every interactive element opens its detail in one persistent space.

### 4.1 Click Sources That Land Here

```
Click target                          → Detail pane shows
─────────────────                     ─────────────────
Inline ref in chat (any state)        →  that IR, status-appropriate actions
Item in Right Panel Ideas zone        →  that idea
Item in Right Panel Candidates zone   →  that candidate  
Item in Right Panel Truth tree        →  that active truth node
Re-entry indicator link               →  filtered list view (then click → detail)
"Bring to sandbox" preview link       →  the IR being brought (preview before drop)
```

Selection state is project-scoped. Switching topic / project clears selection (back to empty state, §4.4).

### 4.2 Layout Skeleton (Constant Across All States)

```
┌─────────────────────────────────────────┐
│ ← Back to tree              [×]         │  ← header bar
├─────────────────────────────────────────┤
│ D5 · V1 uses Vercel + Supabase          │  ← title section
│ kind: plan/decision · status: active    │
├─────────────────────────────────────────┤
│ Rationale                               │  ← body (scrollable)
│ Zero DevOps overhead, Pro tier from     │
│ launch day.                             │
│                                         │
│ Relations                               │
│   supersedes  D3 · V1 uses self-host…   │
│   depends_on  C2 · V1 budget < $200/mo  │
│   resolves    Q3 · How to deploy V1?    │
│                                         │
│ Source                                  │
│ Chat turn Apr 30 22:15 · sweep    [Open]│
│                                         │
├─────────────────────────────────────────┤
│ [Action Bar — varies by status]         │  ← footer
└─────────────────────────────────────────┘
```

**Layout structure is constant** — header / title / body / footer in same positions. Only the **footer action bar** changes by status.

### 4.3 Action Bar by Status

#### `active` (confirmed truth)

```
[Supersede]  [Create next step]  [Ask AI]  [Bring to sandbox]
```

- **Supersede**: opens flow to draft replacement candidate (calls `/api/ir/{id}/supersede`, see ir-extraction.md §11.7)
- **Create next step**: opens AI-drafted task candidate flow (§8.5)
- **Ask AI**: opens chat dialog pre-loaded with this node as context
- **Bring to sandbox**: copies node into Sandbox (chat stream context). **Side effect**: sets reactivation anchor to this node (§6)

**No "Edit" button.** Editing active nodes is forbidden by iron law #4. To change content, use Supersede.

#### `pending` (candidate)

```
[Confirm]  [Edit & Confirm]  [Ignore]
```

- **Confirm**: API call (ir-extraction.md §11.5); on success node becomes active
- **Edit & Confirm**: opens edit modal; on save, calls confirm with `edits` payload
- **Ignore**: dismisses candidate (§11.6)

If candidate has `relations` with non-null `impact` (e.g. supersedes an active node), display impact warning **prominently** above action bar:

```
⚠ Confirming this will mark D3 as superseded.
   D3: V1 uses self-hosted PG → will become inactive
```

If candidate has `is_anchor_hint=true` relations, display gentler banner (see §6.4):

```
ℹ This candidate suggests it refines D17 (your loaded context).
   You can keep this relation or remove it before confirming.
```

#### `idea` (mid-confidence sweep result)

```
[Promote to candidate]  [Dismiss]  [Bring to sandbox]
```

- **Promote to candidate**: idea → pending (§11.4); node moves from Ideas zone to Candidates zone in Right Panel; user then proceeds with normal pending flow
- **Dismiss**: dismisses idea (§11.6)
- **Bring to sandbox**: copies into chat context for deeper discussion (without promoting). Also sets reactivation anchor.

**Power-user shortcut**: hold Shift while clicking action bar to reveal `[Promote & confirm]` (skip-promote, idea → active in single click). Hidden by default; the friction is intentional.

#### `pending` with `kind='unclassified'` (special case from /save)

Above the standard pending action bar, show a kind picker:

```
┌─────────────────────────────────────────┐
│ Kind: not yet classified                │
│ ⏳ AI is suggesting a kind…             │
│ [waiting for suggestion]                │
└─────────────────────────────────────────┘

When suggestion arrives via Realtime:

┌─────────────────────────────────────────┐
│ Kind: not yet classified                │
│ AI suggests: plan / decision   [Use]    │
│ Or pick yourself: [▾ kind picker]       │
│ Or [Skip kind for now]                  │
└─────────────────────────────────────────┘
```

- **Use**: calls `/api/ir/{id}/reclassify` (§11.3); node id changes from U7 to D12; all inline refs auto-update via Realtime
- **Pick yourself**: dropdown for manual kind+subtype selection; same reclassify flow
- **Skip kind for now**: keeps unclassified; Confirm button still works (creates active unclassified node, visible only in flat list / search)

If user confirms while still unclassified, node enters Truth tree under a special "Unclassified" group at the bottom (collapsed by default) with U-prefix.

#### `superseded` (historical)

```
[Restore]  [Bring to sandbox]
```

- **Restore**: NOT in V1. Show button as disabled with tooltip "Coming in V1.5"
- **Bring to sandbox**: copies node content to chat for re-discussion

V1: only Bring to sandbox is functional.

#### `dismissed`

Detail pane is normally not reachable for dismissed nodes (they don't render inline-refs). Accessible only via direct URL. Action bar:

```
[Bring to sandbox]
```

### 4.4 Empty State

When no node is selected, the Detail pane shows:

```
┌─────────────────────────────────────────┐
│ Most recent decision                    │
├─────────────────────────────────────────┤
│ D5 · V1 uses Vercel + Supabase          │
│ active · confirmed 2 hours ago          │
│                                         │
│ [content preview, 3 lines]              │
│                                         │
│ Click to view full details              │
└─────────────────────────────────────────┘
```

Shows the most recently confirmed active node in the current project. Clicking expands to full detail. Serves Re-entry Success Rate.

If project has no active nodes:
```
No truth yet. Start a conversation to begin building your project's truth.
```

---

## 5. Right Panel: 4-Zone Vertical Stack [Owner: Codex — Frontend]

The Right Panel replaces v1.0/v1.1's Truth Panel + Sandbox 灵动岛 split. It is now a **single vertical 4-zone stack** with a draggable divider between the upper 3 zones (collectively the "list area") and the Detail pane.

```
┌─ Right Panel ───────────────────┐
│ Since last visit: 2 · 1 ⚠       │  ← §5.1, conditional
├─────────────────────────────────┤
│ ▸ Ideas (3)                     │  ← §5.2, collapsed default
├─────────────────────────────────┤
│ ▾ Candidates (2)                │  ← §5.3, expanded default
│   ◇ D5 · ...                    │
│   ◇ Q3 · ...                    │
├─────────────────────────────────┤
│ Truth · [By Type ▾] [⌕]         │  ← §5.4, main display
│ ▾ Decisions (8)                 │
│   D1, D2, D5...                 │
│ ▸ Constraints (3)               │
│ ...                             │
├═══ draggable divider ═══════════┤
│                                 │
│ Detail (universal)              │  ← §4
│ ...                             │
└─────────────────────────────────┘
```

**Each zone is a logically distinct list with its own scroll, but they share the same scrollable container** in the upper region. The draggable divider only separates "list area" from "detail area" — not between Ideas/Candidates/Truth (those collapse/expand to share vertical space).

When all 3 upper zones are expanded and full, the upper region becomes scrollable. Truth is the deepest zone and benefits most from screen space, so by default Ideas + Candidates are kept compact.

### 5.1 Re-entry Indicator (top of panel) [Owner: Codex — Frontend]

A single line at the very top of the Right Panel:

```
Since last visit: {N} candidates · {M} ⚠ stale
```

**Display rules:**
- Hidden if user was active <24h ago AND no pending candidates
- Inline (single line) if some signals exist
- Expanded snapshot if user was away >7d (see §5.1.1)

**Counts:**
- "candidates" = pending nodes (any source layer) since last visit
- "⚠" = warning indicator (V1: pending candidates; V1.5: + stale assumptions)

**Note**: idea-status nodes are NOT counted in this indicator. Ideas are deliberately quiet — visible only in the Ideas zone.

Click on indicator scrolls to/filters the relevant zone.

#### 5.1.1 Re-entry Snapshot (Conditional Expansion)

Triggers when user returns after >7 days. Replaces the inline indicator with:

```
┌─────────────────────────────────────────┐
│ Welcome back                            │
│                                         │
│ Since you left:                         │
│  • 2 candidates pending review          │
│  • 5 ideas awaiting promotion           │
│  • 1 stale assumption (>14d)            │
│  • 0 supersede events                   │
│                                         │
│ Most recent decision: D5 · V1 uses…     │
│                                         │
│ [Review pending] [Open Ideas] [Dismiss] │
└─────────────────────────────────────────┘
```

Auto-collapses after action button click or 5s inactivity. Reverts to inline indicator. **Not a permanent dashboard section** — strictly conditional.

### 5.2 Ideas Zone [Owner: Codex — Frontend]

Shows all `status='idea'` nodes scoped to current topic. Sweep extraction is the only source (see ir-extraction.md §6).

**Default state**: collapsed. Header always visible:
```
▸ Ideas (3)
```

If `Ideas (0)`, the entire row is hidden — no zero-count header noise.

**Expanded:**
```
▾ Ideas (3)
   ⨀ Bilingual sweep accuracy may need separate eval set
   ⨀ Anchor decay should perhaps be configurable
   ⨀ /save kind suggestion may benefit from few-shot
```

**Visual:**
- Gray text (`--ir-idea-fg`)
- ⨀ prefix (subtle dot, `--ir-idea-prefix-fg`)
- No background, no badge, no inline action buttons
- Single-line title only (no preview, no metadata in list)
- Designed to NOT compete with Candidates for attention

**Click any idea → Detail pane** shows it with `[Promote to candidate] [Dismiss] [Bring to sandbox]` action bar (§4.3).

**Overflow handling:**
- If Ideas has > 10 items expanded, show "+ N more" link
- Click expands beyond default height OR opens a modal list view

### 5.3 Candidates Zone [Owner: Codex — Frontend]

Shows all `status='pending'` nodes scoped to current topic, regardless of source layer (inline / sweep / manual / mcp).

**Default state**: expanded. Header:
```
▾ Candidates (2)
   ◇ D5 · V1 uses Vercel + Supabase
   ◇ Q3 · What should V1 measure?
```

**Visual:**
- Each row is a pending pill (blue dashed border style, similar to inline pending)
- ◇ prefix
- Single-line: `{prefix}{number} · {title_truncated_60}`

**Click any candidate → Detail pane** shows it with `[Confirm] [Edit & Confirm] [Ignore]` action bar.

**Special case**: U-prefix unclassified candidates show with amber accent + "?" badge:
```
   ◇ U7 ? · Selected text content...
```

The "?" badge indicates "kind not yet classified" — clicking opens detail pane with the kind picker UI (§4.3 unclassified case).

**Overflow handling**: > 5 candidates show "+ N more" link → expands further or opens modal.

### 5.4 Truth Zone [Owner: Codex — Frontend]

Shows ONLY `status='active'` nodes. The "main display" of the Right Panel. Always visible — has no parent collapse toggle (Ideas / Candidates can collapse; Truth is the floor).

```
Truth · [By Type ▾] [⌕ Search]
▾ Goals (1)
   G1 · Build project-intent SSOT
▾ Decisions (8)
   D1 · Project IR is source of truth
   D2 · Tree is projection
   D5 · V1 uses Vercel + Supabase
   ...
▸ Constraints (3)
▸ Tasks (12)
▸ Open Questions (3)
▸ Hypotheses (2)
▸ Principles (4)
▸ Unclassified (0)  ← hidden if empty
```

#### 5.4.1 Two View Modes

**Mode A: By Type (default)**

Group active nodes by `kind` (and `subtype` for plans):
- Goals (G), Decisions (D = plan/decision), Constraints (C), Tasks (T = plan/task), Milestones (M = plan/milestone), Open Questions (Q), Hypotheses (H), Principles (R)
- Rejections (X) — collapsed by default, hidden if empty
- Unclassified (U) — collapsed by default, hidden if empty (rare; only from /save where user skipped kind)

Each group shows count. Default expanded: Decisions, Constraints. All others collapsed.

**Mode B: By Relation**

Show active nodes grouped by their relationship to the **currently selected node** in detail pane:
- Direct children (this node implies / depends_on)
- Direct parents (things that imply / depend_on this node)
- Siblings (resolved by same question, etc.)
- Supersede chain (history)

If no node selected, By Relation falls back to By Type.

#### 5.4.2 Search

Top-bar search input. Supports:
- Plain text: matches title, content, rationale
- Type filter: `kind:decision`, `subtype:task`
- Status filter: `status:pending`, `status:idea`, `status:superseded`
- Topic filter: `topic:onboarding` (V1.5)

V1 implements text + status/kind/subtype filters. UI: `[Filter ▾]` button beside search opens chip-based filter for non-power users; power users can type syntax directly.

#### 5.4.3 Tree Node Display

Each row:
```
{prefix}{number} · {title_truncated_60}
```

Hover row: shows expand chevron, age timestamp tooltip.
Click row: selects node in detail pane.

Superseded nodes: hidden by default. `[⚙]` panel header menu has "Show history" toggle to reveal them with strikethrough.

### 5.5 Detail Pane (Lower Half)

See §4. The Detail pane sits below the draggable divider in the same Right Panel. All click sources from §5.2 / §5.3 / §5.4 / inline refs land here.

---

## 6. Reactivation Anchor: Chat Header Indicator [Owner: Codex — Frontend]

In v1.2, the anchor indicator lives in the **Chat header** (top of center pane), not in any right-side zone. Rationale: anchor binds to "current conversation context," which is a property of the chat / Sandbox, not a property of the Right Panel's truth-graph view.

### 6.1 Setting and Clearing

**Set** (triggered by user action):
- Click `[Bring to sandbox]` on any node's Detail pane action bar → server creates anchor on that node (see ir-extraction.md §8.1)
- Realtime / SWR pushes update; chat header re-renders with anchor row visible

**Clear** (any of):
- User clicks `[×]` on anchor row → POST clear to server
- User loads a different node into sandbox → anchor replaced (single-anchor V1)
- User clicks "Explore new idea" → anchor cleared along with chat
- Server detects anchor target deleted → anchor auto-cleared (silent, with toast)

### 6.2 Visual

When no anchor:
```
┌─ Chat ──────────────────────────────────────┐
│                              [Explore new   │
│                               idea]         │
├─────────────────────────────────────────────┤
│ Chat stream...                              │
```

When anchor set:
```
┌─ Chat ──────────────────────────────────────┐
│ ⚓ Anchor: D17 · IR persistence              │
│           (strong, set 4 turns ago)  [×]    │
│                              [Explore new   │
│                               idea]         │
├─────────────────────────────────────────────┤
│ Chat stream...                              │
```

**Strength visual** (server provides `strength: 'strong' | 'weak'`):
- **Strong** (≤ 20 turns since set): solid `⚓` icon, full opacity
- **Weak** (> 20 turns): faded `⚓` icon (50% opacity), subtitle adds "(weak — relations less reliable)"

```
Strong:  ⚓ Anchor: D17 · IR persistence
            (strong, set 4 turns ago)  [×]

Weak:    ⚓ Anchor: D17 · IR persistence
         (weak, set 38 turns ago — relations less reliable)  [×]
```

**Click anchor row** (not the `[×]`):
- Opens D17 in Detail pane (universal display behavior)

### 6.3 Anchor Cleared (Toasts)

| Trigger | Toast |
|---|---|
| User clicked `[×]` | (no toast — explicit action) |
| Loaded new anchor | "Anchor moved to D42" |
| Clicked "Explore new idea" | "Anchor cleared" (folded into the explore-new-idea toast) |
| Target deleted (rare) | "Anchor cleared (target removed)" — longer duration |

### 6.4 Anchor Affects Candidate UI in Detail Pane

When confirming a candidate that has anchor-hint relations (`is_anchor_hint=true` from server), the relation in Detail pane is displayed with explicit affordance:

```
Relations
  refines      D17 · IR persistence    (suggested by anchor)  [keep] [remove]
  depends_on   C2 · V1 budget < $200/mo
```

The "(suggested by anchor)" label + inline keep/remove buttons make hint nature explicit. Default: kept. User can remove before confirming.

When user confirms:
- If kept → edge becomes `active`
- If removed → edge becomes `dismissed`

---

## 7. Chat Header: "Explore new idea" Button [Owner: Codex — Frontend]

The Chat header (top of center pane) has one always-visible action button on the right side:

```
                              [Explore new idea]
```

### 7.1 Position and Visibility

- Top-right corner of Chat header
- Always visible, regardless of anchor state or chat content
- Disabled (grayed out) when chat is empty or only has system message
- Disabled while a sweep is in progress (visual: spinner inside button)

### 7.2 Click Behavior

**Confirmation modal** (single short prompt):

```
┌──────────────────────────────────────────────┐
│ Explore new idea                             │
│                                              │
│ Start fresh on a new idea in this topic?     │
│ ZENO will review the current discussion      │
│ to capture any decisions or open questions   │
│ before clearing.                             │
│                                              │
│              [Cancel]  [Yes, explore new]    │
└──────────────────────────────────────────────┘
```

If user clicks **Yes**:

```
1. Clear chat stream IMMEDIATELY (visual: instant)
2. Clear reactivation anchor (if set)
3. Trigger sweep extraction async (server-side; see ir-extraction.md §6.1 — 
   trigger: user_starts_new_idea)
4. Show subtle banner under chat header: 
   "Reviewing previous discussion for decisions and ideas..."
5. When sweep completes (typically 1-3s):
   - Banner disappears
   - Toast: "{N} candidates · {M} ideas extracted from previous discussion"
   - New items appear in Right Panel Candidates / Ideas zones
6. Chat is empty, ready for new idea
```

If user clicks **Cancel**: dismiss modal, no changes.

**Why a confirmation modal**: clearing chat is a destructive-feeling action even though sweep preserves judgments. The modal sets expectation that "yes, your prior thoughts are being captured" before content visually disappears. Without it, users hesitate or distrust the button.

### 7.3 Product Philosophy Embedded

The button name is intentional. ZENO's mental model:
- A project has multiple **topics** (left nav)
- Each topic hosts ongoing **discussions / ideas**
- Each discussion converges (manually via /save, or automatically via sweep) into **immature ideas → candidates → truth**

"Explore new idea" reinforces that pressing the button = user actively declares "I want to switch to a different idea now." This is distinct from "Clear" which connotes erasure. Same action, different mental model.

The /save channel remains the way to actively seed an idea pool **during** a discussion (§8.2).

### 7.4 What Happens to the Cleared Conversation Server-Side

The chat stream is cleared in the UI, but `chat_turns` rows are **not deleted** from the database. They remain part of the historical record (immutable, like git history). Future "Open conversation history" features (V1.5+) can surface them. The sweep extraction reads from those preserved turns to produce candidates / ideas.

In V1, there is no UI to view cleared conversation history. Future feature, not a v1.2 concern.

---

## 8. Critical Flows [Owner: Codex — Frontend]

### 8.1 Inline Marker Candidate Confirm Flow

```
1. AI generates response with [[ir:plan:decision|...]] marker
2. Frontend parses, calls POST /api/ir/draft (ir-extraction.md §11.1) 
   → gets D5 (status=pending)
3. Marker replaced with <InlineRef id="D5"/> showing pending visual
4. Candidate also appears in Right Panel Candidates zone
5. User clicks the inline ◇D5 (or clicks D5 in Candidates zone)
6. Detail pane shows D5 with [Confirm] [Edit & Confirm] [Ignore]
7. (If candidate has anchor-hint relation, see §6.4)
8a. User clicks Confirm:
    - POST /api/ir/D5/confirm
    - All <InlineRef id="D5"/> across chat instantly turn blue (active)
    - D5 disappears from Candidates zone
    - D5 appears in Truth zone tree under "Decisions"
    - Detail pane updates to show active state with active action bar
8b. User clicks Edit & Confirm:
    - Modal opens with editable title/rationale
    - On save, calls confirm with edits payload
    - Same post-confirm behavior as 8a
8c. User clicks Ignore:
    - POST /api/ir/D5/dismiss
    - Inline-refs turn into plain gray text
    - D5 disappears from Candidates zone
```

### 8.2 /save Flow (User-Initiated Candidate)

```
1. User selects text in any chat turn (user or AI message)
2. Selection toolbar appears 200ms after selection, positioned above selection:
   [💬 Reply]  [📋 Copy]  [💾 Save to ZENO]  [✕]
3. User clicks [💾 Save to ZENO]
4. Frontend POST /api/ir/save (ir-extraction.md §11.2)
5. Server creates pending node with kind='unclassified', U-prefix id
6. Toast: "Saved to ZENO · suggesting kind…"
7. Node appears immediately in Right Panel Candidates zone as ◇U7 with "?" badge
8. Server async-runs LLM kind classifier
9. When classifier returns (Realtime push):
   - If detail pane has U7 open: kind picker UI updates with suggestion
     "AI suggests: plan/decision  [Use]  [▾ Pick]  [Skip kind]"
   - If detail pane is on something else: small (1) badge appears on U7 row 
     in Candidates zone — "kind suggestion ready"
   - If low confidence: kind picker shows "Pick a kind: [▾]" without bias
10. User chooses:
    - Use suggestion → POST /api/ir/U7/reclassify → server reissues U7 → D12
      → all inline-refs and zone rows update via Realtime
    - Pick yourself → same flow with manual choice
    - Skip kind → keeps unclassified; user can confirm directly later
11. User then confirms via standard pending flow (§8.1.8a)
```

### 8.3 Idea Promote Flow

```
1. Sweep produces medium-confidence idea (ir-extraction.md §6)
2. Idea appears in Right Panel Ideas zone (collapsed by default — header count updates)
3. User expands Ideas zone, sees idea title
4. User clicks idea row
5. Detail pane shows idea with [Promote to candidate] [Dismiss] [Bring to sandbox]
6a. User clicks Promote:
    - POST /api/ir/{id}/promote → status: idea → pending
    - Node moves: Ideas zone → Candidates zone
    - User then proceeds with normal pending flow (confirm/edit/dismiss)
6b. User clicks Dismiss:
    - POST /api/ir/{id}/dismiss
    - Idea disappears from Ideas zone
6c. User Shift-clicks Promote (power-user shortcut):
    - Server allows direct idea → active transition
    - Useful when user already trusts the extraction
```

### 8.4 "Explore new idea" Flow

See §7.2 for the complete flow including the confirmation modal.

### 8.5 Supersede Flow (User-Initiated from Active Node)

```
1. User clicks active D2 in Truth zone tree
2. Detail pane shows D2 with [Supersede] action
3. User clicks Supersede
4. Modal: "What replaces D2?"
   - kind/subtype selector (defaults to D2's kind/subtype)
   - title input
   - rationale input
5. User fills, clicks "Create supersede candidate"
6. POST /api/ir/D2/supersede → creates new candidate D5 with relation 
   supersedes→D2 pre-populated
7. Detail pane switches to D5 (pending) with impact warning:
   "⚠ Confirming this will mark D2 as superseded."
8. User clicks Confirm
9. Transaction (server-side):
   - D5 → active
   - D2 → superseded, superseded_by=D5
10. UI updates:
    - D5 appears in Truth zone tree
    - D2 disappears from default tree (visible only with Show history)
    - Inline-refs to D2 across chat turn gray + strikethrough
    - Inline-refs to D5 (if any) turn active blue
```

### 8.6 Create Next Step Flow (Decision → Task)

The **core V1 closed-loop** for solo founder workflow.

```
1. User on Detail pane of active D5 (a decision)
2. User clicks [Create next step]
3. Frontend sends D5's content+rationale to AI with system prompt 
   (Lixian writes; ir-extraction.md scope):
   "You are creating a next-step task candidate based on this decision..."
4. AI responds with marker only (no other text):
   [[ir:plan:task|Migrate Vercel project to Pro tier|Required by D5]][[rel:implies|D5]]
5. Frontend parses marker → creates pending T7 with relation D5 implies T7
6. Detail pane immediately switches to T7 (pending) for review
7. User reviews, clicks Confirm or Edit & Confirm
8. T7 becomes active, available via MCP for Claude Code:
   - Coding agent calls MCP tool get_tasks(project) → sees T7
   - Tool response includes T7.content + T7.rationale + parent D5 context
   - Agent has full decision context, not just task title
```

This flow is what makes typed truth visible to the user. Without it, ZENO's typed edges feel like backend plumbing. With it: "I made a decision, ZENO drafted the implementation, Claude Code picked it up with full context."

### 8.7 Sweep Triggered by 20-Turn Safety Net

```
1. User has been chatting; turn count reaches 20-turn threshold 
   (ir-extraction.md §6.1)
2. Server queues sweep
3. Sweep runs in background — UI is NOT blocked, NOT modal, NOT toast
4. On completion:
   - New candidates/ideas added to respective zones
   - Subtle pulse animation on the receiving zone(s) (0.5s, gentle)
   - Zone count updates: e.g. "Candidates (4)" → "Candidates (6)"
5. User notices and reviews when ready
```

This trigger is intentionally LOW-key — it's a safety net, not a primary signal. Users should not be interrupted by it.

### 8.8 MCP Coverage Check Visual Feedback

When user invokes coding agent (Claude Code, Cursor, etc.) and that agent calls Zeno MCP server's first read for a session (ir-extraction.md §9):

**On the Zeno UI side** (if user has Zeno open):

If sweep is triggered (stale_turns > 5):
```
A subtle banner appears under chat header:
┌──────────────────────────────────────────────┐
│ 🔄 An agent is reading your truth.           │
│    Reviewing recent conversation…            │
└──────────────────────────────────────────────┘

After completion (1-3s):
┌──────────────────────────────────────────────┐
│ ✓ Truth ready for agent.                     │
│   {N} new candidates extracted.              │
└──────────────────────────────────────────────┘

Banner auto-dismisses after 5s.
```

If sweep fails:
```
⚠ Sweep failed. Agent received best-effort truth with 12 unprocessed turns.
  [Retry sweep]
```

---

## 9. Component Architecture [Owner: Codex — Frontend]

### 9.1 Component Tree

```
<App>
  <ProjectNav />                       // left pane, existing
  
  <CenterPane>
    <ChatHeader>
      <AnchorIndicator />              // §6, conditional
      <ExploreNewIdeaButton />         // §7, always
    </ChatHeader>
    <McpActivityBanner />              // §8.8, conditional
    <ChatStream>
      <ChatTurn>
        <MarkdownRenderer>
          <InlineRef id="..."/>        // §3
        </MarkdownRenderer>
        <SelectionToolbar>             // §8.2, on selection
          <SaveToZenoAction />
        </SelectionToolbar>
      </ChatTurn>
    </ChatStream>
    <ChatInput />
  </CenterPane>
  
  <RightPanel>
    <SinceLastVisit />                 // §5.1
    <SplitPane>                        // draggable divider between top + bottom
      <ListArea>                       // upper half
        <IdeasZone />                  // §5.2
        <CandidatesZone />             // §5.3
        <TruthZone>                    // §5.4
          <TreeViewToggle />           // By Type | By Relation
          <SearchInput />
          <TreeView />
        </TruthZone>
      </ListArea>
      <DetailPane>                     // §4 — universal
        <DetailHeader />
        <DetailBody />
        <KindSuggestionPicker />       // shown only for unclassified pending
        <ActionBar />                  // varies: active/pending/idea/superseded
      </DetailPane>
    </SplitPane>
  </RightPanel>
</App>
```

**Key change from v1.1**: there is no `<Sandbox>` component anymore. The center pane's chat stream IS the sandbox conceptually (still called Sandbox in product copy: "Reviewing previous discussion... in this Sandbox"). The pool/list display moved entirely to `<RightPanel>`.

### 9.2 State Management

```typescript
interface IRStore {
  // Selection (drives Detail pane)
  selectedNodeId: string | null;
  selectNode: (id: string | null) => void;
  
  // Truth zone view
  treeViewMode: 'by_type' | 'by_relation';
  setTreeViewMode: (mode) => void;
  
  // Right Panel zone collapse states
  ideasZoneExpanded: boolean;          // default: false
  candidatesZoneExpanded: boolean;     // default: true
  // Truth zone has no collapse — it's the floor
  
  // Reactivation Anchor (mirrors server session state)
  anchor: { id: string; setAtTurn: number; strength: 'strong' | 'weak' } | null;
  setAnchor: (id: string | null) => void;
  
  // Re-entry
  lastVisitTimestamp: string;
  pendingCount: number;
  ideaCount: number;
  staleCount: number;
  
  // Async activity
  sweepInProgress: boolean;            // for "Explore new idea" button disable
  mcpSweepInProgress: boolean;         // for MCP banner
  
  // Right panel divider position
  detailPaneHeightRatio: number;       // 0-1, persisted per user
}

// Per-node SWR cache
const useIRNode = (id: string) => useSWR(`/api/ir/${id}`);

// Zone-scoped queries
const useIdeas = (projectId: string, topicId: string) => 
  useSWR(`/api/ir?project_id=${projectId}&topic_id=${topicId}&status=idea`);
const useCandidates = (projectId: string, topicId: string) => 
  useSWR(`/api/ir?project_id=${projectId}&topic_id=${topicId}&status=pending`);
const useActiveTruth = (projectId: string) => 
  useSWR(`/api/ir?project_id=${projectId}&status=active`);
```

When status changes (confirm/dismiss/promote/supersede/reclassify), API response triggers SWR cache mutation per-node + invalidation of relevant zone queries. All `<InlineRef>` and zone components re-render automatically.

### 9.3 Realtime Subscriptions

Codex subscribes to Supabase Realtime on these tables for the current project:
- `ir_nodes` — id reissue, status changes, sweep results landing
- `ir_edges` — relation updates
- `ir_extraction_events` — for `mcp_coverage_check`, `sweep_triggered`, `sweep_completed`, `unclassified_reissued` events to drive UI feedback (banners, animations)

---

## 10. Edge Cases & Failure Modes [Owner: Codex — Frontend]

### 10.1 InlineRef points to deleted/unknown node

If `GET /api/ir/{id}` returns 404:
- Render as plain gray text: `[D5 (not found)]`
- Don't break chat turn rendering
- Log telemetry event

### 10.2 InlineRef points to unclassified U7 that gets reissued

When U7 → D12 (reclassify event):
- All `<InlineRef id="U7"/>` receive Realtime update
- Re-render with new id D12 + new visual prefix
- Underlying `chat_turns.content` rewritten in-place lazily on next render
- No user action required

### 10.3 Detail pane node deleted while open

If currently-displayed node becomes unavailable (e.g., dismissed in another tab):
- Show banner: "This candidate was dismissed. [Back to tree]"
- Don't auto-navigate; let user decide

### 10.4 Confirm fails with 409 (already confirmed elsewhere)

Banner in detail pane:
```
This candidate was already confirmed in another session. 
Refreshing...
```
Auto-refresh node data after 1s.

### 10.5 Supersede target became invalid

Per ir-extraction.md §12.6, server returns:
```json
{ "type": "supersede_invalidated", "target": "D3", "actual_active_replacement": "D4" }
```

UI toast:
```
⚠ Your supersede of D3 didn't take effect — D3 was already 
  superseded by D4. Your new D5 is active but the supersede 
  link was dropped.
```

### 10.6 Sweep produces many candidates/ideas

If a sweep yields > 5 candidates or > 10 ideas:
- Respective zone shows "+ N more" link
- Click expands zone or opens overflow modal

### 10.7 Anchor on deleted IR

Auto-cleared on next render. Toast: "Anchor cleared (target removed)" (longer duration, 5s).

### 10.8 Kind suggestion API timeout

If LLM classifier doesn't return within 10s:
- Detail pane shows: "Suggestion unavailable. [Retry] or pick manually."
- Node remains unclassified

### 10.9 Selection toolbar collisions with existing inline-ref

If user selects text including an inline-ref:
- Selection toolbar still shows [Save to ZENO]
- Saved span = literal selected text (the inline-ref's display text becomes part of saved string)
- Intentional; user is saving a quote that may reference an existing IR

### 10.10 "Explore new idea" clicked while sweep already running

Button is disabled (with spinner) while `sweepInProgress=true`. If user manages to click via keyboard during race:
- Frontend ignores (no API call)
- Tooltip: "Sweep already in progress, please wait"

### 10.11 Right Panel divider dragged to extreme positions

- Min upper area height: 100px (enough to show one zone header)
- Min lower area (Detail pane) height: 200px (enough to show title + first line of body)
- Drag beyond limits is clamped

### 10.12 Mobile / narrow viewport

V1 desktop-only. On <1024px viewport, banner: "ZENO is best on desktop. Mobile coming in V1.5." Block functionality except read-only chat view.

---

## 11. Implementation Checklist (Codex) [Owner: Codex — Frontend]

### 11.1 Phase 1: Inline Reference (Sprint 2, after API layer)

- [ ] `<InlineRef>` component with 3 visual states (active/pending/superseded)
- [ ] CSS for states per §3.1
- [ ] Markdown renderer custom rule: `<inline-ref id="..."/>` → `<InlineRef>`
- [ ] SWR hook `useIRNode(id)` cached by id
- [ ] Click handler: set selectedNodeId
- [ ] Hover tooltip: full title
- [ ] Loading skeleton for unfetched nodes
- [ ] U-prefix id reissue handling (Realtime + SWR + in-place re-render)

### 11.2 Phase 2: Right Panel 4-Zone Layout (Sprint 2)

- [ ] `<RightPanel>` container with vertical stack
- [ ] `<SplitPane>` with draggable divider (Detail vs ListArea)
- [ ] Persist divider position per user
- [ ] `<SinceLastVisit>` indicator (always-on inline form)
- [ ] `<IdeasZone>` (collapsed default, hidden if 0)
- [ ] `<CandidatesZone>` (expanded default)
- [ ] `<TruthZone>` with By Type / By Relation toggle
- [ ] Tree row click → select node
- [ ] Show/hide superseded toggle in panel `[⚙]` settings
- [ ] Search input + filter chips (status: includes idea)
- [ ] Overflow handling: "+ N more" links when zones over limits

### 11.3 Phase 3: Detail Pane (Sprint 2)

- [ ] `<DetailPane>` with constant layout structure (header / title / body / footer)
- [ ] `<DetailBody>` rendering rationale + relations + source
- [ ] `<ActionBar>` with status-conditional buttons (active/pending/idea/superseded)
- [ ] Empty state: most recent active node (§4.4)
- [ ] Confirm flow (call API + cache update)
- [ ] Edit & Confirm modal
- [ ] Dismiss flow
- [ ] Supersede flow (modal → API → switch to new candidate)
- [ ] Promote idea flow
- [ ] Power-user Shift-click direct-confirm-from-idea
- [ ] Impact warning rendering for supersede candidates (§4.3)
- [ ] Anchor-hint relation rendering with inline keep/remove (§6.4)
- [ ] Universal click routing: any source → Detail pane updates

### 11.4 Phase 4: Chat Header + "Explore new idea" (Sprint 3)

- [ ] `<ChatHeader>` component with right-aligned action area
- [ ] `<ExploreNewIdeaButton>` always visible
- [ ] Disabled state during empty chat / sweep in progress
- [ ] Confirmation modal (§7.2)
- [ ] Click flow: clear chat instantly + trigger sweep + banner + toast
- [ ] Sweep completion banner dismissal logic

### 11.5 Phase 5: Reactivation Anchor (Sprint 3)

- [ ] `<AnchorIndicator>` in Chat header (conditional, set/clear visual)
- [ ] Strength visual (strong solid / weak faded)
- [ ] `[×]` clear action
- [ ] Click anchor row → opens IR in Detail pane
- [ ] Toasts on anchor changes (§6.3)
- [ ] Server state sync via Realtime

### 11.6 Phase 6: /save Flow (Sprint 3)

- [ ] `<SelectionToolbar>` appearing on text selection in chat
- [ ] [Save to ZENO] action calling `/api/ir/save`
- [ ] Toast on save success
- [ ] U-prefix candidate visual in Candidates zone (with "?" badge)
- [ ] `<KindSuggestionPicker>` in Detail pane for unclassified pending
- [ ] Realtime subscription for kind suggestion arrival
- [ ] Reclassify flow: Use / Pick / Skip kind buttons
- [ ] In-place id update across all UI on reclassify

### 11.7 Phase 7: MCP Coverage Visual (Sprint 3)

- [ ] `<McpActivityBanner>` triggered by `mcp_coverage_check` Realtime event
- [ ] Loading / completion / failure states (§8.8)
- [ ] Auto-dismiss timing

### 11.8 Phase 8: Re-entry Indicators (Sprint 3)

- [ ] `<SinceLastVisit>` inline indicator (always-on)
- [ ] Conditional snapshot expansion (>7d trigger)
- [ ] Track last_visited_at per project per user
- [ ] Pending count, idea count, stale count

### 11.9 Phase 9: Create Next Step Flow (Sprint 3)

- [ ] [Create next step] action button in Detail pane (active status)
- [ ] AI call with parent decision context
- [ ] Marker parser handles single-marker response
- [ ] Auto-switch Detail pane to drafted task
- [ ] Pre-populated implies relation

### 11.10 Phase 10: Hardening (Sprint 4)

- [ ] All edge cases §10
- [ ] Concurrent confirm 409 handling
- [ ] Toast system for warnings
- [ ] Telemetry events for UI interactions
- [ ] Keyboard shortcuts: J/K nav tree, Enter open detail, C confirm pending, P promote idea, E focus Explore-new-idea button

---

## 12. Out of Scope for V1 [Audience: All]

- Drag-to-reorder in zones (V1.5)
- Drag node onto another to create relation (V1.5+, with confirmation modal)
- Restore button for superseded nodes (V1.5)
- Cross-version diff view (V1.5)
- Mobile UI (V1.5)
- Topic search filter (`topic:` syntax)
- AI-suggested active path (V1.5+)
- Real-time multi-user cursors (V2-B)
- Cleared conversation history viewer (V1.5)
- Multi-anchor visual handling (V2)
- Bottom sandbox 灵动岛 — explicitly removed in v1.2 in favor of right-side panel

---

## 13. Open Questions [Owner: Sean — Decision]

1. **InlineRef in non-AI content**: if user manually types `[[ir:...]]` in chat, should it work? V1: NO. Only AI-output markers parsed. User manual markers render as literal text. (User wanting to save user-typed content uses /save.)

2. **Detail pane scroll behavior on selection change**: scroll-reset to top? V1: YES.

3. **Confirm keyboard shortcut**: Enter does NOT confirm (too easy to miss-trigger). C key with focus on Detail pane = confirm. P = promote idea.

4. **Zone overflow caps**: cap at N items in Ideas/Candidates? V1: no cap, but show "+N more" if Ideas > 10 or Candidates > 5. Performance acceptable up to 50 per zone.

5. **Right Panel resizing**: minimum width 320px, cannot fully hide in V1. Toggle to hide is V1.5.

6. **Selection toolbar position**: above selection or floating tooltip-style? V1: above selection, positioned to avoid going off-screen.

7. **Should Idea zone count appear in Re-entry indicator?**: V1 answer: NO (ideas are quiet). Watch user behavior — V1.x might add if users miss accumulating ideas.

8. **"Explore new idea" confirmation modal copy**: §7.2 has a draft. Sean to review wording before launch.

9. **Disabled-state visual for "Explore new idea" button while sweep runs**: spinner inside button vs separate loading bar? V1: spinner inside button, faded text.

---

## Appendix A: Design Tokens [Owner: Codex — Frontend]

```css
:root {
  /* IR status colors */
  --ir-active-fg: #2563eb;            /* blue-600 */
  --ir-pending-fg: #1e40af;            /* blue-800 */
  --ir-pending-bg: #dbeafe;            /* blue-100 */
  --ir-pending-border: #93c5fd;        /* blue-300 */
  --ir-idea-fg: #6b7280;               /* gray-500 */
  --ir-idea-prefix-fg: #9ca3af;        /* gray-400, ⨀ icon */
  --ir-superseded-fg: #6b7280;
  --ir-dismissed-fg: #9ca3af;
  --ir-unclassified-fg: #92400e;       /* amber-800, U-prefix */
  --ir-unclassified-badge-bg: #fef3c7; /* amber-100 */
  
  /* Right panel */
  --right-panel-width: 380px;
  --right-panel-min-width: 320px;
  --right-panel-divider-color: #e5e7eb;
  --right-panel-bg: #fafafa;
  --zone-header-padding: 10px 12px;
  --zone-row-padding: 6px 16px;
  
  /* Detail pane */
  --detail-padding: 16px;
  --detail-action-bar-height: 56px;
  --detail-min-height: 200px;
  --listarea-min-height: 100px;
  
  /* Chat header */
  --chat-header-height: 48px;
  --chat-header-bg: #ffffff;
  
  /* Anchor indicator */
  --anchor-strong-opacity: 1.0;
  --anchor-weak-opacity: 0.5;
  
  /* MCP banner */
  --mcp-banner-bg: #f0f9ff;
  --mcp-banner-fg: #0369a1;
  
  /* Explore-new-idea button */
  --explore-btn-bg: transparent;
  --explore-btn-fg: #2563eb;
  --explore-btn-border: #2563eb;
  --explore-btn-hover-bg: #eff6ff;
}
```

## Appendix B: Decision Log [Audience: All]

| Decision | V1.2 choice | Why |
|----------|-------------|-----|
| Bottom sandbox 灵动岛 | REMOVED | Conflicted with the right-side 4-zone idea/candidate/truth design Sean defined |
| Right panel structure | 4-zone vertical (Ideas, Candidates, Truth, Detail) | Single panel houses funnel: Idea → Candidate → Truth, with Detail as universal display below |
| Detail pane purpose | Universal display surface (Claude Code-inspired) | All click sources land here; one expansion area, no modals |
| "Clear" button | RENAMED to "Explore new idea" | Reinforces project-centric philosophy: each click = active declaration of new idea |
| Confirmation modal on "Explore new idea" | YES | Prevents accidental clearing; sets expectation that judgments are captured |
| Anchor indicator location | Chat header (center pane) | Anchor binds to current conversation context, not Truth-graph view |
| Inline ref with cards or unified | Unified inline-ref + single Detail container | Cleaner than mixing cards + detail; CLI-style |
| Confirm button location | Detail pane only, no inline shortcut | Prevents accidental confirms; iron law #4 |
| Idea inline rendering | NEVER inline; only in Right Panel Ideas zone | Keep chat clean; idea is "set aside" semantics |
| Edit on active nodes | Forbidden in UI | Matches DB-level constraint |
| Re-entry snapshot | Conditional (>7d), not permanent | Avoid dashboard drift; serve Re-entry Success Rate |
| Ideas zone default | Collapsed | Idea = quiet signal; doesn't compete with candidates |
| /save selection toolbar | Above selection on text select | Standard pattern; minimal mode-switch |
| Unclassified visual | U-prefix + amber accent + "?" badge | Clearly non-final state without being alarming |
| Tree view modes | By Type + By Relation | Two mental models cover most queries |
| MCP coverage feedback | Subtle in-Zeno banner during blocking sweep | Inform but don't block chat |

---

**End of Spec**
