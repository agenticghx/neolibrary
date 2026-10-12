-- Going back: an uploaded cover keeps showing (cover_key is not touched), but
-- is recorded as the book file's, the only source before this that is not a
-- catalogue's; it then cannot be turned down on the Covers page.
UPDATE books SET cover_source = 'file' WHERE cover_source = 'upload';
ALTER TABLE books DROP CONSTRAINT books_cover_source_check;
ALTER TABLE books ADD CONSTRAINT books_cover_source_check CHECK (cover_source IN ('file', 'openlibrary', 'googlebooks', 'fake'));
