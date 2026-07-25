-- Run visibility: research_run becomes the record of every long agent run,
-- not just node-originated research.
--
-- (Hand-trimmed from the generated full-schema migration to a minimal,
-- idempotent delta, following 0005. drizzle's snapshot has drifted from the
-- deployed database, so the generated file re-emits CREATE TABLE for tables
-- that already exist — and those no-op, which would silently swallow the two
-- statements below. The delta is what actually has to run.)

-- The in-flight checkpoint the activity bar reads: phase, budget spent,
-- running cost, checkpoint timestamp. Shape lives in
-- lib/research/run-progress-core.ts.
ALTER TABLE "research_run" ADD COLUMN IF NOT EXISTS "progress" jsonb;--> statement-breakpoint

-- Sweep runs extract from a conversation and have no originating IR node.
-- Without this, sweep can't have a run row at all, and it is currently the
-- least visible operation in the product.
ALTER TABLE "research_run" ALTER COLUMN "origin_node_id" DROP NOT NULL;--> statement-breakpoint

-- Present in schema.ts but never carried by a numbered migration; idempotent
-- so this is a no-op on any database that already has them.
ALTER TABLE "ir_edges" ADD COLUMN IF NOT EXISTS "label" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "agent_settings" jsonb;
