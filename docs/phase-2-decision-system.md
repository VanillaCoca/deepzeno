# Phase 2: Decision System + Extraction Pipeline

> **Audience**: This file is for Codex to execute. Lixian reviews the output.
> Sean validates the complete decision loop by testing real conversations.
>
> **Prerequisite**: Phase 1 is complete and verified. Auth, three-column layout,
> chat streaming, model selector, and database schema are all working.

---

## Context for Codex

Phase 1 created the database schema and a working chat. Phase 2 connects them:
every assistant message triggers decision extraction, candidates appear in the UI,
and confirmed decisions are injected back into future conversations as context.

You will be working with:
- The Supabase tables created in Phase 1 (decisions, candidate_decisions, edges, decision_log, etc.)
- The existing chat API route at `app/api/chat/route.ts`
- The Vercel AI SDK's streaming and tool-calling capabilities

**Key principle**: The extraction pipeline runs asynchronously AFTER the assistant
response is complete. It must never block or delay the chat response.

**UX PRESERVATION RULE (from Phase 1, still applies):**
The app must remain a full-viewport web application. All new UI (candidate pool,
tree panel, detail panel, inline hints) must integrate into the existing layout
without breaking viewport fill, responsive behavior, or streaming UX. When
referencing the old Codex demo for feature behavior, only replicate functional
requirements — do not copy its fixed-size layout approach.

---

## Task 1: Async Decision Extraction Pipeline

### What It Does

After each assistant message is saved to the database, a background process:
1. Reads the recent conversation messages from the current topic.
2. Reads the existing confirmed decisions for the topic (serialized).
3. Sends both to Claude Sonnet 4.6 with an extraction prompt.
4. Parses the structured JSON output.
5. Writes results to `candidate_decisions` table.
6. Supabase Realtime notifies the frontend.

### Steps

1. Create `lib/decision-extraction.ts`:
   - Export `async function extractDecisions(params)`.
   - Params: `{ conversationId, topicId, projectId, messageId }`.
   - Reads last N messages (up to 20) from the conversation.
   - Reads confirmed decisions for the topic via `serializeDecisionGraph()`.
   - Calls Claude Sonnet 4.6 (non-streaming, separate from the chat call) with the extraction prompt.
   - Parses JSON response into candidate objects.
   - Writes to `candidate_decisions` with `content_hash` dedup (skip if same hash exists for same conversation).
   - Logs errors but never throws — extraction failure must not affect the user's chat experience.

2. Create `lib/decision-serializer.ts`:
   - Export `function serializeDecisionGraph(decisions, edges): string`.
   - Input: arrays of decision rows and edge rows for a topic.
   - Output: a compressed text representation under 2000 tokens.
   - Format: one line per decision, showing title, kind, weight, status.
   - Edges shown as `[A] --supersedes--> [B]` notation.
   - Anchor and key decisions listed first, then normal.

3. Create `lib/prompting.ts`:
   - Export the extraction system prompt.
   - The prompt instructs the model to:
     - Read the conversation and identify decisions (choices, rejections, constraints, goals, assumptions).
     - Output a JSON array of candidate objects.
     - Each candidate has: `proposed_title`, `proposed_content`, `proposed_rationale`, `proposed_kind` (goal|constraint|plan|hypothesis|principle), `proposed_weight` (anchor|key|normal), `confidence` (0.0-1.0), `suggested_edges` (array of {type, target_decision_id}), `relevant_message_ids` (array of message UUIDs that led to this decision).
     - If no decisions are found, return an empty array.
     - The model must compare against existing decisions to avoid duplicates and to detect supersession.

4. Integrate into the chat flow:
   - In `app/api/chat/route.ts` (or the relevant API handler), after the assistant response is fully streamed and the message is saved to DB:
   - Call `extractDecisions()` using `waitUntil()` or a fire-and-forget pattern (do NOT await in the response stream).
   - Only trigger for non-General topics (`topics.is_general = false`).

### Acceptance

- After each assistant message in a non-General topic, candidates appear in `candidate_decisions` table within 10 seconds.
- Duplicate extraction (same content_hash + conversation_id) is silently skipped.
- Extraction failure does not affect chat — user sees no error.
- Extraction does not run for General topic conversations.

---

## Task 2: Candidate Pool Panel (Tree Panel Top Section)

### What It Does

The right panel (currently showing "Phase 2" placeholder) becomes the Truth Panel.
At the top of the Truth Panel, a Candidate Pool shows pending candidates.

### Steps

1. Create `components/candidate-pool.tsx`:
   - Subscribes to Supabase Realtime on `candidate_decisions` where `topic_id = current topic` and `status = 'pending'`.
   - Renders each candidate as a card:
     - Title (bold)
     - Content (truncated to 2 lines, expandable)
     - Kind badge (color-coded)
     - Checkbox (checked by default, matching `pre_selected` field)
   - Two action buttons at the bottom of the pool:
     - **"Confirm Selected"**: accepts all checked candidates (batch operation).
     - **"Dismiss All"**: rejects all pending candidates.

2. Implement `confirmCandidates(candidateIds[])` in `lib/candidate-actions.ts`:
   - For each accepted candidate, in a single transaction:
     - INSERT into `decisions` (copy proposed_* fields, set status='active').
     - If `suggested_edges` contains supersedes entries: INSERT edges + UPDATE target decision status to 'superseded'.
     - UPDATE `candidate_decisions` set status='accepted', resolved_decision_id, resolved_at.
     - INSERT `decision_log` entries (action='created', and 'superseded' if applicable).
   - For each rejected candidate (unchecked):
     - UPDATE `candidate_decisions` set status='rejected', resolved_at.
     - INSERT `decision_log` (action='candidate_rejected').

3. Implement `dismissAllCandidates(topicId)` in the same file:
   - Sets all pending candidates for the topic to status='rejected'.
   - Inserts decision_log entries for each.

### Acceptance

- Candidates appear in the right panel within seconds of extraction completing.
- User can uncheck candidates they don't want, then click "Confirm Selected".
- Confirmed candidates appear as decision nodes in the tree (Task 3).
- Dismissed candidates disappear and don't return.

---

## Task 3: Decision Tree Panel (Tree Panel Bottom Section)

### What It Does

Below the candidate pool, the Truth Panel shows confirmed decisions as a tree.

### Steps

1. Create `components/decision-tree.tsx`:
   - Reads confirmed decisions for the current topic from Supabase.
   - Two view modes, toggled by a segmented control at the top:
     - **By Type**: decisions grouped under collapsible headers by `kind` (Goal, Constraint, Plan, etc.). Within each group, newest first.
     - **By Relation**: tree structure starting from anchor decisions as roots, with depends_on/supersedes edges forming parent-child relationships.
   - Each node shows: title, kind badge, status badge (active=green, superseded=gray).
   - Superseded nodes are dimmed. A toggle in the toolbar shows/hides them.
   - Clicking a node opens the Detail Panel (Task 4).

2. The tree panel uses Supabase Realtime to update when new decisions are confirmed (i.e., when Task 2's confirm action writes new rows).

### Acceptance

- After confirming candidates, new decisions appear in the tree without page refresh.
- Both view modes (by-type, by-relation) render correctly.
- Superseded nodes appear dimmed and can be toggled hidden.
- Clicking a node opens the detail panel.

---

## Task 4: Node Detail Panel

### What It Does

When a tree node is clicked, a detail panel slides open (or expands) showing full information.

### Steps

1. Create `components/decision-detail.tsx`:
   - Slides in from the right or replaces the tree view (pick whichever the existing panel width supports — 360px is tight for both tree + detail side by side, so overlay/replace is likely better).

2. Four sections:

   **Section 1: Top Summary**
   - `title` (large text)
   - `content` (full text, scrollable if long)
   - `kind` badge
   - `status` badge

   **Section 2: Because (Rationale & Source)**
   - `rationale` text
   - "View source message" link — clicking scrolls the chat to the original message (using `created_from_message_id`). If the message is in a previous conversation segment, show "Source conversation archived" instead.
   - Confirmed timestamp (from decision_log where action='created').

   **Section 3: Relations**
   - List of connected decisions:
     - Outgoing: "supersedes [Decision Title]", "depends on [Decision Title]"
     - Incoming: "superseded by [Decision Title]", "depended on by [Decision Title]"
   - Each relation is clickable — navigates to that decision's detail panel.

   **Section 4: Actions**
   - **"Bring to sandbox"** button: reads `relevant_message_ids` from the decision, fetches those messages, and prints them into the chat area as a restored conversation context. The chat input becomes active for the user to continue. (This is a context restoration, not a truth mutation.)
   - **"Reference node"** button: inserts a formatted quote block into the current chat input at cursor position. Format: `> [Decision: {title}] {content}`. Does not send — just inserts into the draft.

3. A close button (X) in the top-right returns to the tree view.

### Acceptance

- Clicking a tree node shows all four sections with correct data.
- "View source message" scrolls to the correct message in chat.
- "Bring to sandbox" restores conversation context in the chat area.
- "Reference node" inserts formatted text into the chat input without sending.
- Close button returns to the tree view.

---

## Task 5: Context Injection

### What It Does

Before each user message is sent to the AI model, Zeno injects relevant confirmed decisions into the system prompt so the model is aware of the project's decision state.

### Steps

1. Create `lib/context-assembly.ts`:
   - Export `async function assembleContext(topicId, projectId): string`.
   - Queries confirmed decisions for the topic.
   - Serializes them using `serializeDecisionGraph()`.
   - Returns a formatted string block to prepend to the system prompt.
   - Hard budget: the injected context must not exceed 5000 tokens. If the serialized graph exceeds this:
     - Always include anchor decisions.
     - Always include decisions in the depends_on chain of anchor decisions.
     - Include key decisions, newest first.
     - Include normal decisions, newest first, truncating to fit.
     - Never include candidates.

2. Modify the chat API route:
   - Before calling the AI model, call `assembleContext()`.
   - Prepend the result to the system prompt as a clearly delimited block:
     ```
     <project_decisions>
     {serialized decision graph}
     </project_decisions>
     ```
   - If the topic is General, do NOT inject any decisions.

### Acceptance

- When chatting in a topic with confirmed decisions, the AI model is aware of them.
- Test: confirm a decision "Use PostgreSQL for the database", then ask "What database are we using?" — the model should reference PostgreSQL.
- General topic conversations have no decision injection.
- Context injection stays under 5000 tokens even with 50+ decisions.

---

## Task 6: Inline Candidate Hints (Sandbox)

### What It Does

In the chat area, after an assistant message that triggered extraction, show a subtle hint.

### Steps

1. Create `components/candidate-hint.tsx`:
   - Renders at the bottom of the assistant message that triggered extraction.
   - Text: `+N candidate decisions` in monospace, low contrast.
   - Clicking expands a preview: shows candidate titles + kind badges. No action buttons — perception only. Actions happen in the candidate pool (Task 2).
   - After batch confirm, changes to: `✓ N decisions confirmed` (static, gray, non-interactive).

2. The component listens to Supabase Realtime for candidates linked to the specific message via `message_id`.

### Acceptance

- After assistant responds, within seconds a subtle "+N candidate decisions" hint appears.
- Clicking shows candidate previews inline.
- After confirming in the pool, hint changes to confirmed state.

---

## Phase 2 Definition of Done

The complete decision loop works end-to-end:

1. User sends message → AI responds (streaming) → extraction runs async → candidates appear in pool + inline hint.
2. User reviews candidates in pool → confirms selected → decisions appear in tree.
3. User clicks a tree node → detail panel shows full info → can "bring to sandbox" or "reference node".
4. On next message, confirmed decisions are injected into context → AI is aware of project state.
5. Supersession works: new decision can supersede old one, old one appears dimmed in tree.

**No regressions from Phase 1**: auth, layout, streaming, model selection all still work.
