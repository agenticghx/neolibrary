-- Undoes 0033. A book focus that ended at the last page is recorded as ending
-- on time instead (its answer, if any, stays a note on the book).
UPDATE focus_sessions SET ended_how = 'time' WHERE ended_how = 'finished';
ALTER TABLE focus_sessions DROP CONSTRAINT focus_sessions_ended_how_check;
ALTER TABLE focus_sessions ADD CONSTRAINT focus_sessions_ended_how_check
  CHECK (ended_how IN ('time', 'answered', 'early', 'waited', 'released'));
