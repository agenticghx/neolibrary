-- M41 R3c: the library owner's papers are shared with the people they invite (Samuel, 2026-11-02: "yes people invited
-- should see papers"). Each invited reader gets their own row for each shared paper (shared_from: the owner's row),
-- pointing at the same file and holding a copy of its sections, so their place, notes and AI answers are their own
-- and every existing "is this your book" check still holds. share_papers on the owner's row: shared (the default) or not.
ALTER TABLE books
  ADD COLUMN shared_from uuid REFERENCES books(id) ON DELETE SET NULL,
  ADD COLUMN share_papers boolean NOT NULL DEFAULT true;
-- One copy per reader per paper.
CREATE UNIQUE INDEX books_shared_from_idx ON books (owner_id, shared_from) WHERE shared_from IS NOT NULL;
