# Phase 1: Scaffold + Chat Running

> **Audience**: This file is for Codex to execute. Lixian reviews the output.
> Sean validates the running app.

---

## Context for Codex

You are working inside a fork of `vercel/chatbot` (https://github.com/vercel/chatbot).
This is a Next.js 15 + AI SDK 6 + Drizzle ORM chatbot template.
Your job is to transform it into the Zeno workspace shell — a three-column layout
with a working chat that streams responses from a configurable model.

**Do NOT remove or break existing functionality unless explicitly told to.**
Read the existing codebase structure before making changes.
Pay special attention to `app/`, `components/`, `lib/ai/`, and `lib/db/`.

### CRITICAL: UX Preservation Rule

The `vercel/chatbot` template is a production-grade application that properly fills
the browser viewport, handles responsive resizing, and provides polished streaming
UX (scroll behavior, markdown rendering, input focus management, etc.).

**You must preserve all of these qualities.** Specifically:

1. **The app must remain a full-viewport web application.** It must fill the entire
   browser window — no fixed-size container floating in the middle of the page,
   no visible empty canvas behind the app. Use `h-screen w-screen` or equivalent.
   If the template already does this (it should), do not change that behavior.

2. **Responsive layout**: the app must look correct at any browser size. When you
   add the three-column layout, use responsive breakpoints — collapse sidebar and
   right panel on smaller screens, never break the viewport fill.

3. **Do NOT override the template's existing CSS reset, viewport meta, or body
   styling** unless absolutely necessary for Zeno features. The template's styling
   is tested and correct.

4. **When implementing Zeno features, ADD to the existing component tree rather
   than replacing it.** Wrap, extend, or compose — do not gut and rebuild.

5. **When referencing the old Codex demo (project A) for feature behavior, only
   replicate the FUNCTIONAL requirements.** Do not copy its styling, layout sizing,
   or CSS approach. The old demo has a fixed-size window that does not fill the
   viewport — this is a bug, not a feature. The vercel/chatbot template's layout
   behavior is the correct baseline.

---

## Task 1: Replace Auth with Supabase Auth

The template uses NextAuth or Vercel's built-in auth. Replace it with Supabase Auth.

### Steps

1. Install `@supabase/supabase-js` and `@supabase/ssr`.
2. Remove any NextAuth / auth.js configuration files and dependencies.
3. Create `lib/supabase/client.ts` (browser client) and `lib/supabase/server.ts` (server client using cookies).
4. Create `middleware.ts` that refreshes the Supabase session on every request.
5. Create `/login` page with email + password sign-in form. Keep it simple — no OAuth in Phase 1.
6. Protect all `/chat` routes: redirect to `/login` if no session.
7. Add environment variables to `.env.example`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   ```

### Acceptance

- User can sign up with email + password.
- User can log in and is redirected to the main workspace.
- Unauthenticated users are redirected to `/login`.
- Session persists across page refreshes.

---

## Task 2: Three-Column Workspace Layout

Transform the single-column chat layout into a three-column workspace.

### Target Layout

```
┌──────────────┬─────────────────────────┬──────────────────────┐
│              │                         │                      │
│   Sidebar    │       Sandbox           │    Truth Panel       │
│   (240px)    │     (flex-grow)         │     (360px)          │
│              │                         │                      │
│  - Projects  │   Chat messages area    │   Placeholder:       │
│  - Topics    │   + input box           │   "Truth panel       │
│              │                         │    coming in          │
│              │                         │    Phase 2"           │
│              │                         │                      │
└──────────────┴─────────────────────────┴──────────────────────┘
```

### Steps

1. Create `components/workspace-shell.tsx`:
   - CSS Grid or Flexbox, three columns.
   - Left sidebar: fixed 240px width, collapsible.
   - Center: flex-grow, contains the chat (sandbox).
   - Right panel: fixed 360px width. For Phase 1, render a static placeholder div with gray background and text "Truth Panel — Phase 2".
   - The right panel should be hideable via a toggle button.

2. Create `components/project-sidebar.tsx`:
   - For Phase 1, this is a minimal sidebar showing:
     - A "Projects" header.
     - A hardcoded project name "My Project" (no CRUD yet).
     - Below it, a "Topics" section with a hardcoded "General" topic, shown as selected.
   - Styling: dark background, light text, matching the template's existing dark theme.

3. Modify the main chat page (`app/(chat)/page.tsx` or equivalent) to use `workspace-shell.tsx` as the wrapper instead of the existing layout.

4. **Keep the existing chat component intact.** The center column should render the template's existing chat UI (messages list + input) without modification to its streaming logic.

### Acceptance

- App loads with three-column layout.
- Chat works exactly as before (streaming, message display) in the center column.
- Sidebar shows on the left with placeholder content.
- Right panel shows placeholder text.
- Layout is responsive: on screens < 1024px, sidebar and right panel collapse or hide.

---

## Task 3: Model Provider Configuration

The template uses Vercel AI Gateway by default. We need the ability to use models via direct API keys as well (for dev and self-hosted scenarios).

### Steps

1. In `lib/ai/models.ts` (or wherever models are configured), add support for:
   - Anthropic Claude Sonnet 4.6 via `@ai-sdk/anthropic`
   - OpenAI GPT-4.1 via `@ai-sdk/openai`
   - Keep existing AI Gateway support as an option.

2. Install `@ai-sdk/anthropic` and `@ai-sdk/openai` as dependencies.

3. Add to `.env.example`:
   ```
   ANTHROPIC_API_KEY=
   OPENAI_API_KEY=
   ```

4. The chat API route should use the model specified by the user's selection in the UI. If the template already has a model selector, extend it to include the new models. If not, add a simple dropdown above the chat input.

### Acceptance

- User can select Claude Sonnet 4.6 or GPT-4.1 from a dropdown.
- Streaming works correctly with both providers.
- Model selection persists during the session.

---

## Task 4: Supabase Database — Foundation Tables

Create the initial Supabase migration for Zeno's core tables. These will be used in Phase 2, but the schema must exist now.

### Steps

1. Create a `supabase/` directory with migration files.
2. If the template uses Drizzle ORM, also define the schema in Drizzle format for type safety. Otherwise, raw SQL migrations are fine.

3. Create migration for these tables (in order):

```sql
-- projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- topics
CREATE TABLE topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_general BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- conversations (invisible internal containers for sandbox)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- decisions
CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  topic_id UUID NOT NULL REFERENCES topics(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  rationale TEXT,
  kind TEXT NOT NULL DEFAULT 'plan',
  weight TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  relevant_message_ids UUID[],
  created_from_message_id UUID REFERENCES messages(id),
  confirmed_by_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- edges
CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  topic_id UUID NOT NULL REFERENCES topics(id),
  source_decision_id UUID NOT NULL REFERENCES decisions(id),
  target_decision_id UUID NOT NULL REFERENCES decisions(id),
  type TEXT NOT NULL, -- 'supersedes' | 'depends_on'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- candidate_decisions
CREATE TABLE candidate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  topic_id UUID NOT NULL REFERENCES topics(id),
  conversation_id UUID REFERENCES conversations(id),
  message_id UUID REFERENCES messages(id),
  proposed_title TEXT,
  proposed_content TEXT NOT NULL,
  proposed_rationale TEXT,
  proposed_kind TEXT DEFAULT 'plan',
  proposed_weight TEXT DEFAULT 'normal',
  confidence REAL,
  pre_selected BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending',
  suggested_edges JSONB,
  relevant_message_ids UUID[],
  content_hash TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_decision_id UUID REFERENCES decisions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- decision_log (append-only)
CREATE TABLE decision_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID REFERENCES decisions(id),
  candidate_id UUID REFERENCES candidate_decisions(id),
  action TEXT NOT NULL, -- 'created' | 'superseded' | 'candidate_rejected'
  actor_type TEXT NOT NULL DEFAULT 'user',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

4. Add RLS policies:
   - All tables: users can only read/write rows where `project_id` belongs to a project they own.
   - `decision_log`: no UPDATE or DELETE allowed (append-only guard).

5. Enable Supabase Realtime on `candidate_decisions` table.

### Acceptance

- All migrations run without errors on a fresh Supabase project.
- RLS policies are active and tested (query as authenticated user returns only own data).
- `decision_log` rejects UPDATE and DELETE operations.

---

## Phase 1 Definition of Done

All four tasks complete. The running app shows:

1. Supabase login → three-column workspace → working streaming chat.
2. Model selector allows switching between Claude and GPT.
3. Database schema exists and is accessible (even though the UI doesn't use decisions/candidates yet).
4. No regressions: the original template's chat quality (streaming smoothness, scroll behavior, markdown rendering) is preserved or improved.

---

## Files You Should NOT Delete

These files from the original template contain important patterns. Read them before modifying:

- `app/api/chat/route.ts` — the streaming API route. Modify, don't replace.
- `lib/ai/` — model configuration and prompt logic. Extend, don't rewrite.
- `components/` — UI components. Modify layout wrappers, keep chat internals.
- `lib/db/` — database layer (if Drizzle). Extend with new tables.
