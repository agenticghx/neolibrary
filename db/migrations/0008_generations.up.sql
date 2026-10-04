-- M6: every piece of machine-written text (rewrites first; later
-- prerequisites, question banks) is stored once with its provenance (ground
-- rule 5): which model wrote it, a fingerprint (sha256) of the prompt file and
-- of the input text, tokens used, cost in US dollars and when.
-- cache_key identifies "the same request" so it is answered from here instead
-- of paying for a second call. Rows are never changed; a fresh attempt at the
-- same request adds a row (a new version).
CREATE TABLE generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid REFERENCES books (id) ON DELETE CASCADE,
  section_id text,
  kind text NOT NULL,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  cache_key text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_name text NOT NULL,
  prompt_hash text NOT NULL,
  input_hash text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  output text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generations_cache_idx ON generations (owner_id, cache_key, created_at DESC);
CREATE INDEX generations_book_idx ON generations (owner_id, book_id, section_id, created_at);
CREATE INDEX generations_spend_idx ON generations (provider, created_at);
