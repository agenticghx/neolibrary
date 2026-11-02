-- Undoes 0037. Every title is a book again; a paper's authors, journal, year, DOI and PubMed ID are dropped (its title
-- and the author line written from them stay, as ordinary book details).
ALTER TABLE books DROP COLUMN pmid;
ALTER TABLE books DROP COLUMN doi;
ALTER TABLE books DROP COLUMN year;
ALTER TABLE books DROP COLUMN journal;
ALTER TABLE books DROP COLUMN authors;
ALTER TABLE books DROP COLUMN kind;
