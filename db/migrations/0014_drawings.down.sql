-- Going back keeps a trace: drawings become notes that say a drawing was
-- there and how many strokes it had.
UPDATE annotations
  SET kind = 'note',
      body = CASE
        WHEN body = '' THEN 'Handwritten note (' || jsonb_array_length(strokes -> 'strokes') || ' strokes)'
        ELSE body || E'\n\nHandwritten note (' || jsonb_array_length(strokes -> 'strokes') || ' strokes)'
      END
  WHERE kind = 'drawing';
ALTER TABLE annotations DROP COLUMN strokes;
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice', 'sticker'));
