-- L1 Kickoff: project-creation seeding lands IR nodes with a fifth source
-- layer. Keep this list in sync with irSourceLayers in lib/ir/types.ts.
alter table public.ir_nodes
  drop constraint if exists ir_nodes_source_layer_check;

alter table public.ir_nodes
  add constraint ir_nodes_source_layer_check
  check (source_layer in ('inline', 'sweep', 'manual', 'mcp', 'kickoff'));
