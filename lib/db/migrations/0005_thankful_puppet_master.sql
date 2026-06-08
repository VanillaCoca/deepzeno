-- Sub-nodes: optional self-referencing hierarchy on ir_nodes.
-- (Hand-trimmed from the generated full-schema migration to a minimal,
-- idempotent delta so it applies cleanly to the existing database.)
ALTER TABLE "ir_nodes" ADD COLUMN IF NOT EXISTS "parent_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ir_nodes" ADD CONSTRAINT "ir_nodes_parent_id_ir_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ir_nodes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
