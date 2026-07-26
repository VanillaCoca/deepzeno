-- Consecutive patrols that found nothing, per watch.
--
-- Why a counter and not a second cadence column: `cadence` is the promise the
-- user picked, and it must survive being backed off. Deriving the interval
-- from (cadence, quiet_patrols) means a single signal restores the promise
-- exactly, with nothing to remember and nothing to drift.
--
-- Reset to 0 on any signal, and on any human re-assertion of the cadence.
-- Deliberately NOT touched by a failed patrol: a patrol that threw is evidence
-- about the product, not about the world, and letting it accumulate backoff
-- would let one dead API key quietly demote a watch to monthly.
--
-- Pre-migration databases degrade to "no backoff": mapWatch reads a missing
-- column as 0, which is exactly the old behaviour.

alter table public.ir_watches
  add column if not exists quiet_patrols integer not null default 0;
