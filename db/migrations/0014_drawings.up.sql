-- M8: handwritten notes. A drawing is an annotation of kind 'drawing'
-- (append-only like the others) holding pen strokes as point lists on a pad
-- of a fixed size, so it redraws the same on every screen.
ALTER TABLE annotations DROP CONSTRAINT annotations_kind_check;
ALTER TABLE annotations ADD CONSTRAINT annotations_kind_check CHECK (kind IN ('highlight', 'bookmark', 'note', 'voice', 'sticker', 'drawing'));
ALTER TABLE annotations ADD COLUMN strokes jsonb;
