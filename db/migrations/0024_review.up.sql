-- M21: Daily review (spaced repetition: each card comes back after a growing
-- interval, timed to just before it would be forgotten). One row per reader
-- per annotation (a highlight or note), written the first time it is rated.
-- An annotation with no row here is a new card. This is schedule state, not
-- the reader's words, so a rating updates its row in place; the notes
-- themselves stay append-only (ground rule 9).
-- annotation_id is not unique in annotations (its versions share it), so it
-- has no database link; a card whose annotation is removed is simply not shown.
CREATE TABLE review_cards (
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  annotation_id uuid NOT NULL,
  -- SM-2's ease factor: how fast the interval grows. Never below 1.3; 'NaN' fails the second test.
  ease double precision NOT NULL DEFAULT 2.5 CHECK (ease >= 1.3 AND ease < 'Infinity'),
  interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  reps integer NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses integer NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  due_at timestamptz NOT NULL,
  first_reviewed_at timestamptz NOT NULL,
  last_reviewed_at timestamptz NOT NULL,
  last_rating text NOT NULL CHECK (last_rating IN ('again', 'hard', 'good', 'easy')),
  PRIMARY KEY (owner_id, annotation_id)
);
CREATE INDEX review_cards_owner_due_idx ON review_cards (owner_id, due_at);
