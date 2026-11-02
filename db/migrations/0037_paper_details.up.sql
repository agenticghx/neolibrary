-- M41 R3: a research paper is a kind of item in the same library. 'book' is everything before (and still the default);
-- 'paper' is a title its reader marked as a paper by its DOI or PubMed ID (lib/library/papers.ts). A paper carries its
-- authors (in order, family and given names), journal, year and the two identifiers, found in Crossref or PubMed.
-- Existing rows stay books with no details: nothing about them changes.
ALTER TABLE books ADD COLUMN kind text NOT NULL DEFAULT 'book' CHECK (kind IN ('book', 'paper'));
ALTER TABLE books ADD COLUMN authors jsonb NOT NULL DEFAULT '[]';
ALTER TABLE books ADD COLUMN journal text;
ALTER TABLE books ADD COLUMN year integer;
ALTER TABLE books ADD COLUMN doi text;
ALTER TABLE books ADD COLUMN pmid text;
