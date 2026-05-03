create table if not exists public.chat_session_state (
  chat_session_id uuid primary key references public.conversations(id) on delete cascade,
  reactivation_anchor_id text references public.ir_nodes(id) on delete set null on update cascade,
  reactivation_anchor_set_at_turn integer,
  last_sweep_at_turn integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_session_state_anchor
  on public.chat_session_state(reactivation_anchor_id)
  where reactivation_anchor_id is not null;
