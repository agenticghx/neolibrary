-- Undoes 0028. The reader's answers stay: each is a note on the book, which
-- repeats the question. Only the sittings' link to the question and to the
-- answer goes.
DROP INDEX reading_sessions_focus_idx;
ALTER TABLE reading_sessions DROP COLUMN answer_annotation_id;
ALTER TABLE reading_sessions DROP COLUMN question;
ALTER TABLE reading_sessions DROP COLUMN focus_id;
