-- M26 R4a: the running focus session lives on the server, not only in the
-- browser that started it. While a session runs, every page on every device
-- sends the reader back to the focused book, and other books' files are
-- refused (423 Locked). One row per session: the book, the question, its kind
-- ('sitting' now; 'book' for whole-book focus in R5), when it started, when it
-- ends, when a wait to leave early ends (R4b), and when and how it actually
-- ended:
--   time      the time ran out (the answer, if any, came after)
--   answered  ended early with an answer written (R4a's End now, R4b's
--             "Write my answer now")
--   early     ended early with no answer (R4a's End now; R4b removes it)
--   waited    ended early after the wait (R4b)
--   released  a trusted person let the reader go (later)
-- The sittings in reading_sessions point at it through focus_id (R3), and the
-- answer is a note on the book with the id chosen here (note_id), so a retry
-- saves nothing twice.
CREATE TABLE focus_sessions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'sitting',
  question text NOT NULL,
  minutes integer NOT NULL,
  note_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  wait_ends_at timestamptz,
  ended_at timestamptz,
  ended_how text,
  CONSTRAINT focus_sessions_kind_check CHECK (kind IN ('sitting', 'book')),
  CONSTRAINT focus_sessions_ended_how_check CHECK (ended_how IN ('time', 'answered', 'early', 'waited', 'released')),
  CONSTRAINT focus_sessions_ended_check CHECK ((ended_at IS NULL) = (ended_how IS NULL)),
  CONSTRAINT focus_sessions_ends_check CHECK (ends_at > started_at)
);
-- One session at a time per reader, kept by the database: a second row with
-- ended_at still empty is refused. A session whose time ran out while no
-- device was open is closed (ended_how 'time') before a new one starts.
CREATE UNIQUE INDEX focus_sessions_one_open ON focus_sessions (owner_id) WHERE ended_at IS NULL;
CREATE INDEX focus_sessions_owner_idx ON focus_sessions (owner_id, started_at);
