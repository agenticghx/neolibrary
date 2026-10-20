-- M28 S1: Daily review cards that are not highlights or notes. A card is now
-- named by card_id: a highlight's or note's annotation id (so every schedule
-- made before this keeps working), or 'q:<question bank id>:<question number>'
-- for a Test yourself question. annotation_id is set only for highlights and
-- notes. Schedule state only: nothing the reader wrote is changed.
ALTER TABLE review_cards ADD COLUMN card_id text;
UPDATE review_cards SET card_id = annotation_id::text;
ALTER TABLE review_cards ALTER COLUMN card_id SET NOT NULL;
ALTER TABLE review_cards DROP CONSTRAINT review_cards_pkey;
ALTER TABLE review_cards ADD PRIMARY KEY (owner_id, card_id);
ALTER TABLE review_cards ALTER COLUMN annotation_id DROP NOT NULL;
-- A highlight or note is named by its own id; any other card by a kind letter, a colon and its source.
ALTER TABLE review_cards ADD CONSTRAINT review_cards_card_id_check CHECK (
  (annotation_id IS NOT NULL AND card_id = annotation_id::text)
  OR (annotation_id IS NULL AND card_id ~ '^[a-z]:[0-9a-f-]{36}:[0-9]+$')
);
