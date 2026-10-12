-- Going back forgets where covers came from and which were turned down. Covers
-- found in catalogues stay stored and keep showing (cover_key is not touched).
ALTER TABLE books DROP COLUMN isbn;
ALTER TABLE books DROP COLUMN cover_rejected;
ALTER TABLE books DROP COLUMN cover_checked_at;
ALTER TABLE books DROP COLUMN cover_page;
ALTER TABLE books DROP COLUMN cover_ref;
ALTER TABLE books DROP COLUMN cover_source;
