-- Undoes 0038. Readers' copies of shared papers are removed from their libraries (kept as removed books, with their
-- notes, as any removed book is), and nothing is shared any more.
UPDATE books SET deleted_at = COALESCE(deleted_at, now()) WHERE shared_from IS NOT NULL;
DROP INDEX IF EXISTS books_shared_from_idx;
ALTER TABLE books DROP COLUMN share_papers, DROP COLUMN shared_from;
