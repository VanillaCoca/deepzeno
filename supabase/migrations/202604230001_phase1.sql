create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_decision_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'decision_log is append-only';
end;
$$;

create or replace function public.owns_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects
    where id = target_project_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_access_decision_log(
  target_decision_id uuid,
  target_candidate_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.decisions d
    join public.projects p on p.id = d.project_id
    where d.id = target_decision_id
      and p.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.candidate_decisions c
    join public.projects p on p.id = c.project_id
    where c.id = target_candidate_id
      and p.user_id = auth.uid()
  );
$$;

grant execute on function public.owns_project(uuid) to authenticated;
grant execute on function public.can_access_decision_log(uuid, uuid) to authenticated;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  is_general boolean not null default false,
  archived_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  topic_id uuid not null references public.topics(id),
  project_id uuid not null references public.projects(id),
  role text not null,
  content text not null,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  topic_id uuid not null references public.topics(id),
  title text not null,
  content text not null,
  rationale text,
  kind text not null default 'plan',
  weight text not null default 'normal',
  status text not null default 'active',
  sensitivity text not null default 'normal',
  relevant_message_ids uuid[],
  created_from_message_id uuid references public.messages(id),
  confirmed_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  topic_id uuid not null references public.topics(id),
  source_decision_id uuid not null references public.decisions(id),
  target_decision_id uuid not null references public.decisions(id),
  type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  topic_id uuid not null references public.topics(id),
  conversation_id uuid references public.conversations(id),
  message_id uuid references public.messages(id),
  proposed_title text,
  proposed_content text not null,
  proposed_rationale text,
  proposed_kind text default 'plan',
  proposed_weight text default 'normal',
  confidence real,
  pre_selected boolean not null default true,
  status text not null default 'pending',
  suggested_edges jsonb,
  relevant_message_ids uuid[],
  content_hash text,
  resolved_at timestamptz,
  resolved_decision_id uuid references public.decisions(id),
  source text not null default 'zeno_extraction',
  source_metadata jsonb,
  external_evidence text,
  created_at timestamptz not null default now()
);

create table if not exists public.decision_log (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid references public.decisions(id),
  candidate_id uuid references public.candidate_decisions(id),
  action text not null,
  actor_type text not null default 'user',
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  label text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.candidate_decisions
  add column if not exists source text not null default 'zeno_extraction',
  add column if not exists source_metadata jsonb,
  add column if not exists external_evidence text;

create index if not exists projects_user_id_idx
  on public.projects (user_id);

create index if not exists topics_project_position_idx
  on public.topics (project_id, position);

create index if not exists conversations_project_created_idx
  on public.conversations (project_id, created_at desc);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at asc);

create index if not exists decisions_project_topic_idx
  on public.decisions (project_id, topic_id);

create index if not exists candidate_decisions_topic_status_idx
  on public.candidate_decisions (topic_id, status);

create index if not exists decision_log_decision_created_idx
  on public.decision_log (decision_id, created_at desc);

create index if not exists api_keys_project_active_idx
  on public.api_keys (project_id)
  where revoked_at is null;

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

drop trigger if exists set_decisions_updated_at on public.decisions;
create trigger set_decisions_updated_at
before update on public.decisions
for each row
execute function public.set_updated_at();

alter table public.projects enable row level security;
alter table public.topics enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.decisions enable row level security;
alter table public.edges enable row level security;
alter table public.candidate_decisions enable row level security;
alter table public.decision_log enable row level security;
alter table public.api_keys enable row level security;

alter table public.projects force row level security;
alter table public.topics force row level security;
alter table public.conversations force row level security;
alter table public.messages force row level security;
alter table public.decisions force row level security;
alter table public.edges force row level security;
alter table public.candidate_decisions force row level security;
alter table public.decision_log force row level security;
alter table public.api_keys force row level security;

drop policy if exists "projects_owner_all" on public.projects;
create policy "projects_owner_all"
on public.projects
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "topics_owner_all" on public.topics;
create policy "topics_owner_all"
on public.topics
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));

drop policy if exists "conversations_owner_all" on public.conversations;
create policy "conversations_owner_all"
on public.conversations
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));

drop policy if exists "messages_owner_all" on public.messages;
create policy "messages_owner_all"
on public.messages
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));

drop policy if exists "decisions_owner_all" on public.decisions;
create policy "decisions_owner_all"
on public.decisions
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));

drop policy if exists "edges_owner_all" on public.edges;
create policy "edges_owner_all"
on public.edges
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));

drop policy if exists "candidate_decisions_owner_all" on public.candidate_decisions;
create policy "candidate_decisions_owner_all"
on public.candidate_decisions
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));

drop policy if exists "decision_log_select_owned" on public.decision_log;
create policy "decision_log_select_owned"
on public.decision_log
for select
to authenticated
using (public.can_access_decision_log(decision_id, candidate_id));

drop policy if exists "decision_log_insert_owned" on public.decision_log;
create policy "decision_log_insert_owned"
on public.decision_log
for insert
to authenticated
with check (public.can_access_decision_log(decision_id, candidate_id));

drop policy if exists "api_keys_owner_all" on public.api_keys;
create policy "api_keys_owner_all"
on public.api_keys
for all
to authenticated
using (auth.uid() = user_id and public.owns_project(project_id))
with check (auth.uid() = user_id and public.owns_project(project_id));

revoke update, delete on public.decision_log from anon, authenticated;

drop trigger if exists prevent_decision_log_update on public.decision_log;
create trigger prevent_decision_log_update
before update on public.decision_log
for each row
execute function public.prevent_decision_log_mutation();

drop trigger if exists prevent_decision_log_delete on public.decision_log;
create trigger prevent_decision_log_delete
before delete on public.decision_log
for each row
execute function public.prevent_decision_log_mutation();

alter table public.candidate_decisions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'candidate_decisions'
  ) then
    alter publication supabase_realtime add table public.candidate_decisions;
  end if;
end
$$;
