-- M10 (c): where in the book a sitting's time and words went, chapter by
-- chapter, for honest per-chapter speed and suggestions. A list of
-- { key, label, position, activeSeconds, words }: key is the chapter's link in
-- the book's contents, position how far into the book it starts (0 to 1).
ALTER TABLE reading_sessions ADD COLUMN chapters jsonb NOT NULL DEFAULT '[]'::jsonb;
