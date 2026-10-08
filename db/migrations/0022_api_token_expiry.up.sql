-- API tokens expire 90 days after they are made. 2160 hours is 90 × 24, a
-- fixed length, so a daylight-saving change does not move the moment.
-- Tokens that already exist get that same lifetime counted from created_at,
-- so none of them expire on the day this ships. (They were made with M11,
-- on 2026-10-04.)
ALTER TABLE api_tokens ADD COLUMN expires_at timestamptz;
UPDATE api_tokens SET expires_at = created_at + interval '2160 hours';
ALTER TABLE api_tokens ALTER COLUMN expires_at SET NOT NULL;
