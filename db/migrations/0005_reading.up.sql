-- M4: where the reader is in a book (an EPUB CFI: a standard address for a
-- spot inside an EPUB that survives font-size changes).
ALTER TABLE books ADD COLUMN position text;
