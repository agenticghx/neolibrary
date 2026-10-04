-- M8: stickers on passages. A sticker is an annotation of kind 'sticker'
-- (append-only like the others) naming one of a small fixed set.
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice', 'sticker'));
ALTER TABLE annotations ADD COLUMN sticker text;
