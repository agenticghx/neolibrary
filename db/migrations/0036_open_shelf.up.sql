-- M34 S1: two switches per book for the open shelf, set by the library's owner.
--   on_shelf:     anyone, signed in or not, may see the title, cover, author
--                 and description. On by default: Samuel wants his whole shelf
--                 seen (2026-11-02). Only the owner's (admin's) books are ever
--                 shown on the open shelf; for other readers it means nothing.
--   free_to_read: anyone may open and read the book. Off by default, and the
--                 app turns it on only for a public-domain edition (ground
--                 rules 1 and 6; lib/library/open-shelf.ts).
ALTER TABLE books
  ADD COLUMN on_shelf boolean NOT NULL DEFAULT true,
  ADD COLUMN free_to_read boolean NOT NULL DEFAULT false;

-- The three free books Samuel chose (docs/plan.md, M34): his Standard Ebooks
-- editions, which are public domain. Matched by title and publisher, never by
-- id, so a library without them is left as it is.
UPDATE books SET free_to_read = true
WHERE publisher = 'Standard Ebooks'
  AND file_type = 'epub'
  AND edition_of IS NULL
  AND deleted_at IS NULL
  AND title IN ('The Time Machine', 'The Strange Case of Dr. Jekyll and Mr. Hyde', 'Frankenstein')
  AND owner_id IN (SELECT id FROM users WHERE role = 'admin');
