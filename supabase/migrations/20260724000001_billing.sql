-- Cost model V1 (docs/zeno-cost-model-v1.md): the platform funds a small
-- monthly allowance out of the operator's own credits; past that, the user
-- brings their own provider key. Two tables carry the whole model —
-- `usage_ledger` (what was spent, by whom, under whose funding) and
-- `provider_keys` (the user's own credentials, encrypted at rest).
--
-- The decision logic lives in lib/billing/plan-core.ts and lib/billing/
-- cost-core.ts; nothing here encodes a limit, because a limit that lives in a
-- CHECK constraint cannot be raised without a migration and cannot be
-- explained to the user when it bites.

-- ---------------------------------------------------------------------------
-- 1. usage_ledger — append-only spend record.
-- ---------------------------------------------------------------------------
-- Why a separate table rather than summing research_run.cost_estimate:
--
--   a. cost_estimate is nullable by design (an unpriced model reports null,
--      see cost-core.ts). Rationing needs a number that is never null, so the
--      ledger stores `metered_usd` — the conservative charge — alongside the
--      honest, possibly-null `estimate_usd`. Summing the reporting number
--      would make every unpriced run free.
--   b. Chat messages spend money and are not research runs at all.
--   c. research_run rows cascade-delete with their project. A spend record
--      that a user can erase by deleting a project is not a ledger.
--
-- Hence project_id/run_id are `on delete set null`: the money stays recorded
-- after the thing it was spent on is gone.
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  -- auth.users id. No FK: Supabase keeps that table in another schema and a
  -- cascade from it would delete the record of what a deleted account spent.
  user_id uuid not null,
  project_id uuid references public.projects (id) on delete set null,
  run_id uuid references public.research_run (id) on delete set null,
  -- What kind of call this was. Deliberately wider than RUN_TYPES: 'chat' has
  -- no run row, 'kickoff' bills before a project's first run exists, and
  -- 'search' never gets one at all — semantic ranking is a foreground query,
  -- not a run, and folding it into 'chat' would make the one number the
  -- operator needs ("what does a conversation cost me") unreadable.
  kind text not null
    check (
      kind in (
        'chat', 'research', 'patrol', 'sweep', 'kickoff', 'search', 'import'
      )
    ),
  -- Who paid. There is no 'denied' row: a refused call spends nothing, and a
  -- ledger of things that did not happen is a ledger nobody can sum.
  funding_source text not null check (funding_source in ('platform', 'byok')),
  -- 'YYYY-MM' in UTC, from billingPeriodKey(). Denormalized rather than
  -- derived from created_at so the allowance query is a plain index probe on
  -- (user_id, billing_period) instead of a function scan over every row the
  -- user has ever generated.
  billing_period text not null check (billing_period ~ '^\d{4}-\d{2}$'),
  -- Per-model token counts, the ModelsUsedAccumulator shape from cost-core.
  models_used jsonb not null default '{}'::jsonb,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  -- What was charged against the allowance: meterCostUsd().usd. numeric, not
  -- real, because this column exists to be SUMmed — float4 loses cents across
  -- a few thousand sub-cent rows, and the whole point of the table is that the
  -- total is trustworthy.
  metered_usd numeric(12, 6) not null default 0,
  -- What the user is shown: computeCostEstimate(). Null means "we do not know
  -- what this cost", which is a true and useful thing to display; it never
  -- means zero.
  estimate_usd numeric(12, 6),
  -- True when any model was billed at a tier stand-in rate rather than its own
  -- published price, i.e. metered_usd is an upper bound. Lets an operator
  -- tuning the allowance see how much of the burn is guesswork.
  is_estimated boolean not null default false,
  created_at timestamptz not null default now()
);

-- The one hot query: this user's spend this month.
create index usage_ledger_period_idx
  on public.usage_ledger (user_id, billing_period);
-- Operator-side: what did this run cost, and what has this project cost.
create index usage_ledger_run_idx
  on public.usage_ledger (run_id)
  where run_id is not null;
create index usage_ledger_project_idx
  on public.usage_ledger (project_id)
  where project_id is not null;

alter table public.usage_ledger enable row level security;
alter table public.usage_ledger force row level security;

-- Read-only to the owner. Writes go through the service-role client only:
-- a client that can insert its own ledger rows can also insert a -$50 one.
create policy usage_ledger_owner_read on public.usage_ledger
  for select
  to authenticated
  using (user_id = auth.uid());

-- The allowance check runs before every billable call, so it has to be one
-- round trip that returns one number. A function rather than a client-side
-- sum for two reasons: PostgREST caps a select at db-max-rows (1000 here), and
-- a busy month can exceed that — a sum that silently stops at row 1000 is an
-- allowance that silently stops enforcing. And PostgREST's aggregate syntax is
-- gated behind db-aggregates-enabled, which is a deployment setting this
-- migration cannot guarantee.
create or replace function public.usage_spend_usd(
  target_user uuid,
  period text
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(metered_usd), 0)
  from public.usage_ledger
  where user_id = target_user
    and billing_period = period;
$$;

-- Server-side only. It takes a user id as an argument and is security
-- definer, so exposing it to `authenticated` would let any signed-in user read
-- any other user's spend by passing their id. The settings UI gets this number
-- from a server route that already knows whose session it is holding.
revoke all on function public.usage_spend_usd(uuid, text) from public;
revoke all on function public.usage_spend_usd(uuid, text) from anon;
revoke all on function public.usage_spend_usd(uuid, text) from authenticated;
grant execute on function public.usage_spend_usd(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. provider_keys — the user's own API keys, encrypted at rest.
-- ---------------------------------------------------------------------------
-- Ciphertext is AES-256-GCM under ZENO_BYOK_SECRET (lib/billing/crypto.ts),
-- which lives only in the deployment environment. Encrypting in the app rather
-- than relying on at-rest disk encryption is what makes a database dump — or a
-- stolen service-role key, or a mis-scoped PostgREST call — insufficient on
-- its own to read a user's key.
create table public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- Search providers sit in the same list as model providers on purpose:
  -- search fees are the one cost cost-core.ts cannot meter (they are not
  -- token-denominated), which makes them the cost most worth handing over.
  provider text not null check (
    provider in (
      'anthropic',
      'openai',
      'deepseek',
      'openrouter',
      'dashscope',
      'gateway',
      'tavily'
    )
  ),
  ciphertext text not null,
  -- Last four characters of the plaintext key. Enough for the user to confirm
  -- which key is stored; useless to anyone else. Storing a full prefix would
  -- leak the account identifier embedded in some providers' key formats.
  key_hint text not null,
  label text,
  -- 'invalid' is set when the provider rejects the key. It exists so the
  -- system can say "your key stopped working" instead of quietly falling back
  -- to platform funding and draining an allowance the user thought was idle —
  -- Iron Law 2 applies to money as much as to findings.
  status text not null default 'active'
    check (status in ('active', 'invalid')),
  last_error text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One key per provider per user. Replacing a key is an update, not a second
  -- row, so there is never a question of which one is live.
  unique (user_id, provider)
);

create index provider_keys_user_idx on public.provider_keys (user_id);

alter table public.provider_keys enable row level security;
alter table public.provider_keys force row level security;

-- Deliberately NO policy on this table. RLS forced with zero policies denies
-- every role that is not service_role, including the signed-in owner. The
-- settings UI reads provider/key_hint/status through a server route that
-- selects those columns explicitly; there is no path on which a browser holds
-- a ciphertext, so there is no path on which an XSS holds one either.
