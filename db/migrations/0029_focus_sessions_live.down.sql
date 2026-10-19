-- Undoes 0029. Nothing the reader wrote is lost: the question stays on each
-- sitting (reading_sessions.question) and the answer is a note on the book.
-- Only the record of when and how each session ended goes, and the lock with
-- it (the browser's own copy of a running session still shows its timer).
DROP TABLE focus_sessions;
