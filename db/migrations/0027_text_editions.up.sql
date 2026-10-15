-- M25: scanned books become flowing books (docs/scan-to-text-plan.md). A job
-- reads a scanned PDF's pages with Claude through the Message Batches API,
-- which answers within 24 hours: the batch numbers live here, not in the
-- server's memory, so a redeploy while Anthropic works loses nothing. Each
-- page read is stored as a `generations` row (kind 'transcribe'), which
-- carries its provenance and cost. While a job is going on, its estimate
-- minus what its pages have cost so far is held against the spending caps.
CREATE TABLE text_edition_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_hash text NOT NULL,
  -- preparing: drawing pages and sending batches; waiting: all sent, answers
  -- still coming; then finished, stopped (the owner pressed Stop) or failed.
  status text NOT NULL CHECK (status IN ('preparing', 'waiting', 'finished', 'stopped', 'failed')),
  stop_requested boolean NOT NULL DEFAULT false,
  page_count integer NOT NULL,
  estimate_usd double precision NOT NULL CHECK (estimate_usd >= 0),
  -- [{ "id": batch number, "pages": [page numbers], "hashes": [sha256 of each page picture], "stored": answers saved }]
  batches jsonb NOT NULL DEFAULT '[]',
  -- Page numbers with almost no ink: never sent (nothing to read, nothing to invent).
  blank_pages jsonb NOT NULL DEFAULT '[]',
  -- Pages not read: [{ "page", "kind": refused | errored | canceled | expired, "message" }]
  problems jsonb NOT NULL DEFAULT '[]',
  -- Each page read, compared with the scan's own hidden text: [{ "page", "agreement" (0-1, or null when the scan has too little text to compare), "flagged" }]
  checks jsonb NOT NULL DEFAULT '[]',
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
-- One job going on per book at a time.
CREATE UNIQUE INDEX text_edition_jobs_active_idx ON text_edition_jobs (book_id) WHERE status IN ('preparing', 'waiting');
CREATE INDEX text_edition_jobs_book_idx ON text_edition_jobs (owner_id, book_id, created_at DESC);
-- The text edition itself (M25 S5): an EPUB made from the pages, kept beside the scan, never replacing it. It is a
-- book of its own, linked to its scan and hidden from the library's lists, so everything the reader does with a
-- book (its paragraphs, Listen, notes, rewrites, search, the place reached) works on it as on any EPUB, and each
-- edition keeps its own notes and place. Removing the scan removes its edition.
ALTER TABLE books ADD COLUMN edition_of uuid REFERENCES books (id) ON DELETE CASCADE;
CREATE UNIQUE INDEX books_edition_of_idx ON books (edition_of) WHERE edition_of IS NOT NULL;
