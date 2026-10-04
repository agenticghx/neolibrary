-- M6: the style AI explanations are written in ("What do I need to know?",
-- question answers): plain English or STE (Simplified Technical English) at a
-- strictness. Set once per reader; a book can override it (NULL = follow the
-- reader's setting).
ALTER TABLE users ADD COLUMN ai_style text NOT NULL DEFAULT 'plain'
  CHECK (ai_style IN ('plain', 'ste-light', 'ste-standard', 'ste-strict'));
ALTER TABLE books ADD COLUMN ai_style text
  CHECK (ai_style IN ('plain', 'ste-light', 'ste-standard', 'ste-strict'));
