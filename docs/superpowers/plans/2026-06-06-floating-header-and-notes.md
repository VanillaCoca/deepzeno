# Floating Header + Natural Ideas/Candidates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two stacked header rows with a single floating-islands header over a full-bleed canvas, move Import into a composer `＋` menu, fix the clipped composer, and make Ideas/Candidates rows read like notes instead of code.

**Architecture:** A new out-of-flow `WorkspaceHeader` overlay (glass islands, pointer-through) consolidates the old `WorkspaceToolbar` + the chat `ChatHeader` controls; removing both in-flow headers lets `ChatShell`'s `h-dvh` fit the viewport again. The composer's attachments button becomes a `＋` dropdown (Attach file / Import decisions). Ideas/Candidates rows use a shared `kindPresentation` helper for a natural type label + semantic colour.

**Tech Stack:** Next.js + React 19 client components, Tailwind v4 + `--ir-*`/`--z-*` design tokens, lucide-react icons, Radix-based `DropdownMenu`/`Dialog`/`AlertDialog` primitives in `components/ui/`, Biome (ultracite), `node:test` unit tests, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-06-floating-header-and-notes-redesign-design.md`

**Conventions:** use `npx` (not `pnpm`) for commands. A pre-existing whole-file CRLF biome "format" baseline on already-large files is acceptable; new files must be fully clean. Commit message bodies end with:
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## File Structure

**Created:**
- `components/workspace/workspace-header.tsx` — the floating-islands header (view switch + counts pill + topic + back/forward + explore + sidebar toggle). Replaces `WorkspaceToolbar`.
- `tests/unit/kind-presentation.test.ts` — unit test for the type-label/colour helper.

**Modified:**
- `components/ir/ir-detail.tsx` — add `kindPresentation`; drop `node.id`/mono from the detail header.
- `components/ir/ir-drawer.tsx` — Note-row `NodeButton`.
- `components/ir/ir-bulk-import-dialog.tsx` — support controlled `open`/`onOpenChange` (no self-trigger when controlled).
- `components/chat/multimodal-input.tsx` — replace the attachments paperclip with a `＋` dropdown.
- `components/workspace-shell.tsx` — mount `WorkspaceHeader` as overlay; full-height content; retire `WorkspaceToolbar`.
- `components/chat/shell.tsx` — remove `<ChatHeader>`; the chat column starts at `Messages`.
- `components/chat/messages.tsx` — top clearance so content clears the floating islands.
- `components/ir/truth-graph-stage.tsx` — top clearance for the overview.

**Deleted:**
- `components/workspace/workspace-toolbar.tsx`
- `components/chat/chat-header.tsx`

---

## Task 1: `kindPresentation` helper (TDD)

**Files:**
- Modify: `components/ir/ir-detail.tsx`
- Test: `tests/unit/kind-presentation.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/kind-presentation.test.ts`:
```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { kindPresentation } from "../../components/ir/ir-detail.tsx";

describe("kindPresentation", () => {
  it("uses the natural human label, not the code id", () => {
    assert.equal(kindPresentation("plan", "decision").label, "Decision");
    assert.equal(kindPresentation("goal", null).label, "Goal");
    assert.equal(kindPresentation("open_question", null).label, "Open question");
  });
  it("maps semantic colours: decision green, open question amber, hypothesis purple, others neutral", () => {
    assert.equal(kindPresentation("plan", "decision").color, "var(--z-confirmed)");
    assert.equal(kindPresentation("open_question", null).color, "var(--z-attention)");
    assert.equal(kindPresentation("hypothesis", null).color, "var(--z-candidate)");
    assert.equal(kindPresentation("constraint", null).color, "var(--z-node-stroke)");
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node --test --experimental-strip-types tests/unit/kind-presentation.test.ts`
Expected: FAIL — `kindPresentation` is not exported.

- [ ] **Step 3: Implement `kindPresentation` in `ir-detail.tsx`**

Add near `getNodeTypeLabel` (which already produces the human label via `getIRTypeLabel`). Reuse it for the label so there is one source of truth:
```ts
import type { IRKind, IRPlanSubtype } from "@/lib/ir/types";
import { getIRTypeLabel } from "@/lib/ir/types";

export function kindPresentation(
  kind: IRKind,
  subtype: IRPlanSubtype | null
): { label: string; color: string } {
  const rawLabel = getIRTypeLabel(kind, subtype); // "Decision", "Goal", "Open Question", ...
  // Sentence-case multiword labels so they read like notes ("Open question").
  const label =
    rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
  let color = "var(--z-node-stroke)";
  if (kind === "plan" && subtype === "decision") {
    color = "var(--z-confirmed)";
  } else if (kind === "open_question") {
    color = "var(--z-attention)";
  } else if (kind === "hypothesis") {
    color = "var(--z-candidate)";
  } else if (kind === "rejection") {
    color = "var(--z-rejected)";
  }
  return { label, color };
}
```
Note: `getIRTypeLabel("open_question")` returns `"Open Question"`; the sentence-case step turns it into `"Open question"`. Verify this against `lib/ir/types.ts` and adjust the casing transform if `getIRTypeLabel` already returns the desired form.

- [ ] **Step 4: Run the test, confirm PASS**

Run: `node --test --experimental-strip-types tests/unit/kind-presentation.test.ts`
Expected: PASS (2 tests). Fix the implementation (not the test) if the label casing differs.

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` (clean), `npx biome check components/ir/ir-detail.tsx tests/unit/kind-presentation.test.ts` (clean on touched lines).
```bash
git add components/ir/ir-detail.tsx tests/unit/kind-presentation.test.ts
git commit -m "Add kindPresentation helper for natural type labels + semantic colours"
```

---

## Task 2: Note-row Ideas/Candidates

**Files:**
- Modify: `components/ir/ir-drawer.tsx` (the `NodeButton` component, ~lines 14–59)
- Modify: `components/ir/ir-detail.tsx` (detail header)

- [ ] **Step 1: Redesign `NodeButton` in `ir-drawer.tsx`**

Replace the current `NodeButton` (type + monospace `node.id` + title) with a note row. Import `kindPresentation` from `@/components/ir/ir-detail`. Add a preview helper that only shows clean prose:
```tsx
function notePreview(node: IRNode): string | null {
  const raw = node.rationale ?? node.content ?? "";
  const text = raw.replace(/\s+/g, " ").trim();
  // Never surface raw structured/JSON-ish content.
  if (!text || text.startsWith("{") || text.startsWith("[")) {
    return null;
  }
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function NodeButton({
  node,
  selected,
  onSelect,
}: {
  node: IRNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { label, color } = kindPresentation(node.kind, node.subtype);
  const preview = notePreview(node);
  return (
    <button
      className={cn(
        "relative block w-full border-b border-[var(--ir-border-default)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--ir-bg-hover)]",
        selected &&
          "bg-[var(--ir-bg-hover)] before:absolute before:top-0 before:left-0 before:h-full before:w-0.5 before:bg-[var(--ir-accent-blue)]"
      )}
      onClick={() => onSelect(node.id)}
      title={node.title}
      type="button"
    >
      <span className="flex items-center gap-1.5 text-[11px] text-[var(--ir-text-tertiary)]">
        <span
          className="size-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      <div
        className={cn(
          "mt-1 text-[13.5px] leading-[1.4] text-[var(--ir-text-primary)]",
          node.status === "superseded" &&
            "text-[var(--ir-text-tertiary)] line-through",
          node.status === "idea" && "text-[var(--ir-text-secondary)]"
        )}
      >
        {node.title}
      </div>
      {preview ? (
        <div className="mt-1 truncate text-xs text-[var(--ir-text-tertiary)]">
          {preview}
        </div>
      ) : null}
    </button>
  );
}
```
Remove the now-unused `getNodeTypeLabel` import from `ir-drawer.tsx` **only if** it is no longer referenced elsewhere in the file (check first — keep it if still used).

- [ ] **Step 2: Drop the id/mono from the detail header in `ir-detail.tsx`**

In `IRDetailPane`'s header, the line currently renders `getNodeTypeLabel(node) {node.id}` in a monospace span. Replace it with the natural type label only (no id, no mono):
```tsx
// before: <p className="font-[var(--ir-font-mono)] ...">{getNodeTypeLabel(selectedNode)} {selectedNode.id}</p>
<p className="text-xs text-[var(--ir-text-secondary)]">
  {kindPresentation(selectedNode.kind, selectedNode.subtype).label}
</p>
```
Keep the title `<h3>`, the status badge row, rationale/relations/source sections, and all action bars unchanged. If `getNodeTypeLabel` becomes unused in `ir-detail.tsx`, leave it exported (other files import it) but remove any now-dead local usage.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` (clean); `npx biome check components/ir/ir-drawer.tsx components/ir/ir-detail.tsx` (clean on touched lines); `node --test --experimental-strip-types tests/unit/kind-presentation.test.ts` (still passes).
Manual reasoning: a candidate row shows a coloured dot + "Decision" + the title + an optional faint rationale line; no `G36`, no monospace, no `{ }`.

- [ ] **Step 4: Commit**

```bash
git add components/ir/ir-drawer.tsx components/ir/ir-detail.tsx
git commit -m "Render Ideas/Candidates as natural note rows (drop id codes and code styling)"
```

---

## Task 3: Composer `＋` menu (Attach + Import)

**Files:**
- Modify: `components/ir/ir-bulk-import-dialog.tsx`
- Modify: `components/chat/multimodal-input.tsx`

- [ ] **Step 1: Make `IRBulkImportDialog` controllable**

Read `components/ir/ir-bulk-import-dialog.tsx`. It currently renders its own `<DialogTrigger>` button. Add optional controlled props so a parent menu can open it without the built-in trigger:
```tsx
// props: add
open?: boolean;
onOpenChange?: (open: boolean) => void;
hideTrigger?: boolean;
```
Wire the internal `<Dialog>` to use `open`/`onOpenChange` when provided (fall back to internal `useState` when not), and render the `<DialogTrigger>` button only when `!hideTrigger`. Keep all existing import/extract/confirm logic untouched. This preserves the current `<IRBulkImportDialog disabled={...} />` usage AND enables `<IRBulkImportDialog hideTrigger open={x} onOpenChange={setX} disabled={...} />`.

- [ ] **Step 2: Replace the paperclip with a `＋` dropdown in `multimodal-input.tsx`**

In the `PromptInputFooter` → `PromptInputTools` (around line 630), replace `<AttachmentsButton .../>` with a `＋` `DropdownMenu` (from `@/components/ui/dropdown-menu`). The menu has two items:
- **Attach file** — runs the same action as the old paperclip (`fileInputRef.current?.click()`), disabled when the model lacks vision (reuse the `hasVision` logic from `PureAttachmentsButton`).
- **Import decisions** — opens `IRBulkImportDialog` (controlled), disabled when `!activeProjectId || !activeTopicId || archived` (get these from `useWorkspace()`).

Sketch:
```tsx
import { PlusIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IRBulkImportDialog } from "@/components/ir/ir-bulk-import-dialog";
import { useWorkspace } from "@/components/workspace/workspace-provider";

function ComposerPlusMenu({ fileInputRef, status, selectedModelId }: { /* same as AttachmentsButton */ }) {
  const { activeProjectId, activeTopic, activeTopicId } = useWorkspace();
  const [importOpen, setImportOpen] = useState(false);
  const hasVision = /* reuse from PureAttachmentsButton */;
  const importDisabled = !activeProjectId || !activeTopicId || Boolean(activeTopic?.archivedAt);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-7 w-7 rounded-lg border border-border/40 p-1 text-muted-foreground hover:text-foreground" data-testid="composer-plus" variant="ghost">
            <PlusIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled={status !== "ready" || !hasVision} onSelect={() => fileInputRef.current?.click()}>Attach file</DropdownMenuItem>
          <DropdownMenuItem disabled={importDisabled} onSelect={() => setImportOpen(true)}>Import decisions</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IRBulkImportDialog disabled={importDisabled} hideTrigger onOpenChange={setImportOpen} open={importOpen} />
    </>
  );
}
```
Render `<ComposerPlusMenu .../>` where `<AttachmentsButton/>` was, passing the same props. Keep the hidden file `<input ref={fileInputRef}>` that already exists in the component. Delete the now-unused `PureAttachmentsButton`/`AttachmentsButton` if nothing else references it (check first).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` (clean); `npx biome check components/ir/ir-bulk-import-dialog.tsx components/chat/multimodal-input.tsx` (clean on touched lines).
Manual reasoning: composer shows one `＋`; clicking opens a menu; "Attach file" opens the file picker (vision models only), "Import decisions" opens the import dialog.

- [ ] **Step 4: Commit**

```bash
git add components/ir/ir-bulk-import-dialog.tsx components/chat/multimodal-input.tsx
git commit -m "Move Import into a composer + menu alongside Attach file"
```

---

## Task 4: Build the floating `WorkspaceHeader`

**Files:**
- Create: `components/workspace/workspace-header.tsx`

This is additive — do not modify `workspace-shell.tsx` or remove anything yet (Task 5 wires it).

- [ ] **Step 1: Create `WorkspaceHeader`**

```tsx
"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PanelLeftIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { useIR } from "@/components/ir/ir-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";

export type WorkspaceView = "conversation" | "truth-graph";

const ISLAND =
  "pointer-events-auto inline-flex h-9 items-center gap-1 rounded-xl border border-[var(--ir-border-default)] bg-[color-mix(in_srgb,var(--ir-bg-panel)_72%,transparent)] px-1.5 shadow-[0_6px_20px_rgba(0,0,0,0.28)] backdrop-blur-md";

export function WorkspaceHeader({
  view,
  onViewChange,
  onOpenDrawer,
}: {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  onOpenDrawer: () => void;
}) {
  const { toggleSidebar } = useSidebar();
  const { ideas, candidates } = useIR();
  const {
    activeTopic,
    activeProjectId,
    activeTopicId,
    currentConversationId,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    clearConversation,
  } = useWorkspace();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [isExploring, setIsExploring] = useState(false);

  async function handleExplore() {
    if (!(activeProjectId && activeTopicId && currentConversationId)) {
      return;
    }
    setIsExploring(true);
    try {
      fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/sweep/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: activeProjectId,
          chat_session_id: currentConversationId,
          blocking: false,
        }),
      }).catch(console.error);
      await clearConversation();
      setExploreOpen(false);
    } finally {
      setIsExploring(false);
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-14">
      {/* left: sidebar toggle + topic identity */}
      <div className="absolute top-2.5 left-3 flex items-center gap-2">
        <span className={cn(ISLAND, "pr-2.5")}>
          <Button onClick={toggleSidebar} size="icon-sm" variant="ghost">
            <PanelLeftIcon className="size-4" />
          </Button>
          <span className="max-w-[200px] truncate text-sm font-medium text-[var(--ir-text-primary)]">
            <span className="mr-0.5 font-normal text-[var(--ir-text-tertiary)]">
              #
            </span>
            {activeTopic?.label ?? "Workspace"}
          </span>
        </span>
        <span className={ISLAND}>
          <Button disabled={!canGoBack} onClick={goBack} size="icon-sm" variant="ghost">
            <ArrowLeftIcon className="size-4" />
          </Button>
          <Button disabled={!canGoForward} onClick={goForward} size="icon-sm" variant="ghost">
            <ArrowRightIcon className="size-4" />
          </Button>
          <Button
            disabled={
              isExploring ||
              !activeProjectId ||
              !activeTopicId ||
              !currentConversationId ||
              Boolean(activeTopic?.archivedAt)
            }
            onClick={() => setExploreOpen(true)}
            size="icon-sm"
            variant="ghost"
          >
            <SparklesIcon className="size-4" />
          </Button>
        </span>
      </div>

      {/* center: the view switch (hero) */}
      <div className="-translate-x-1/2 absolute top-2.5 left-1/2">
        <div
          aria-label="Workspace view"
          className={cn(ISLAND, "gap-1 p-1")}
          role="radiogroup"
        >
          {(["conversation", "truth-graph"] as const).map((value) => (
            <Button
              aria-checked={view === value}
              className={cn(
                "h-7 rounded-lg px-2.5 text-xs",
                view === value
                  ? "bg-[var(--ir-bg-hover)] text-[var(--ir-text-primary)]"
                  : "text-[var(--ir-text-tertiary)]"
              )}
              key={value}
              onClick={() => onViewChange(value)}
              role="radio"
              size="xs"
              variant="ghost"
            >
              {value === "conversation" ? (
                <MessagesSquareIcon className="size-3.5" />
              ) : (
                <NetworkIcon className="size-3.5" />
              )}
              {value === "conversation" ? "Conversation" : "Truth Graph"}
            </Button>
          ))}
        </div>
      </div>

      {/* right: triage pill */}
      <div className="absolute top-2.5 right-3">
        <button
          className={cn(ISLAND, "px-3 text-xs text-[var(--ir-text-secondary)]")}
          data-testid="ir-drawer-trigger"
          onClick={onOpenDrawer}
          type="button"
        >
          Ideas&nbsp;
          <b className="font-medium text-[var(--ir-text-primary)]">
            {ideas.length}
          </b>
          <span className="mx-1.5 text-[var(--ir-text-tertiary)]">·</span>
          Candidates&nbsp;
          <b className="font-medium text-[var(--ir-text-primary)]">
            {candidates.length}
          </b>
        </button>
      </div>

      <AlertDialog onOpenChange={setExploreOpen} open={exploreOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Explore new idea</AlertDialogTitle>
            <AlertDialogDescription>
              Start fresh on a new idea in this topic? ZENO will review the
              current discussion before clearing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isExploring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isExploring}
              onClick={(event) => {
                event.preventDefault();
                handleExplore().catch(console.error);
              }}
            >
              Yes, explore new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```
Before finalizing, VERIFY: `useWorkspace()` exposes `activeTopic`, `activeProjectId`, `activeTopicId`, `currentConversationId`, `canGoBack`, `canGoForward`, `goBack`, `goForward`, `clearConversation` (read `components/workspace/workspace-provider.tsx`); `useSidebar()` exposes `toggleSidebar`; `Button` supports `size="icon-sm"`/`size="xs"`. Note `color-mix(...)` here is in a Tailwind class targeting `--ir-*` panel chrome (NOT the truth-graph zero-literal scope, which governs `truth-graph.tsx`); if the project lints against `color-mix`, fall back to an existing translucent token used elsewhere in the app chrome.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` (clean); `npx biome check components/workspace/workspace-header.tsx` (fully clean — fix attribute/import sort).
```bash
git add components/workspace/workspace-header.tsx
git commit -m "Add floating WorkspaceHeader (islands over a full-bleed canvas)"
```

---

## Task 5: Wire the floating header; remove old headers; canvas clearance

**Files:**
- Modify: `components/workspace-shell.tsx`
- Modify: `components/chat/shell.tsx`
- Modify: `components/chat/messages.tsx`
- Modify: `components/ir/truth-graph-stage.tsx`
- Delete: `components/workspace/workspace-toolbar.tsx`, `components/chat/chat-header.tsx`

- [ ] **Step 1: Mount the header overlay in `workspace-shell.tsx`**

Remove the local `ViewToolbar` wrapper and the `WorkspaceToolbar` import. Import `WorkspaceHeader` + `WorkspaceView` from `@/components/workspace/workspace-header`. Make the center column `relative` and overlay the header:
```tsx
<div className="relative flex h-dvh min-w-0">
  <div className="relative flex min-w-0 flex-1 flex-col">
    <WorkspaceHeader
      onOpenDrawer={() => setDrawerOpen(true)}
      onViewChange={setView}
      view={view}
    />
    <div className="min-h-0 flex-1 overflow-hidden">
      {view === "truth-graph" ? <TruthGraphStage /> : children}
    </div>
  </div>
</div>
```
Keep `<IRDrawer ... />` exactly as-is (incl. `onNavigateToTruth`). `WorkspaceView` type now comes from `workspace-header.tsx`.

- [ ] **Step 2: Remove `<ChatHeader>` from `components/chat/shell.tsx`**

Delete the `<ChatHeader ... />` element (around lines 84–88) and its `import { ChatHeader } from "./chat-header";`. The chat column now begins with the `<div className="relative flex min-h-0 flex-1 ...">` that wraps `Messages`. Nothing else in `shell.tsx` changes.

- [ ] **Step 3: Add top clearance so content clears the floating islands**

In `components/chat/messages.tsx`, find the scrollable messages container (the element with `overflow-y-auto`) and add top padding `pt-16` to its inner content (so the first message starts below the ~56px islands; do NOT pad the sticky composer). If the scroll container and content are the same element, add `pt-16` there.
In `components/ir/truth-graph-stage.tsx`, add `pt-14` to the root `div` (`className="flex h-full flex-col pt-14"`) so the overview/graph clears the islands.

- [ ] **Step 4: Delete the retired files**

```bash
git rm components/workspace/workspace-toolbar.tsx components/chat/chat-header.tsx
```
Then search the repo for `workspace-toolbar`, `WorkspaceToolbar`, `chat-header`, `ChatHeader` — there must be no remaining references in `components/` or `app/` (the `WorkspaceView` type is now imported from `workspace-header`; update any other importer of it).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` (clean — this catches any dangling `WorkspaceView`/`ChatHeader` import). `npx biome check components/workspace-shell.tsx components/chat/shell.tsx components/chat/messages.tsx components/ir/truth-graph-stage.tsx` (clean on touched lines). `npx next build` (succeeds). Repo search confirms no `WorkspaceToolbar`/`ChatHeader` references remain.
Manual reasoning: one floating header over both views; the composer sits at the natural bottom (not clipped); first message + overview clear the islands; clicking in the gaps between islands reaches the canvas (pointer-events).

- [ ] **Step 6: Update e2e if needed + commit**

The `role="radio"` view switch and `data-testid="ir-drawer-trigger"` moved into `WorkspaceHeader` with identical roles/testids, so `tests/e2e/workspace-phase2.test.ts` should still pass. If any selector referenced the old toolbar container, re-point it. Run `npx tsc --noEmit` on the test (do not run Playwright).
```bash
git add components/workspace-shell.tsx components/chat/shell.tsx components/chat/messages.tsx components/ir/truth-graph-stage.tsx tests/e2e/workspace-phase2.test.ts
git rm components/workspace/workspace-toolbar.tsx components/chat/chat-header.tsx
git commit -m "Mount floating header, retire stacked headers, give the canvas full height"
```

---

## Self-Review

**Spec coverage:**
- §5.1 floating header (islands, pointer-through, sidebar toggle, switch, counts, topic, back/forward, explore) → Tasks 4, 5. ✓
- §5.2 remove ChatHeader, full-height canvas, top clearance, delete chat-header.tsx → Task 5. ✓
- §5.3 composer `＋` menu (Attach + Import), controllable import dialog → Task 3. ✓
- §5.4 Note-row rows + `kindPresentation` + detail header id removal → Tasks 1, 2. ✓
- §7 testing (kindPresentation unit test; build; e2e selectors preserved) → Tasks 1, 5. ✓
- §8 risks (pointer-events, sidebar toggle re-homed, ChatHeader-only-in-shell, clearance, stale-prose preview guard) → addressed in Tasks 2, 4, 5. ✓

**Placeholder scan:** No TBD/TODO; new code shown; move/edit tasks cite exact files and the surrounding anchors. Verification steps have concrete commands + expected results.

**Type consistency:** `kindPresentation(kind, subtype) → { label, color }` is defined in Task 1 and consumed identically in Task 2 (NodeButton + detail). `WorkspaceHeader`/`WorkspaceView` props (`view`, `onViewChange`, `onOpenDrawer`) match between Task 4 (definition) and Task 5 (mount). `IRBulkImportDialog` controlled props (`open`/`onOpenChange`/`hideTrigger`) defined in Task 3 Step 1 and used in Task 3 Step 2.
