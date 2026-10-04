-- Going back removes uploaded audiobooks' tracks and import records. Their
-- audio files stay in storage (keys under audio/<owner>/<book>/readalong-*),
-- so the reader can import the same package again after moving forward.
DELETE FROM audio_tracks WHERE import_id IS NOT NULL;
DROP INDEX IF EXISTS audio_tracks_import_idx;
ALTER TABLE audio_tracks DROP COLUMN import_id;
ALTER TABLE audio_tracks DROP COLUMN audio_end_ms;
ALTER TABLE audio_tracks DROP COLUMN audio_start_ms;
DROP TABLE readalong_imports;
