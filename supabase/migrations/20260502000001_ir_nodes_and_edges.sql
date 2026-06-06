create table if not exists public.ir_nodes (
  id text primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,

  kind text not null check (kind in (
    'goal',
    'constraint',
    'plan',
    'hypothesis',
    'principle',
    'open_question',
    'rejection',
    'unclassified'
  )),
  subtype text check (
    (kind = 'plan' and subtype in ('decision', 'task', 'milestone'))
    or (kind != 'plan' and subtype is null)
  ),
  status text not null check (status in (
    'idea',
    'pending',
    'active',
    'superseded',
    'dismissed'
  )),

  title text not null check (length(title) <= 200),
  content text,
  rationale text,
  sensitivity text not null default 'normal'
    check (sensitivity in ('normal', 'vault')),

  source_chat_id uuid,
  source_turn_id uuid,
  source_text_span text,
  source_layer text check (source_layer in ('inline', 'sweep', 'manual', 'mcp')),

  reactivation_anchor_id text references public.ir_nodes(id) on update cascade,
  extraction_confidence numeric,

  created_at timestamptz not null default now(),
  promoted_to_pending_at timestamptz,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  superseded_by text references public.ir_nodes(id) on update cascade,

  created_by text not null check (created_by in ('ai', 'user', 'mcp')),
  confirmed_by uuid references auth.users(id)
);

create table if not exists public.ir_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_node text not null references public.ir_nodes(id) on update cascade,
  to_node text not null references public.ir_nodes(id) on update cascade,
  relation text not null check (relation in (
    'supersedes',
    'resolves',
    'depends_on',
    'implies',
    'contradicts',
    'refines'
  )),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'dismissed')),
  is_anchor_hint boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,

  constraint ir_edges_no_self_loop check (from_node != to_node),
  constraint ir_edges_unique_relation unique (from_node, to_node, relation)
);

create index if not exists idx_ir_nodes_project_status
  on public.ir_nodes(project_id, status);

create index if not exists idx_ir_nodes_topic
  on public.ir_nodes(topic_id)
  where topic_id is not null;

create index if not exists idx_ir_nodes_pending
  on public.ir_nodes(project_id, created_at desc)
  where status = 'pending';

create index if not exists idx_ir_nodes_idea
  on public.ir_nodes(project_id, created_at desc)
  where status = 'idea';

create index if not exists idx_ir_nodes_active
  on public.ir_nodes(project_id, kind)
  where status = 'active';

create index if not exists idx_ir_nodes_lifecycle
  on public.ir_nodes(project_id, confirmed_at, superseded_at);

create index if not exists idx_ir_edges_from
  on public.ir_edges(from_node);

create index if not exists idx_ir_edges_to
  on public.ir_edges(to_node);

create index if not exists idx_ir_edges_active
  on public.ir_edges(project_id)
  where status = 'active';
