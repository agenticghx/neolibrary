-- Going back keeps the credit: pinned pictures become notes naming the
-- picture, its author and licence (or saying it was generated).
UPDATE annotations
  SET kind = 'note',
      body = CASE WHEN body = '' THEN '' ELSE body || E'\n\n' END ||
        CASE WHEN picture ->> 'source' = 'generated'
          THEN 'Generated picture: ' || coalesce(picture ->> 'subject', '')
          ELSE 'Picture: ' || coalesce(picture ->> 'title', '') || ', ' || coalesce(picture ->> 'credit', '') || ', ' ||
               coalesce(picture ->> 'licence', '') || ' (' || coalesce(picture ->> 'pageUrl', '') || ')'
        END
  WHERE kind = 'image';
ALTER TABLE annotations DROP COLUMN picture;
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check
  CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice', 'sticker', 'drawing'));
