-- Undoes 0027. Nothing a reader made is lost: the pages read stay in
-- `generations`, and a text edition stays as an ordinary book of its own
-- (only its link to the scan goes); the jobs' history goes.
DROP INDEX books_edition_of_idx;
ALTER TABLE books DROP COLUMN edition_of;
DROP TABLE text_edition_jobs;
