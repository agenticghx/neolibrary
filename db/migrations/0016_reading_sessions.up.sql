-- M10: reading sessions, for honest reading statistics. One row per sitting
-- with a book: active reading seconds (the reader pauses the clock when the
-- tab is hidden, when nothing happens for two minutes, and while listening),
-- and the words on the pages seen, each page counted once per sitting.
CREATE TABLE reading_sessions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  active_seconds integer NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  words integer NOT NULL DEFAULT 0 CHECK (words >= 0),
  pages integer NOT NULL DEFAULT 0 CHECK (pages >= 0)
);
CREATE INDEX reading_sessions_owner_idx ON reading_sessions (owner_id, started_at);
