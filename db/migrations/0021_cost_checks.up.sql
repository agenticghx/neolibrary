-- M14 follow-up: costs are real amounts of money. The spending caps add up
-- cost_usd across every reader (one API key pays for all), so a cost is
-- never negative and never infinite ('NaN' fails the second test too).
ALTER TABLE generations ADD CONSTRAINT generations_cost_usd_check CHECK (cost_usd >= 0 AND cost_usd < 'Infinity');
ALTER TABLE audio_tracks ADD CONSTRAINT audio_tracks_cost_usd_check CHECK (cost_usd >= 0 AND cost_usd < 'Infinity');
-- Rows brought back from a library file keep the cost they record (part of
-- their provenance), but that money was not spent here this month, so the
-- spending caps leave rows marked `imported` out.
ALTER TABLE generations ADD COLUMN imported boolean NOT NULL DEFAULT false;
ALTER TABLE audio_tracks ADD COLUMN imported boolean NOT NULL DEFAULT false;
