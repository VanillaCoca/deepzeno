alter table public.decisions
  add column if not exists code_anchors jsonb;

comment on column public.decisions.code_anchors is
  'Array of code locations this decision references. Schema: [{ repo?: string, file: string, line_start?: int, line_end?: int, commit_sha?: string, captured_at: timestamptz }]. Populated by external agents at write time. V1 stores only; V1.5 verifies against GitHub.';

comment on column public.decisions.status is
  'One of: active, archived, superseded. Set by app logic; no DB-level enum.';

alter table public.candidate_decisions
  add column if not exists proposed_for_decision_id uuid references public.decisions(id),
  add column if not exists proposed_status text,
  add column if not exists proposed_intent text;

comment on column public.candidate_decisions.proposed_for_decision_id is
  'Existing decision targeted by an agent candidate update, archive, or supersede operation.';

comment on column public.candidate_decisions.proposed_status is
  'Status proposed by an agent candidate operation, for example archived.';

comment on column public.candidate_decisions.proposed_intent is
  'One of: create, update, archive, supersede. Used by candidate confirmation flow.';

create index if not exists decision_log_actor_created_idx
  on public.decision_log (actor_type, created_at desc);

create index if not exists candidate_decisions_proposed_for_idx
  on public.candidate_decisions (proposed_for_decision_id)
  where proposed_for_decision_id is not null;
