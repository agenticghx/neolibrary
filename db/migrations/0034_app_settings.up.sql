-- M35: library-wide settings the owner changes on screen, one row per name.
-- The first is "ai-models": which Claude model answers each AI feature, as
-- {"<feature>": "<model id>"}. A feature missing from it uses the server's
-- AI_MODEL_<FEATURE> setting, else the built-in default (lib/ai/model.ts).
CREATE TABLE app_settings (
  name text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);
