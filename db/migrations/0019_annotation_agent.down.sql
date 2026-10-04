-- Going back keeps the provenance in the note itself: agent notes start with
-- "(Added by agent: <name>)", then the column goes.
UPDATE annotations SET body = '(Added by agent: ' || agent || ') ' || body WHERE agent IS NOT NULL;
ALTER TABLE annotations DROP COLUMN agent;
