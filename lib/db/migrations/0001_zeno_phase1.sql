CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION prevent_decision_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'decision_log is append-only';
END;
$$;

ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_userId_fkey";
ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_userId_User_id_fk";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_userId_fkey";
ALTER TABLE "Document" DROP CONSTRAINT IF EXISTS "Document_userId_User_id_fk";
ALTER TABLE "Suggestion" DROP CONSTRAINT IF EXISTS "Suggestion_userId_fkey";
ALTER TABLE "Suggestion" DROP CONSTRAINT IF EXISTS "Suggestion_userId_User_id_fk";

DROP TABLE IF EXISTS "User";

CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "topics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "is_general" boolean NOT NULL DEFAULT false,
  "archived_at" timestamptz,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "topic_id" uuid NOT NULL REFERENCES "topics"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "ended_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
  "topic_id" uuid NOT NULL REFERENCES "topics"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "role" text NOT NULL,
  "content" text NOT NULL,
  "model" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "topic_id" uuid NOT NULL REFERENCES "topics"("id"),
  "title" text NOT NULL,
  "content" text NOT NULL,
  "rationale" text,
  "kind" text NOT NULL DEFAULT 'plan',
  "weight" text NOT NULL DEFAULT 'normal',
  "status" text NOT NULL DEFAULT 'active',
  "sensitivity" text NOT NULL DEFAULT 'normal',
  "relevant_message_ids" uuid[],
  "created_from_message_id" uuid REFERENCES "messages"("id"),
  "confirmed_by_user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "topic_id" uuid NOT NULL REFERENCES "topics"("id"),
  "source_decision_id" uuid NOT NULL REFERENCES "decisions"("id"),
  "target_decision_id" uuid NOT NULL REFERENCES "decisions"("id"),
  "type" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "candidate_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "topic_id" uuid NOT NULL REFERENCES "topics"("id"),
  "conversation_id" uuid REFERENCES "conversations"("id"),
  "message_id" uuid REFERENCES "messages"("id"),
  "proposed_title" text,
  "proposed_content" text NOT NULL,
  "proposed_rationale" text,
  "proposed_kind" text DEFAULT 'plan',
  "proposed_weight" text DEFAULT 'normal',
  "confidence" real,
  "pre_selected" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'pending',
  "suggested_edges" jsonb,
  "relevant_message_ids" uuid[],
  "content_hash" text,
  "resolved_at" timestamptz,
  "resolved_decision_id" uuid REFERENCES "decisions"("id"),
  "source" text NOT NULL DEFAULT 'zeno_extraction',
  "source_metadata" jsonb,
  "external_evidence" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "decision_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "decision_id" uuid REFERENCES "decisions"("id"),
  "candidate_id" uuid REFERENCES "candidate_decisions"("id"),
  "action" text NOT NULL,
  "actor_type" text NOT NULL DEFAULT 'user',
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "key_hash" text NOT NULL UNIQUE,
  "key_prefix" text NOT NULL,
  "label" text,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "candidate_decisions"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'zeno_extraction',
  ADD COLUMN IF NOT EXISTS "source_metadata" jsonb,
  ADD COLUMN IF NOT EXISTS "external_evidence" text;

CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");
CREATE INDEX IF NOT EXISTS "topics_project_position_idx" ON "topics" ("project_id", "position");
CREATE INDEX IF NOT EXISTS "conversations_project_created_idx" ON "conversations" ("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx" ON "messages" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "decisions_project_topic_idx" ON "decisions" ("project_id", "topic_id");
CREATE INDEX IF NOT EXISTS "candidate_decisions_topic_status_idx" ON "candidate_decisions" ("topic_id", "status");
CREATE INDEX IF NOT EXISTS "decision_log_decision_created_idx" ON "decision_log" ("decision_id", "created_at");
CREATE INDEX IF NOT EXISTS "api_keys_project_active_idx" ON "api_keys" ("project_id") WHERE "revoked_at" IS NULL;

DROP TRIGGER IF EXISTS prevent_decision_log_update ON "decision_log";
CREATE TRIGGER prevent_decision_log_update
BEFORE UPDATE ON "decision_log"
FOR EACH ROW
EXECUTE FUNCTION prevent_decision_log_mutation();

DROP TRIGGER IF EXISTS prevent_decision_log_delete ON "decision_log";
CREATE TRIGGER prevent_decision_log_delete
BEFORE DELETE ON "decision_log"
FOR EACH ROW
EXECUTE FUNCTION prevent_decision_log_mutation();
