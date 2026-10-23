-- M32 X1: the X-ray index of a book, from its text alone. An entry is a person,
-- place, organisation or term the book names; until Claude reads the book
-- (X3) its kind is 'name' (not yet classified) and its facts do not exist.
-- aliases holds every way the book writes the name ("Hyde", "Mr. Hyde",
-- "Edward Hyde"); a mention is one occurrence of an alias in one paragraph,
-- by character offsets into sections.text (whitespace collapsed, the same
-- text the reader walks to light a word). Mentions are derived from the
-- entries and the text, so they are rebuilt, never exported.
CREATE TABLE xray_entries (
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'name' CHECK (kind IN ('name', 'person', 'place', 'organisation', 'term', 'work', 'event')),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The AI answer an entry came from (X3), for provenance; null when found in the text alone.
  generation_id uuid REFERENCES generations (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, id)
);
CREATE TABLE xray_mentions (
  book_id uuid NOT NULL,
  entry_id text NOT NULL,
  section_id text NOT NULL,
  chapter_index integer NOT NULL,
  position integer NOT NULL,
  start_at integer NOT NULL CHECK (start_at >= 0),
  end_at integer NOT NULL CHECK (end_at > start_at),
  PRIMARY KEY (book_id, entry_id, section_id, start_at),
  FOREIGN KEY (book_id, entry_id) REFERENCES xray_entries (book_id, id) ON DELETE CASCADE
);
CREATE INDEX xray_mentions_book_position_idx ON xray_mentions (book_id, position);
