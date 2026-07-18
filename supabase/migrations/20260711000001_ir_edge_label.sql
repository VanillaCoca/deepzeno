-- Free-form, AI-written description of how two IR nodes relate, shown on the
-- truth-graph reasoning chain (components/ir/truth-graph). Structural direction
-- still comes from `relation`; `label` is only its human-readable annotation.
-- Nullable: edges created before this (or when the model returns none) fall
-- back to the relation-type phrase in the UI. Capped to keep chain rows short.

alter table public.ir_edges
  add column if not exists label text
  check (label is null or length(label) <= 80);
