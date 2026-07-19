-- Exploration directions a patrol proposes for its NEXT visit — the
-- "human-like research angles" surfaced in the hypothesis detail board
-- (即将探索的方向). Written by the patrol engine after each run; read by
-- GET /api/watchtower via the watch row. Nullable jsonb:
--   [{ "query": "...", "goal": "..." }, ...]  (2-4 entries)
-- Pre-migration databases degrade gracefully: mapWatch parses missing /
-- malformed values to null and the patrol's write failure is swallowed.

alter table public.ir_watches
  add column if not exists next_directions jsonb;
