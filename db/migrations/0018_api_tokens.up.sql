-- M11: personal API tokens, so an AI agent can use the library as its user.
-- Only a sha256 hash of each token is stored (like sessions and invite
-- links); `prefix` is the token's first characters, shown so the owner can
-- tell tokens apart. A revoked token stays listed with its revoked date.
CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX api_tokens_owner_idx ON api_tokens (owner_id, created_at);
