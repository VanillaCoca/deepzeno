ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "default_model_id" text;

CREATE TABLE IF NOT EXISTS "project_user_view_state" (
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "project_id")
);

CREATE INDEX IF NOT EXISTS "project_user_view_state_project_idx"
  ON "project_user_view_state" ("project_id");
