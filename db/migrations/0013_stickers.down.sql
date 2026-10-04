-- Going back keeps the marks: stickers become amber highlights whose note
-- names the sticker.
UPDATE annotations
  SET kind = 'highlight',
      color = 'amber',
      body = CASE WHEN body = '' THEN 'Sticker: ' || sticker ELSE 'Sticker: ' || sticker || E'\n\n' || body END
  WHERE kind = 'sticker';
ALTER TABLE annotations DROP COLUMN sticker;
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice'));
