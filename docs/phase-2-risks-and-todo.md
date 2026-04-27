# Phase 2/3 Current Risks and TODO

This note summarizes the current follow-up items after the Phase 2 workspace bridge and Phase 3 interaction polish work.

## Current State

- Workspace state, topic/project navigation, truth panel, candidate confirm/dismiss, decision context injection, and conversation segment navigation are now wired into the existing chat runtime.
- The chat stack still keeps `Chat` / `Message_v2` as the rich-message store, while workspace `messages` are double-written for extraction and source linking.
- Core UX remains intact: full viewport chat, streaming, artifact/tool rendering, model selection, responsive shell, and Supabase auth.
- MCP is now exposed from the main Next app at `/api/mcp`, project-bound API key generation/revoke is available in-app, and agent-sourced (`mcp_agent`) candidates render separately in the chat area and candidate pool.

## Known Risks

### 1. Multi-store writes are server-side but not fully transactional

- User/assistant messages are written to both `Message_v2` and workspace `messages`.
- Candidate confirmation writes to `decisions`, `edges`, `candidate_decisions`, and `decision_log`.
- These writes now go through server-only helpers, but they still do not run inside a single database transaction across all touched stores.
- Result: partial-write edge cases are still possible if a request fails mid-flight.

### 2. Extraction quality depends on provider availability

- The intended extraction path uses Claude Sonnet 4.6 structured output.
- If `ANTHROPIC_API_KEY` is unavailable, the implementation falls back to a lightweight heuristic extractor so the product still functions locally.
- Result: extraction reliability is lower in fallback mode than in the intended Claude-backed mode.

### 3. Realtime updates still need hardening

- The truth panel uses Supabase Realtime, but polling fallback is also enabled because realtime behavior was not fully reliable in the current environment.
- A selection-snapshot guard was added to prevent delayed realtime events from reverting topic selection.
- Result: the app behaves correctly in current smoke tests, but the update path is more defensive than final-form.

### 4. Build-time database verification is still partial

- `pnpm build` passes, but local build skipped DB migrations because `POSTGRES_URL` was not configured in this environment.
- Result: code-level validation is good, but fresh-database execution still needs a direct Postgres-backed validation pass.

### 5. MCP happy-path still needs live end-to-end validation with a real key

- The route compiles, builds, and returns JSON-RPC 401s correctly when auth is missing.
- The hosted Supabase schema now contains `api_keys`, `source_metadata`, and `external_evidence`, so the backend surface should be compatible.
- Result: we still need one real client smoke test (`initialize` → `tools/list` → `submit_candidate`) using an actual generated project key to confirm the end-to-end loop against the production Supabase instance.

## TODO

### Highest Priority

- Move critical multi-table operations to explicit SQL transactions or RPCs:
  - candidate confirm
  - dismiss all candidates
  - project + General topic provisioning
  - clear conversation / create next segment
  - dual-write message persistence if we want stronger guarantees
- Run extraction with Claude Sonnet 4.6 in the intended environment and verify structured output quality against real topic transcripts.
- Run one real MCP smoke test with a generated project key:
  - `initialize`
  - `tools/list`
  - `get_project_context`
  - `submit_candidate`
  - verify candidate pool and top-of-chat agent hint update within seconds

### Product Hardening

- Revisit truth-panel refresh strategy after remote schema/realtime are stable; reduce reliance on polling if possible.
- Add explicit operator visibility for extraction failures or skipped extractions instead of only logging them.
- Consider idempotency guards for confirm/dismiss flows if users double-click or reconnect during mutations.
- Review whether topic switching should cancel or debounce any in-flight workspace refreshes more aggressively.
- Align the implementation with the 2026-04-26 spec update:
  - `open_question` and `rejection` must be treated as first-class kinds throughout extraction, context injection, and tree rendering.
  - tree view must remain active-only, with superseded history living in the detail panel.
  - detail panel semantics should use dialogue-context injection, not source-message restoration.
  - agent-sourced (`mcp_agent`) candidates need distinct rendering in both candidate pool and chat-area hints.
- Next 16 build currently succeeds but logs `cookies()` prerender warnings for workspace API routes during PPR/static generation. This should be hardened before treating production builds as clean.

### Test Coverage

- Add automated coverage for archived-topic readonly behavior.
- Add coverage for `dismiss all candidates`.
- Add coverage for `Reference node` draft insertion.
- Add coverage for `Bring to sandbox` context restoration and source-message scrolling.
- Add coverage for fallback extraction behavior when Anthropic is unavailable.

## Recommended Next Step

If we want the safest Phase 2/3 follow-up, the best next slice is:

1. Run one live MCP client smoke test with a newly generated project key.
2. Convert confirm/dismiss/clear/provision into transactional SQL or RPC paths.
3. Re-test realtime after the end-to-end MCP path is validated.
