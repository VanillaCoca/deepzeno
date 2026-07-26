-- Make the allowance query ask the question the allowance actually asks.
--
-- `20260724000001_billing.sql` created `usage_spend_usd(user, period)` and
-- explained, in its own comment, why the sum has to happen in the database:
-- "PostgREST caps a select at db-max-rows (1000 here) ... a sum that silently
-- stops at row 1000 is an allowance that silently stops enforcing."
--
-- The function was then never called. It sums BOTH funding sources, and the
-- allowance meters only the platform's half — so `getPlatformSpendUsd` was
-- written in the app layer instead, as exactly the client-side 1000-row sum
-- the RPC existed to prevent. Two costs followed: the number can under-report
-- for a user with many cheap rows (the operator then funds spend past the
-- allowance, which is the one thing the cost model exists to stop), and every
-- billable call in the product drags up to a thousand rows across the wire to
-- add them up in JavaScript.
--
-- The root cause is the signature, not the caller: "total spend" was never a
-- question this product asks. So this replaces the function with one that
-- takes the funding source, and drops the old one rather than leaving an
-- uncalled security-definer function as surface area for nothing.

create or replace function public.usage_spend_usd(
  target_user uuid,
  period text,
  source text
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
    and billing_period = period
    and funding_source = source;
$$;

-- Same reasoning as the original: security definer plus a user id argument
-- means any grant beyond service_role lets a signed-in user read anyone
-- else's spend by passing their id.
revoke all on function public.usage_spend_usd(uuid, text, text) from public;
revoke all on function public.usage_spend_usd(uuid, text, text) from anon;
revoke all on function public.usage_spend_usd(uuid, text, text)
  from authenticated;
grant execute on function public.usage_spend_usd(uuid, text, text)
  to service_role;

-- Dropped, not kept as an overload. Two functions with the same name and
-- different arities is a live footgun: a caller that omits the source silently
-- gets the unfiltered total, which reads as "this user is over their
-- allowance" for anyone paying with their own key.
drop function if exists public.usage_spend_usd(uuid, text);
