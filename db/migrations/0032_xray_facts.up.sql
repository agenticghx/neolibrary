-- M32 X3: what the book says about each X-ray entry, chapter by chapter, as
-- Claude read it. A fact is one short statement with the quote it rests on:
-- a quote that is not found word for word in the paragraph it names is never
-- stored (the fact is dropped and counted). Facts are kept per chapter, so a
-- card can show only what the reader has reached. generation_id is the AI
-- answer the fact came from (provenance, ground rule 5): when that answer
-- goes, so do its facts.
CREATE TABLE xray_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL,
  entry_id text NOT NULL,
  generation_id uuid NOT NULL REFERENCES generations (id) ON DELETE CASCADE,
  chapter_index integer NOT NULL,
  section_id text NOT NULL,
  position integer NOT NULL,
  start_at integer NOT NULL CHECK (start_at >= 0),
  end_at integer NOT NULL CHECK (end_at > start_at),
  fact text NOT NULL,
  quote text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (book_id, entry_id) REFERENCES xray_entries (book_id, id) ON DELETE CASCADE
);
CREATE INDEX xray_facts_book_position_idx ON xray_facts (book_id, position);
CREATE INDEX xray_facts_generation_idx ON xray_facts (generation_id);
