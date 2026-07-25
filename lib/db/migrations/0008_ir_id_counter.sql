-- Move IR id allocation from the application into the database.
--
-- Why this exists. `getNextIRId` used to mint ids in JavaScript:
--
--   select id from ir_nodes where id like 'D%'   -- then max(...)+1 in JS
--
-- That is wrong twice over, and on 2026-07-25 both ways of being wrong showed
-- up in production at once.
--
-- First, it is a read-then-write with nothing holding the gap. Two concurrent
-- creations read the same max and mint the same id; one of them loses.
--
-- Second — and this is what actually broke — the read is silently truncated.
-- PostgREST caps an unbounded select at `db-max-rows`, which is 1000 on
-- Supabase. Once a prefix crossed a thousand nodes the scan stopped seeing the
-- tail of the table, so the "max" it computed was not the max. In run
-- c28eb7d3 it computed 1899 while D2325 already existed, minted D1900, and the
-- insert died with 23505. That is not an occasional race: the truncated window
-- is stable, so it returns the same dead id on every call. Every decision node
-- creation was failing, and would have kept failing.
--
-- What it cost: the research pipeline catches the insert error per candidate,
-- counts it, and moves on. So a finding the run actually produced ("将「北极星
-- 指标」与「壁垒定位」送回沙盒重审") never reached the Judgment Inbox, and the
-- only evidence anywhere was one warn line in the function log. Iron Law 2 is
-- about preferring to miss over making things up; it is not a licence to miss
-- silently.
--
-- The fix is to stop deriving the next id from the data and start storing it.
-- A counter row per prefix, incremented inside a single statement, cannot
-- interleave with itself and does not care how many rows the table has.
--
-- Why a counter table rather than ten native sequences: prefixes come from
-- PREFIX_MAP in lib/ir/types.ts and that map grows. A new kind must not
-- require DDL — `next_ir_id('W')` on an unknown prefix should just work. An
-- upsert gives that for free; `CREATE SEQUENCE` from inside a function would
-- need dynamic DDL and a privilege the runtime should not have.

CREATE TABLE IF NOT EXISTS "ir_id_counter" (
  "prefix" text PRIMARY KEY,
  "last_value" bigint NOT NULL
);
--> statement-breakpoint

-- Nobody but the service role has any business here. Enabling RLS with no
-- policy is the whole access rule: the admin client bypasses RLS, everything
-- else sees an empty table.
ALTER TABLE "ir_id_counter" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Seed from what already exists. `last_value` is the highest id in use, so the
-- first allocation returns max+1. GREATEST on conflict makes this statement
-- safe to re-run: re-seeding can only move a counter forward.
INSERT INTO "ir_id_counter" ("prefix", "last_value")
SELECT parsed.prefix, MAX(parsed.num)
FROM (
  SELECT
    substring(id from '^[A-Z]+') AS prefix,
    (substring(id from '[0-9]+$'))::bigint AS num
  FROM "ir_nodes"
  WHERE id ~ '^[A-Z]+[0-9]+$'
) AS parsed
GROUP BY parsed.prefix
ON CONFLICT ("prefix") DO UPDATE
  SET "last_value" = GREATEST("ir_id_counter"."last_value", EXCLUDED."last_value");
--> statement-breakpoint

-- Allocate the next id for a prefix.
--
-- The INSERT ... ON CONFLICT DO UPDATE is one statement, so the row lock it
-- takes closes the read-then-write gap that the JS version left open.
--
-- The loop exists because a counter can be behind the data even when the code
-- is right: this schema was hand-built in the SQL editor before the migration
-- folder covered it (see 0007), and a row inserted with a literal id would not
-- move the counter. Rather than trust the seed forever, skip values that are
-- already taken. In the normal case the EXISTS check is one primary-key probe
-- and the loop runs once.
CREATE OR REPLACE FUNCTION "next_ir_id"(p_prefix text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value bigint;
  v_id text;
  v_attempts int := 0;
BEGIN
  IF p_prefix IS NULL OR p_prefix !~ '^[A-Z]+$' THEN
    RAISE EXCEPTION 'next_ir_id: invalid prefix %', p_prefix;
  END IF;

  LOOP
    INSERT INTO ir_id_counter (prefix, last_value)
    VALUES (p_prefix, 1)
    ON CONFLICT (prefix) DO UPDATE
      SET last_value = ir_id_counter.last_value + 1
    RETURNING last_value INTO v_value;

    v_id := p_prefix || v_value::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM ir_nodes WHERE id = v_id);

    -- Bounded so a pathological table cannot spin a connection forever. If
    -- this ever raises, the counter is not merely stale, it is wrong, and
    -- failing loudly beats hunting a hung request.
    v_attempts := v_attempts + 1;
    IF v_attempts > 10000 THEN
      RAISE EXCEPTION 'next_ir_id(%): no free id after % attempts', p_prefix, v_attempts;
    END IF;
  END LOOP;

  RETURN v_id;
END;
$$;
--> statement-breakpoint

-- The function is called only through the Supabase admin client. Browser-side
-- roles have no reason to reach it, and letting them would hand out a free way
-- to inflate every counter.
REVOKE ALL ON FUNCTION "next_ir_id"(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "next_ir_id"(text) FROM anon;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "next_ir_id"(text) FROM authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "next_ir_id"(text) TO service_role;
