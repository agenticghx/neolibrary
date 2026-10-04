-- M8: voice notes. A voice note is an annotation of kind 'voice' (append-only
-- like the others, ground rule 9) with the recording's storage key, its
-- length and a transcript, so it can be searched and exported as text.
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice'));
ALTER TABLE annotations ADD COLUMN audio_key text;
ALTER TABLE annotations ADD COLUMN audio_mime text;
ALTER TABLE annotations ADD COLUMN duration_ms integer;
ALTER TABLE annotations ADD COLUMN transcript text NOT NULL DEFAULT '';
