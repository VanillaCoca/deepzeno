-- L2 Research Brief: research runs and quote-verified evidence (spec
-- 2026-06-10-research-engine-l1-l2-design.md, Component 2). Evidence is a
-- first-class citizen anchored to ir_nodes (constitution E2 — no floating
-- evidence). Also admits the 'research' source layer for ir_nodes.

alter table public.ir_nodes
  drop constraint if exists ir_nodes_source_layer_check;

alter table public.ir_nodes
  add constraint ir_nodes_source_layer_check
  check (source_layer in ('inline', 'sweep', 'manual', 'mcp', 'kickoff', 'research'));

create table public.research_run (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  topic_id uuid references public.topics (id) on delete set null,
  origin_node_id text not null references public.ir_nodes (id),
  plan jsonb,
  brief text,
  status text not null default 'running'
    check (status in ('running', 'done', 'partial', 'failed')),
  error text,
  budget jsonb,
  cost_estimate real,
  models_used jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  run_id uuid not null references public.research_run (id) on delete cascade,
  node_id text not null references public.ir_nodes (id),
  url text not null,
  title text,
  quote text not null,
  claim text not null,
  stance text not null check (stance in ('supports', 'contradicts', 'neutral')),
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index research_run_origin_idx
  on public.research_run (origin_node_id, created_at desc);
create index research_run_project_idx
  on public.research_run (project_id, created_at desc);
create index evidence_node_idx
  on public.evidence (node_id, created_at desc);
create index evidence_run_idx on public.evidence (run_id);

alter table public.research_run enable row level security;
alter table public.research_run force row level security;
alter table public.evidence enable row level security;
alter table public.evidence force row level security;

create policy research_run_owner_read on public.research_run
  for select using (public.owns_project(project_id));
create policy evidence_owner_read on public.evidence
  for select using (public.owns_project(project_id));
