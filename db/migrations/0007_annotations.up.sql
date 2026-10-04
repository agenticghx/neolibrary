-- M5: highlights, bookmarks and notes. Append-only (ground rule 9): every
-- change adds a new row (version) of the same annotation_id; a delete adds a
-- row with deleted = true. The current state is the latest version.
-- The target follows the W3C Web Annotation model: a book (or path/pillar),
-- and for passages a CFI plus a TextQuoteSelector (exact, prefix, suffix).
CREATE TABLE annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id uuid NOT NULL,
  version integer NOT NULL,
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('highlight', 'bookmark', 'note')),
  target_type text NOT NULL CHECK (target_type IN ('passage', 'book', 'pillar', 'path')),
  book_id uuid REFERENCES books (id) ON DELETE CASCADE,
  target_id uuid,
  section_id text,
  cfi text,
  quote_exact text NOT NULL DEFAULT '',
  quote_prefix text NOT NULL DEFAULT '',
  quote_suffix text NOT NULL DEFAULT '',
  color text,
  body text NOT NULL DEFAULT '',
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (annotation_id, version)
);
CREATE INDEX annotations_owner_book_idx ON annotations (owner_id, book_id);
CREATE INDEX annotations_annotation_idx ON annotations (annotation_id, version DESC);
