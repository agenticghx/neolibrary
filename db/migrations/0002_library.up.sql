-- M3: books, study paths, pillars and slots. Every row belongs to one user
-- (ground rule 6: each person sees only their own library).
CREATE TABLE books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL,
  author text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  unverified boolean NOT NULL DEFAULT false,
  file_key text,
  file_name text,
  file_type text CHECK (file_type IN ('epub', 'pdf')),
  file_size integer,
  cover_key text,
  language text,
  publisher text,
  description text,
  progress real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX books_owner_idx ON books (owner_id);

CREATE TABLE paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, slug)
);

CREATE TABLE pillars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id uuid NOT NULL REFERENCES paths (id) ON DELETE CASCADE,
  position integer NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  question text NOT NULL DEFAULT '',
  grp text NOT NULL DEFAULT 'main',
  UNIQUE (path_id, slug)
);

CREATE TABLE slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pillar_id uuid NOT NULL REFERENCES pillars (id) ON DELETE CASCADE,
  position integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('N', 'E', 'extra', 'master')),
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT ''
);
CREATE INDEX slots_pillar_idx ON slots (pillar_id);
CREATE INDEX slots_book_idx ON slots (book_id);
