-- Going back keeps what was said: voice notes become text notes holding
-- their transcript (the recordings stay in storage).
UPDATE annotations
  SET kind = 'note',
      body = CASE WHEN body = '' THEN transcript WHEN transcript = '' THEN body ELSE body || E'\n\n' || transcript END
  WHERE kind = 'voice';
ALTER TABLE annotations DROP COLUMN transcript;
ALTER TABLE annotations DROP COLUMN duration_ms;
ALTER TABLE annotations DROP COLUMN audio_mime;
ALTER TABLE annotations DROP COLUMN audio_key;
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN ('highlight', 'bookmark', 'note'));
