alter table public.topics
  add column if not exists default_model_id text;

create table if not exists public.project_user_view_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists project_user_view_state_project_idx
  on public.project_user_view_state(project_id);

alter table public.project_user_view_state enable row level security;
alter table public.project_user_view_state force row level security;

drop policy if exists "project_user_view_state_owner_all"
on public.project_user_view_state;

create policy "project_user_view_state_owner_all"
on public.project_user_view_state
for all
to authenticated
using (auth.uid() = user_id and public.owns_project(project_id))
with check (auth.uid() = user_id and public.owns_project(project_id));
