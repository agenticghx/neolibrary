-- Two counts the library did not keep (owner sweep, 2026-11-10; Samuel's go-ahead the same day).
--
-- 1. bytes_received: how much audio a read-along import has taken in. There
--    was no ceiling on it, so any signed-in reader could fill the storage
--    bucket. Each audio part now adds its size here, and a reader's imports
--    together may not pass READALONG_MAX_GB (lib/readalong/importer.ts).
--    Imports made before this start at 0.
--
-- 2. failed_spend: a paid AI call that was billed but gave nothing usable
--    (the model declined, the answer was cut off, or it was empty). Such a
--    call stored no row anywhere, so it never counted against the spending
--    cap. It is its own table, not a row in `generations`, so a failed call
--    can never be served as a stored answer. It holds no text of the reader's
--    or the book's: only who, which book, which service, the cost and why.
ALTER TABLE readalong_imports ADD COLUMN bytes_received bigint NOT NULL DEFAULT 0 CHECK (bytes_received >= 0);

CREATE TABLE failed_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid REFERENCES books (id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  kind text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX failed_spend_provider_created_idx ON failed_spend (provider, created_at);
CREATE INDEX failed_spend_book_idx ON failed_spend (book_id);
