ALTER TABLE "decisions"
  ADD COLUMN IF NOT EXISTS "code_anchors" jsonb;

COMMENT ON COLUMN "decisions"."code_anchors" IS
  'Array of code locations this decision references. Schema: [{ repo?: string, file: string, line_start?: int, line_end?: int, commit_sha?: string, captured_at: timestamptz }]. Populated by external agents at write time. V1 stores only; V1.5 verifies against GitHub.';

COMMENT ON COLUMN "decisions"."status" IS
  'One of: active, archived, superseded. Set by app logic; no DB-level enum.';

ALTER TABLE "candidate_decisions"
  ADD COLUMN IF NOT EXISTS "proposed_for_decision_id" uuid REFERENCES "decisions"("id"),
  ADD COLUMN IF NOT EXISTS "proposed_status" text,
  ADD COLUMN IF NOT EXISTS "proposed_intent" text;

COMMENT ON COLUMN "candidate_decisions"."proposed_for_decision_id" IS
  'Existing decision targeted by an agent candidate update, archive, or supersede operation.';

COMMENT ON COLUMN "candidate_decisions"."proposed_status" IS
  'Status proposed by an agent candidate operation, for example archived.';

COMMENT ON COLUMN "candidate_decisions"."proposed_intent" IS
  'One of: create, update, archive, supersede. Used by candidate confirmation flow.';

CREATE INDEX IF NOT EXISTS "decision_log_actor_created_idx"
  ON "decision_log" ("actor_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "candidate_decisions_proposed_for_idx"
  ON "candidate_decisions" ("proposed_for_decision_id")
  WHERE "proposed_for_decision_id" IS NOT NULL;
