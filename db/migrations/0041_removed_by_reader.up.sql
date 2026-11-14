-- A reader's own removal of a book, kept apart from a removal the library made for them (audit 2026-11-09).
--
-- A copy of a shared paper is hidden (deleted_at set) when its owner stops sharing it, and brought back when the
-- owner shares it again. A copy the reader removed themselves was brought back too, because nothing told the two
-- apart. removed_by_reader is set when the reader removes a book and cleared when they bring it back; sharing again
-- brings back only copies it is not set on (lib/library/shared-papers.ts).
--
-- Rows from before this start at false: a copy a reader removed earlier cannot be told apart, so it still comes back
-- once, the next time its paper is shared again.
ALTER TABLE books ADD COLUMN removed_by_reader boolean NOT NULL DEFAULT false;
