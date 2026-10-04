-- M7: audio for reading aloud. A track is the audio of one section
-- (paragraph) with word timings, so the text can be highlighted as it is
-- spoken. It does not depend on one provider: source 'tts' (made by a voice
-- service such as ElevenLabs) or, later, 'upload' (narration the reader adds).
-- Made tracks keep their provenance and cost (ground rules 5 and 8); the
-- audio file itself lives in storage (audio_key), never in the database.
CREATE TABLE audio_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  section_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('tts', 'upload')),
  provider text,
  model text,
  voice text NOT NULL,
  cache_key text NOT NULL,
  input_hash text NOT NULL,
  characters integer NOT NULL DEFAULT 0,
  cost_usd double precision NOT NULL DEFAULT 0,
  audio_key text NOT NULL,
  mime text NOT NULL,
  duration_ms integer NOT NULL,
  words jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audio_tracks_cache_idx ON audio_tracks (owner_id, cache_key, created_at DESC);
CREATE INDEX audio_tracks_book_idx ON audio_tracks (owner_id, book_id, section_id);
CREATE INDEX audio_tracks_spend_idx ON audio_tracks (provider, created_at);
