alter table public.topics
  add column if not exists status text not null default 'exploring',
  add column if not exists description text,
  add column if not exists decided_at timestamptz,
  add column if not exists executing_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists dismissed_at timestamptz;

do $$
begin
  alter table public.topics
    add constraint topics_status_check
    check (status in (
      'exploring',
      'converging',
      'decided',
      'executing',
      'superseded',
      'dismissed'
    ));
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.topic_relations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  from_topic_id uuid not null references public.topics(id) on delete cascade,
  to_topic_id uuid not null references public.topics(id) on delete cascade,
  relation_type text not null check (relation_type in (
    'supersedes',
    'revisits',
    'depends_on',
    'contradicts'
  )),
  created_at timestamptz not null default now(),

  constraint topic_relations_no_self_loop check (from_topic_id <> to_topic_id)
);

create unique index if not exists topic_relations_unique_relation
  on public.topic_relations(from_topic_id, to_topic_id, relation_type);

create index if not exists topics_project_status_idx
  on public.topics(project_id, status);

create index if not exists topic_relations_project_idx
  on public.topic_relations(project_id, created_at);

create index if not exists topic_relations_to_topic_idx
  on public.topic_relations(to_topic_id);

alter table public.topic_relations enable row level security;
alter table public.topic_relations force row level security;

drop policy if exists "topic_relations_owner_all" on public.topic_relations;
create policy "topic_relations_owner_all"
on public.topic_relations
for all
to authenticated
using (public.owns_project(project_id))
with check (public.owns_project(project_id));
