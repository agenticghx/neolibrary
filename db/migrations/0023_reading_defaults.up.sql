-- M17 (Samuel, 2026-10-10): every book opens with the rewrite beside the page
-- ("side"), in STE light, unless the reader chooses otherwise on the Account
-- page or in the reader. rewritten_view is the view the reader opens in:
-- the book alone, side by side, or the rewrite alone. Existing readers keep
-- their AI explanations style; new readers start in STE light.
ALTER TABLE users ADD COLUMN rewritten_view text NOT NULL DEFAULT 'side'
  CHECK (rewritten_view IN ('original', 'side', 'rewritten'));
ALTER TABLE users ALTER COLUMN ai_style SET DEFAULT 'ste-light';
