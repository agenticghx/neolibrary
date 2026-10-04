-- M11: provenance for notes an AI agent adds through the agent API (ground
-- rule 5: machine-written text is always marked). `agent` is the name of the
-- API token that wrote it; null means the reader wrote it.
ALTER TABLE annotations ADD COLUMN agent text;
