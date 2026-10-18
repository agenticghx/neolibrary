-- M26 R3: a focus session with a question. Before reading, the reader writes
-- the question they are reading to answer and sets a timer; the sittings read
-- during it carry the question, so the Reading stats page can show each
-- session with its question. A reload part-way through starts a new sitting
-- (the reader counts a sitting per page load), so sittings of one session share
-- a focus_id. When the time is up and the reader writes an answer, it is saved
-- as a note on the book (which is also a Daily review card), and the sittings
-- point at that note.
ALTER TABLE reading_sessions ADD COLUMN focus_id uuid;
ALTER TABLE reading_sessions ADD COLUMN question text NOT NULL DEFAULT '';
ALTER TABLE reading_sessions ADD COLUMN answer_annotation_id uuid;
CREATE INDEX reading_sessions_focus_idx ON reading_sessions (owner_id, focus_id) WHERE focus_id IS NOT NULL;
