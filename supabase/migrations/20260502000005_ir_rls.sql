alter table public.ir_nodes enable row level security;
alter table public.ir_edges enable row level security;
alter table public.ir_extraction_events enable row level security;
alter table public.chat_session_state enable row level security;

alter table public.ir_nodes force row level security;
alter table public.ir_edges force row level security;
alter table public.ir_extraction_events force row level security;
alter table public.chat_session_state force row level security;

drop policy if exists "ir_nodes_owner_read" on public.ir_nodes;
create policy "ir_nodes_owner_read"
on public.ir_nodes
for select
to authenticated
using (public.owns_project(project_id));

drop policy if exists "ir_edges_owner_read" on public.ir_edges;
create policy "ir_edges_owner_read"
on public.ir_edges
for select
to authenticated
using (public.owns_project(project_id));

drop policy if exists "ir_events_owner_read" on public.ir_extraction_events;
create policy "ir_events_owner_read"
on public.ir_extraction_events
for select
to authenticated
using (project_id is not null and public.owns_project(project_id));

drop policy if exists "chat_session_state_owner_read" on public.chat_session_state;
create policy "chat_session_state_owner_read"
on public.chat_session_state
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = chat_session_id
      and public.owns_project(c.project_id)
  )
);
