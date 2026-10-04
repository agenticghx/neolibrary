-- M13: audiobooks the reader uploads as read-along packages (made on the
-- laptop by the readalong-audio skill; format in tools/readalong/). One row
-- per upload. The audio arrives in parts (it can be hundreds of MB), so an
-- import is 'uploading' until every audio file is complete and checked, then
-- 'ready'. Until then its word timings wait in `pending`; when it is ready
-- they become audio_tracks rows (one per paragraph) and `pending` is cleared.
CREATE TABLE readalong_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('uploading', 'ready')),
  title text,
  voice text,
  made_with text,
  manifest jsonb NOT NULL,
  -- per chapter: spoken words, words placed on the book's paragraphs
  report jsonb NOT NULL,
  -- per audio file: package path, storage key, sha256, seconds, mime, upload id
  audio jsonb NOT NULL,
  pending jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX readalong_imports_book_idx ON readalong_imports (owner_id, book_id, created_at DESC);

-- An uploaded track plays one stretch of a longer file: from audio_start_ms
-- to audio_end_ms. Its word times are then milliseconds in that file. Tracks
-- made by a voice service leave these empty (the file is the paragraph).
ALTER TABLE audio_tracks ADD COLUMN audio_start_ms integer;
ALTER TABLE audio_tracks ADD COLUMN audio_end_ms integer;
ALTER TABLE audio_tracks ADD COLUMN import_id uuid REFERENCES readalong_imports (id) ON DELETE CASCADE;
CREATE INDEX audio_tracks_import_idx ON audio_tracks (import_id);
