alter table public.ir_nodes
add column if not exists import_session_id uuid;

create index if not exists idx_ir_nodes_import_session
on public.ir_nodes(import_session_id)
where import_session_id is not null;
