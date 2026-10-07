-- Going back forgets which rows came from a library file: their recorded
-- costs then count toward the spending caps again (by the date they record).
ALTER TABLE audio_tracks DROP COLUMN imported;
ALTER TABLE generations DROP COLUMN imported;
ALTER TABLE audio_tracks DROP CONSTRAINT audio_tracks_cost_usd_check;
ALTER TABLE generations DROP CONSTRAINT generations_cost_usd_check;
