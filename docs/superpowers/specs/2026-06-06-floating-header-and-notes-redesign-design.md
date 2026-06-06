# Floating Header + Natural Ideas/Candidates — Design

**Date:** 2026-06-06
**Branch:** `codex/phase1-db-tests-sync`
**Status:** Design — pending user review
**Builds on:** `2026-06-05-truth-graph-main-stage-design.md`

---

## 1. Problem

After the main-stage redesign, testing surfaced four issues:

1. **Two stacked header layers** (the `WorkspaceToolbar` row + the chat's own `ChatHeader` row) eat vertical space and box the canvas in, killing the sense of airiness.
2. **The composer is pushed off-screen.** `ChatShell` is `h-dvh`, but it now renders *below* the in-flow `WorkspaceToolbar` inside a flex column, so total height exceeds the viewport and the input is partly clipped at the bottom.
3. **Import lives on the top bar**, where it competes for header space.
4. **Ideas/Candidates rows read like code** — `G36`-style id codes, lowercase technical type labels, monospace — "like code dumped without styling." The product is for non-technical planners; rows should read like handwritten notes.

## 2. Goals

- One slim, transparent header so the canvas breathes full-height.
- Composer returns to its natural (Claude/Codex-like) position.
- Import moves into the composer as a `＋` button.
- Ideas/Candidates rows read as natural notes.

## 3. Non-Goals

- No change to chat behavior, message rendering, or the AI's own raw output in messages (the JSON in the assistant message is model output, out of scope — user confirmed the concern is the drawer list, not the chat).
- No change to truth-graph rendering or the drawer's slide-over mechanics (those shipped already).
- No mobile-specific layout (desktop-only per the truth-graph rules §2.2), but the sidebar toggle must remain reachable.

## 4. Confirmed decisions (validated via visual mockups)

| Topic | Decision |
|---|---|
| Header form | **Floating islands (no bar)** — glass pills over a full-bleed canvas. |
| Islands | Identity (`# topic`) · compact icon cluster (back / forward / ✦ explore) · **center switch** `Conversation ｜ Truth Graph` (the hero) · `Ideas n · Candidates n` pill. |
| Island style | `backdrop-filter` blur + 1px hairline border + soft shadow; active tab = filled pill, inactive = muted. Real line icons (MessagesSquare / Network / ArrowLeft / ArrowRight / Sparkles). |
| Import | Moves into the composer: a single **`＋` button opens a small popover menu** with **Attach file** and **Import decisions** (the latter opens `IRBulkImportDialog`). |
| Ideas/Candidates rows | **Note row**: a quiet coloured type word (Goal / Decision / Open question…), the title as the headline, and a faint one-line preview drawn from the human rationale (never raw `{ }`; omitted if no clean prose). No id codes, no monospace. |

## 5. Architecture

### 5.1 Floating header

New `components/workspace/workspace-header.tsx` → `WorkspaceHeader`. It **consolidates** today's `WorkspaceToolbar` (view switch + counts pill) and the *top controls* of `ChatHeader` (topic name, Back/Forward, Explore new idea), rendered as four absolutely-positioned glass "islands."

- **Mounted in `workspace-shell.tsx`**, positioned `absolute` over the center content region (so it overlays **both** the Conversation and Truth Graph views identically). It is *out of flow* — it reserves no layout height.
- **Pointer-through:** the header's full-width container is `pointer-events-none`; each island is `pointer-events-auto`. Clicks in the gaps fall through to the canvas.
- **Data sources:** view state (`view`/`setView`) passed as props from `workspace-shell`; topic/nav/explore from `useWorkspace()` (`activeTopic`, `canGoBack`/`canGoForward`, `goBack`/`goForward`, plus the Explore-new-idea action + its confirm dialog, moved here from `ChatHeader`); counts from `useIR()` (must be rendered inside `IRProvider`, as the current `ViewToolbar` wrapper already is).
- **Islands:**
  - *Identity:* `#` glyph (muted) + `activeTopic.label` (truncated), "Archived" hint preserved.
  - *Actions:* icon-only Back / Forward (disabled states preserved) + Explore (Sparkles) which opens the existing confirm `AlertDialog`.
  - *Switch (center, hero):* radio-group `Conversation | Truth Graph` (reuse the a11y pattern already built in `WorkspaceToolbar`: `role="radiogroup"`/`role="radio"`/`aria-checked`).
  - *Triage:* `Ideas n · Candidates n` → opens the drawer (`onOpenDrawer`).
- **Sidebar toggle:** include the `PanelLeft` sidebar toggle (currently in `ChatHeader`) as a small control in the identity island (or its own tiny island) so collapsing/expanding the sidebar stays reachable.

`WorkspaceToolbar` is retired (its switch + pill markup fold into `WorkspaceHeader`).

### 5.2 Chat shell + canvas height

- `components/chat/shell.tsx`: **remove the `<ChatHeader>` mount.** Its controls now live in the floating header. `Messages` becomes the top of the chat column.
- The center content region in `workspace-shell` becomes a `relative` full-height box; the active view (chat or `TruthGraphStage`) fills it, and `WorkspaceHeader` overlays the top. With no in-flow toolbar, `ChatShell`'s `h-dvh`/`flex-1` math fits the viewport again and the composer sits at its natural bottom position (fix for problem #2).
- **Clearance:** give the `Messages` scroll region top padding (≈ island height + margin, ~64px) so the first message and the scroll start clear the floating islands. The Truth Graph stage similarly gets top padding so the overview isn't hidden under the islands.
- `components/chat/chat-header.tsx`: the Explore-new-idea logic + dialog migrate into `WorkspaceHeader` (or a small shared `useExploreNewIdea` hook to keep `WorkspaceHeader` lean). The file is deleted once empty. (Confirm no other route mounts `ChatHeader`; it is only used by `ChatShell`.)

### 5.3 Composer `＋` menu (Attach + Import)

`components/chat/multimodal-input.tsx`: replace the standalone attachments paperclip with a single **`＋` button** in the composer footer (left) that opens a small popover menu (e.g. the existing `DropdownMenu`/`Popover` primitive) with two items:
- **Attach file** — triggers the existing attachments/upload flow (the current paperclip `onClick`).
- **Import decisions** — opens `IRBulkImportDialog`; disabled when `!activeProjectId || !activeTopicId || archived` (mirrors today's header gating).

The `IRBulkImportDialog` moves out of `ChatHeader` into this menu. Attach and Import are distinct functions surfaced under one `＋`, matching the ChatGPT/Claude pattern.

### 5.4 Ideas/Candidates "Note row"

`components/ir/ir-drawer.tsx` → redesign `NodeButton`:
- Remove `node.id` and the monospace span.
- **Type line:** a small coloured dot + the natural-cased type word from a new `kindPresentation(node)` helper → `{ label, color }`, e.g. Goal / Decision / Constraint / Open question / Hypothesis / Principle / Candidate. Colours reuse existing semantic tokens (decision → `--z-confirmed` green, open_question → `--z-attention` amber, hypothesis/candidate → `--z-candidate` purple, others → neutral). Uses the human label, not `goal`/`plan:decision`.
- **Title:** `node.title` as the headline (natural text), keeping the superseded line-through / idea-muted states.
- **Preview (optional):** one line from `node.rationale` (fallback `node.content` only if it is plain prose) — truncated, muted. If neither is clean prose, show nothing. Never render raw structured text.
- Selection affordance (left accent bar) preserved.

The shared `IRDetailPane` header currently shows `getNodeTypeLabel(node) {node.id}` in monospace — for consistency, drop the `node.id` there too and use the natural type label. (Small, keeps detail aligned with the list; the action bars/relations are unchanged.)

A small `kindPresentation` helper (label + colour per `IRKind`/subtype) lives in `ir-detail.tsx` (next to `getNodeTypeLabel`) so both the row and the detail header share one source of truth.

## 6. Milestones

1. **Floating header**: build `WorkspaceHeader`; mount in `workspace-shell` as an out-of-flow overlay; retire `WorkspaceToolbar`; pointer-through container.
2. **Canvas height + clearance**: remove `ChatHeader` from `ChatShell`; migrate Explore logic; add top clearance to Messages + stage; delete `chat-header.tsx`.
3. **Composer ＋ menu**: replace the paperclip with a `＋` popover (Attach file / Import decisions) in `multimodal-input`.
4. **Note-row Ideas/Candidates**: `kindPresentation` helper + redesigned `NodeButton` + detail-header id removal.

Each milestone is independently shippable and keeps the app working.

## 7. Testing

- **Build/type/lint:** `npx tsc --noEmit`, `npx biome check`, `npx next build` green.
- **Unit:** existing suites still pass; add a unit test for `kindPresentation` (kind/subtype → expected label + colour token).
- **E2e:** the existing `workspace-phase2.test.ts` view-switch/drawer flow still passes against the new header selectors (the `role="radio"` switch and `ir-drawer-trigger` move into `WorkspaceHeader` but keep the same testids/roles).
- **Manual:** composer no longer clipped; islands float and don't block canvas clicks in the gaps; first message/overview clears the islands; Ideas/Candidates rows read as notes with no `G36`/JSON.

## 8. Risks & Mitigations

- **Pointer-events blocking the canvas** — mitigate with `pointer-events-none` container + `pointer-events-auto` islands; verify the gaps are click-through.
- **Sidebar toggle lost** — explicitly re-home the `PanelLeft` toggle into the header.
- **`ChatHeader` used elsewhere** — verify it is only mounted by `ChatShell` before deleting; if referenced elsewhere, keep the file but drop its use here.
- **Top-clearance vs scroll** — ensure the Messages auto-scroll-to-bottom and the sticky composer still behave with the added top padding (padding only at the scroll start, not the composer).
- **Stale-prose preview** — guard the preview against rendering structured/`{`-leading content; prefer `rationale`.

## 9. Open questions

None blocking. Attach and Import are unified under one composer `＋` popover menu (user-confirmed) — the paperclip is replaced, not kept alongside.
