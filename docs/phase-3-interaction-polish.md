# Phase 3: Interaction Polish + Sidebar + Sandbox Navigation

> **Audience**: This file is for Codex to execute, but Sean will provide
> frequent feedback during this phase. Expect multiple iteration rounds.
> Each sub-task may go through 2-3 revision cycles based on Sean's testing.
>
> **Prerequisite**: Phase 2 is complete. The full decision loop
> (chat → extract → confirm → tree → context injection) works end-to-end.

---

## Context for Codex

Phase 3 is about making the product feel right. The core loop works, but the
interactions need refinement. Sean will test each feature and provide specific
feedback. Expect to receive follow-up instructions like "the animation is too
slow" or "the panel transition feels janky" — these are normal iteration, not bugs.

**UX PRESERVATION RULE (from Phase 1, still applies):**
Full-viewport layout, responsive behavior, and streaming UX quality from the
vercel/chatbot template must never degrade. Polish means making things better
than the template baseline, never worse. Do NOT reference the old Codex demo's
visual/layout approach — only its functional behavior.

---

## Task 1: Project Sidebar — Full Implementation

### What It Does

Replace the Phase 1 placeholder sidebar with a functional project + topic navigation system.

### Steps

1. Modify `components/project-sidebar.tsx`:

   **Top section: Project selector**
   - Dropdown showing the user's projects.
   - "New Project" button below the dropdown.
   - Creating a project: modal with name input. On create, auto-provision a General topic.

   **Middle section: Topics list**
   - Shows all non-archived topics for the selected project.
   - Each topic item shows: label, unread candidate count badge (if any pending candidates).
   - Clicking a topic switches the sandbox and truth panel to that topic's context.
   - "New Topic" button at the bottom of the list. On create: modal with label input, inserts with next position value.
   - The General topic is always first and cannot be archived.
   - Drag-to-reorder topics (optional — skip if complex, just use position field ordering).

   **Bottom section: Archived topics**
   - Collapsible section labeled "Archived".
   - Shows topics with `archived_at` set.
   - Clicking an archived topic shows it read-only (chat history viewable, no new messages, tree viewable).
   - No unarchive action in V1.

2. Implement topic archiving:
   - Right-click or three-dot menu on a non-General topic → "Archive".
   - Sets `archived_at = now()` on the topic.
   - Topic moves to the Archived section.

3. When switching topics:
   - Sandbox loads the most recent conversation segment for that topic.
   - Truth panel (tree + candidate pool) loads that topic's decisions and candidates.
   - If no conversation exists for the topic, create one automatically.

### Acceptance

- User can create projects and topics.
- Switching topics updates both the chat and the truth panel.
- General topic is always first and not archivable.
- Archived topics appear in collapsed section.
- Pending candidate count badge shows on topics that have unreviewed candidates.

---

## Task 2: Sandbox Navigation — Conversation Segments

### What It Does

Users can clear the sandbox (start a fresh conversation) and navigate between
previous conversation segments using back/forward.

### Steps

1. Add toolbar buttons above the chat input:
   - **Clear** (eraser icon): closes the current conversation (sets `ended_at = now()`) and creates a new empty conversation for the same topic. Old messages disappear from view but are preserved in DB.
   - **Back** (left arrow): navigate to the previous conversation segment. Shows older messages. Chat input is active — typing resumes that segment.
   - **Forward** (right arrow): navigate to the next conversation segment.

2. Conversation segment state:
   - Track `currentConversationId` in React state (or URL param).
   - When viewing an older segment, the forward button becomes active.
   - When at the latest segment, forward is disabled.
   - Back is disabled when at the oldest segment.

3. Switching to a topic always shows the most recent conversation segment.

### Acceptance

- Clear creates a new conversation and hides old messages.
- Back/forward navigate between conversation segments within the same topic.
- Typing in an old segment appends to that segment (resumes it).
- The experience feels like a sessionless, continuous chat surface.

---

## Task 3: Streaming Scroll Behavior

### What It Does

Fix the most common streaming UX issue: the page auto-scrolling while the user is trying to read.

### Steps

1. Implement scroll-intent detection in the chat message list:
   - If the user is scrolled to the bottom (within 100px threshold), auto-scroll as new tokens arrive.
   - If the user has scrolled up to read earlier messages, STOP auto-scrolling. Let them read in peace.
   - When the user scrolls back to the bottom, resume auto-scroll.

2. Add a "scroll to bottom" floating button that appears when the user is scrolled up and new content is arriving below.

3. Verify this works with long streaming responses (1000+ tokens).

### Acceptance

- During streaming, if user is at bottom, page scrolls smoothly with new content.
- If user scrolls up during streaming, scrolling stops — content continues to arrive but doesn't pull the viewport.
- "Scroll to bottom" button appears and works correctly.
- No jank or flicker during streaming.

---

## Task 4: Tree Panel View Mode Polish

### What It Does

Refine the two tree view modes from Phase 2.

### Steps

1. **By-type view** improvements:
   - Collapsible section headers for each kind (Goal, Constraint, Plan, Hypothesis, Principle, Evidence).
   - Show count next to header: "Goals (3)".
   - Empty sections are hidden (don't show "Hypotheses (0)").
   - Smooth expand/collapse animation.

2. **By-relation view** improvements:
   - Anchor decisions render as root nodes.
   - `depends_on` edges render as indented children.
   - `supersedes` edges render with a visual indicator (strikethrough on the superseded node, arrow from new to old).
   - Orphan decisions (no edges) appear in a separate "Standalone" section at the bottom.

3. **Superseded toggle**:
   - Toggle button in the tree toolbar: "Show superseded" / "Hide superseded".
   - When hidden, superseded nodes and their edges disappear from both view modes.
   - Default: hidden.

### Acceptance

- Both view modes render cleanly with real data (10+ decisions, 5+ edges).
- Sections collapse/expand smoothly.
- Superseded toggle works in both view modes.
- Empty sections don't show.

---

## Task 5: Detail Panel Transition & Polish

### What It Does

Make the detail panel feel smooth and professional.

### Steps

1. Panel opens with a slide-in animation from the right (200ms ease-out).
2. Panel closes with reverse slide-out animation.
3. When switching between two nodes (clicking one while another is open), crossfade the content rather than close-then-open.
4. The close button (X) is always visible at top-right, even when content is scrolled.
5. "Bring to sandbox" confirmation: brief visual feedback (button turns green + checkmark for 1s) after successful context restoration.
6. "Reference node" feedback: brief highlight on the chat input to draw attention to where the quote was inserted.

### Acceptance

- Panel transitions feel smooth, not janky.
- Switching between nodes doesn't cause layout jumps.
- Both action buttons provide clear feedback.

---

## Task 6: Candidate Inline Hint Animation

### What It Does

Polish the inline candidate hints from Phase 2.

### Steps

1. When a new hint appears after extraction completes:
   - Fade in over 0.5s.
   - Brief subtle glow/highlight for 1s, then settle to resting style.
2. Resting style: monospace, 80% opacity, small font.
3. Click to expand: smooth accordion animation showing candidate previews.
4. After batch confirm, transition the hint text from "+N candidates" to "✓ N confirmed" with a brief color change (default → green → settle to gray).

### Acceptance

- Hint appearance is noticeable but not distracting.
- Expand/collapse is smooth.
- Confirmation state transition is visible and satisfying.

---

## Phase 3 Definition of Done

The product feels like a real tool, not a prototype:

1. Full project + topic navigation works.
2. Sandbox clear / back / forward works.
3. Streaming doesn't hijack the user's scroll position.
4. Tree panel views are polished and toggle correctly.
5. Detail panel transitions are smooth.
6. Candidate hints animate appropriately.

**The complete user story**:
User logs in → creates a project → creates topics → chats with AI →
decisions are extracted → user reviews and confirms → decisions appear in tree →
user navigates between topics → context follows → user can reference past decisions
in new conversations → the AI knows what was decided.

**After Phase 3, the product is ready for Sean to demonstrate to potential users and investors.**
