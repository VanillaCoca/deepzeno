ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'exploring',
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "decided_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "executing_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "superseded_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "dismissed_at" timestamptz;

DO $$
BEGIN
  ALTER TABLE "topics"
    ADD CONSTRAINT "topics_status_check"
    CHECK ("status" IN (
      'exploring',
      'converging',
      'decided',
      'executing',
      'superseded',
      'dismissed'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS "topic_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "from_topic_id" uuid NOT NULL REFERENCES "topics"("id") ON DELETE CASCADE,
  "to_topic_id" uuid NOT NULL REFERENCES "topics"("id") ON DELETE CASCADE,
  "relation_type" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "topic_relations_no_self_loop"
    CHECK ("from_topic_id" <> "to_topic_id"),
  CONSTRAINT "topic_relations_type_check"
    CHECK ("relation_type" IN (
      'supersedes',
      'revisits',
      'depends_on',
      'contradicts'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS "topic_relations_unique_relation"
  ON "topic_relations" ("from_topic_id", "to_topic_id", "relation_type");

CREATE INDEX IF NOT EXISTS "topics_project_status_idx"
  ON "topics" ("project_id", "status");

CREATE INDEX IF NOT EXISTS "topic_relations_project_idx"
  ON "topic_relations" ("project_id", "created_at");

CREATE INDEX IF NOT EXISTS "topic_relations_to_topic_idx"
  ON "topic_relations" ("to_topic_id");
