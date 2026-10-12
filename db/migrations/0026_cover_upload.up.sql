-- M22 C3b: a cover the reader uploads (their own picture), besides one inside
-- the book file and one found in a catalogue. Stored like the others under
-- cover_key; cover_ref and cover_page stay empty (it came from no catalogue).
ALTER TABLE books DROP CONSTRAINT books_cover_source_check;
ALTER TABLE books ADD CONSTRAINT books_cover_source_check CHECK (cover_source IN ('file', 'openlibrary', 'googlebooks', 'fake', 'upload'));
