create table if not exists public.ir_extraction_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  node_id text references public.ir_nodes(id) on update cascade,
  edge_id uuid references public.ir_edges(id) on delete set null,
  event text not null,
  layer text not null default 'system',
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ir_extraction_events_project_created
  on public.ir_extraction_events(project_id, created_at desc);

create index if not exists idx_ir_extraction_events_event_created
  on public.ir_extraction_events(event, created_at desc);
