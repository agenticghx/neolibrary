-- Undoes 0030. The schedules of Test yourself questions go (the questions
-- stay in their banks); highlights' and notes' schedules are kept.
DELETE FROM review_cards WHERE annotation_id IS NULL;
ALTER TABLE review_cards DROP CONSTRAINT review_cards_card_id_check;
ALTER TABLE review_cards DROP CONSTRAINT review_cards_pkey;
ALTER TABLE review_cards ALTER COLUMN annotation_id SET NOT NULL;
ALTER TABLE review_cards ADD PRIMARY KEY (owner_id, annotation_id);
ALTER TABLE review_cards DROP COLUMN card_id;
