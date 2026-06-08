-- Automatic conversation compaction checkpoints.
--
-- One row per conversation. Stores a rolling summary of the older turns that
-- have been folded out of the model payload so a long conversation never
-- overflows the model's context window. Only the server (service role) touches
-- this table, so RLS is enabled with no policies (service role bypasses RLS;
-- anon/authenticated get no access).

create table if not exists public.conversation_compaction (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  summary text not null,
  -- The most recent message (by created_at) that is folded INTO the summary.
  -- Everything after it is still sent to the model verbatim.
  compacted_through_message_id uuid not null,
  compacted_through_created_at timestamptz not null,
  summarized_message_count integer not null default 0,
  summary_token_estimate integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversation_compaction_through
  on public.conversation_compaction(compacted_through_created_at);

alter table public.conversation_compaction enable row level security;
