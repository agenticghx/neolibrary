-- M6: the reader's marks on question-bank questions (right or wrong).
-- Append-only like annotations (ground rule 9): marking again adds a row; the
-- latest row for a question is its mark. A question is one item of a stored
-- question bank (a row in generations), by position.
CREATE TABLE question_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  generation_id uuid NOT NULL REFERENCES generations (id) ON DELETE CASCADE,
  question_index integer NOT NULL CHECK (question_index >= 0),
  correct boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_marks_owner_book_idx ON question_marks (owner_id, book_id, created_at);
