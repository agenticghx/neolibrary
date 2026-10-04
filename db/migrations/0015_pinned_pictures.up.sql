-- M9: pictures pinned to passages. A pinned picture is an annotation of kind
-- 'image' (append-only like the others) holding the picture: from Wikimedia
-- Commons (links, title, credit, licence) or generated (the stored file).
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check
  CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice', 'sticker', 'drawing', 'image'));
ALTER TABLE annotations ADD COLUMN picture jsonb;
