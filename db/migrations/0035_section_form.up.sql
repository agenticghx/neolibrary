-- M41 R1c: what form a paragraph takes. 'prose' is ordinary text; 'equation' is a paragraph that is one display
-- formula (MathML); 'cell' is a table cell. Rewrites, Need to know, Test yourself and Explain it back use prose only,
-- so a paper's equations and table cells are not offered for rewriting or paid for. Highlights, notes, search and
-- Listen are unchanged. Existing rows start as 'prose' (today's behaviour); a one-off pass at start-up labels the
-- paragraphs of books already in the library from their files (lib/library/section-forms.ts).
ALTER TABLE sections ADD COLUMN form text NOT NULL DEFAULT 'prose' CHECK (form IN ('prose', 'equation', 'cell'));
