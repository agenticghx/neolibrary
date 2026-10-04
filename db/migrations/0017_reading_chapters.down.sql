-- Going back drops the per-chapter split only; each sitting's totals (time,
-- words, pages) stay in reading_sessions.
ALTER TABLE reading_sessions DROP COLUMN chapters;
