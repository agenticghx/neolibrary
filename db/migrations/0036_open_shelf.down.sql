-- Undoes 0036. Nothing is shown to visitors any more; every book stays as it was.
ALTER TABLE books DROP COLUMN free_to_read, DROP COLUMN on_shelf;
