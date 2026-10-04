-- M3 (b): what we learn from an uploaded file.
ALTER TABLE books ADD COLUMN toc jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE books ADD COLUMN page_count integer;
