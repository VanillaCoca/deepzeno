create or replace function public.validate_ir_node_status_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'idea' and new.status in ('pending', 'dismissed') then
    return new;
  end if;

  if old.status = 'pending' and new.status in ('active', 'dismissed') then
    return new;
  end if;

  if old.status = 'active' and new.status = 'superseded' then
    return new;
  end if;

  raise exception 'invalid ir_node status transition: % -> %', old.status, new.status;
end;
$$;

create or replace function public.validate_ir_edge_status_transition()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if old.status = 'pending' and new.status in ('active', 'dismissed') then
    return new;
  end if;

  raise exception 'invalid ir_edge status transition: % -> %', old.status, new.status;
end;
$$;

drop trigger if exists trg_ir_node_status_transition on public.ir_nodes;
create trigger trg_ir_node_status_transition
before update on public.ir_nodes
for each row
execute function public.validate_ir_node_status_transition();

drop trigger if exists trg_ir_edge_status_transition on public.ir_edges;
create trigger trg_ir_edge_status_transition
before update on public.ir_edges
for each row
execute function public.validate_ir_edge_status_transition();
