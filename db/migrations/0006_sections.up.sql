-- M4: the section model. Each EPUB split into chapters, sections and
-- paragraphs with stable ids (see lib/library/sections.ts). The text is kept
-- here for the AI features and for full-text search.
CREATE TABLE sections (
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('chapter', 'section', 'paragraph')),
  parent_id text,
  position integer NOT NULL,
  chapter_index integer NOT NULL,
  href text NOT NULL,
  cfi text NOT NULL,
  label text NOT NULL DEFAULT '',
  text text NOT NULL DEFAULT '',
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', label || ' ' || text)) STORED,
  PRIMARY KEY (book_id, id)
);
CREATE INDEX sections_book_position_idx ON sections (book_id, position);
CREATE INDEX sections_search_idx ON sections USING gin (search);
