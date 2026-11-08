-- M43 S2: a book's genealogy, as read on the owner's Claude subscription by
-- scripts/genealogy-on-subscription.ts and sent whole with an API token. A
-- link is one thing the book says between two named people or organisations
-- ("Jerry Sanders founded AMD"), with the paragraph and the quote it rests
-- on; the server finds every quote in its own copy of the paragraph before a
-- link is stored (offsets into sections.text). Links the second reading
-- removed are kept, marked removed, so a reader can judge it too. A life event
-- is one job, founding or departure of one person, in the order it happened;
-- its links are named by their place (ord) in the book's list. Years from
-- Claude's general knowledge are kept in their own columns, never mixed with
-- the book's (Samuel, 2026-11-08: shown in the app, purple and switchable).
-- generation_id is the send it came from (ground rule 5); a new send replaces
-- the book's rows, and the old generation stays as history.
CREATE TABLE genealogy_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  generation_id uuid NOT NULL REFERENCES generations (id) ON DELETE CASCADE,
  ord integer NOT NULL CHECK (ord >= 0),
  from_name text NOT NULL,
  from_kind text NOT NULL CHECK (from_kind IN ('person', 'organisation')),
  to_name text NOT NULL,
  to_kind text NOT NULL CHECK (to_kind IN ('person', 'organisation')),
  relation text NOT NULL CHECK (relation IN ('founded', 'worked_at', 'led', 'left', 'advised', 'spun_out_of', 'acquired', 'bought_part_of', 'part_of', 'funded', 'supplied', 'partnered', 'mentored', 'hired', 'worked_for', 'friend', 'family')),
  role text,
  removed boolean NOT NULL DEFAULT false,
  verdict text CHECK (verdict IN ('holds', 'fix')),
  was text,
  why text,
  section_id text NOT NULL,
  chapter_index integer NOT NULL,
  position integer NOT NULL,
  start_at integer NOT NULL CHECK (start_at >= 0),
  end_at integer NOT NULL CHECK (end_at > start_at),
  quote text NOT NULL,
  -- The year the book gives for this link, with the words that give it (checked like the quote).
  date_year integer,
  date_end_year integer,
  date_section_id text,
  date_start_at integer,
  date_end_at integer,
  date_quote text,
  UNIQUE (book_id, ord)
);
CREATE INDEX genealogy_links_generation_idx ON genealogy_links (generation_id);

CREATE TABLE genealogy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  generation_id uuid NOT NULL REFERENCES generations (id) ON DELETE CASCADE,
  person text NOT NULL,
  ord integer NOT NULL CHECK (ord >= 0),
  what text NOT NULL,
  with_name text NOT NULL,
  role text,
  link_ords jsonb NOT NULL DEFAULT '[]'::jsonb,
  start_year integer,
  end_year integer,
  date_link_ords jsonb NOT NULL DEFAULT '[]'::jsonb,
  basis text NOT NULL CHECK (basis IN ('stated', 'worked_out', 'ordered', 'unknown')),
  order_section_id text,
  order_start_at integer,
  order_end_at integer,
  order_quote text,
  why text,
  gk_start_year integer,
  gk_end_year integer,
  gk_confidence text CHECK (gk_confidence IN ('high', 'medium')),
  gk_note text,
  UNIQUE (book_id, person, ord)
);
CREATE INDEX genealogy_events_generation_idx ON genealogy_events (generation_id);
