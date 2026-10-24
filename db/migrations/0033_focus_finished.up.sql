-- M26 R5: whole-book focus. A book focus is a focus_sessions row of kind 'book'
-- (R4a made room for it); its length is in days, kept as minutes (days x 1440).
-- Reaching the last page ends it, and that is a sixth way a session ends:
--   finished  the reader reached the end of the book
ALTER TABLE focus_sessions DROP CONSTRAINT focus_sessions_ended_how_check;
ALTER TABLE focus_sessions ADD CONSTRAINT focus_sessions_ended_how_check
  CHECK (ended_how IN ('time', 'answered', 'early', 'waited', 'released', 'finished'));
