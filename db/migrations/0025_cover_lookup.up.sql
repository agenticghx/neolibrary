-- M22: covers for titles, found in public book catalogues (Open Library, then
-- Google Books when a key is set) by title and author. A cover found this way
-- is stored in the bucket like a cover from a book file, so cover_key keeps
-- meaning "the cover to show"; these columns say where it came from.
--   cover_source:     'file' (inside the book file), 'openlibrary', 'googlebooks', or 'fake' (tests)
--   cover_ref:        the address the picture was downloaded from (which picture it is)
--   cover_page:       the catalogue's page for the record it came from (credit)
--   cover_checked_at: when the catalogues were last asked (found or not), so a title is not asked again and again
--   cover_rejected:   pictures the reader turned down ("Not this cover"), by cover_ref, never offered again
--   isbn:             the edition's ISBN when the catalogue gave one
ALTER TABLE books ADD COLUMN cover_source text CHECK (cover_source IN ('file', 'openlibrary', 'googlebooks', 'fake'));
ALTER TABLE books ADD COLUMN cover_ref text;
ALTER TABLE books ADD COLUMN cover_page text;
ALTER TABLE books ADD COLUMN cover_checked_at timestamptz;
ALTER TABLE books ADD COLUMN cover_rejected jsonb NOT NULL DEFAULT '[]';
ALTER TABLE books ADD COLUMN isbn text;
-- Every cover stored before this came out of its book file.
UPDATE books SET cover_source = 'file' WHERE cover_key IS NOT NULL;
