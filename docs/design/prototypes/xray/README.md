# X-ray prototype (2026-10-22)

Written for: the session that plans the X-ray milestone, and Samuel.

The live page is https://claude.ai/artifact/PdnTUfLHeKJa8oyLBNEUuW (private).
What it shows and why is in `docs/xray-ideas.md`.

- `index.json`: the index for *The Strange Case of Dr. Jekyll and Mr. Hyde*
  (the fixture EPUB), written by Claude by hand: 20 entries, 112 facts, each
  with a verbatim quote and the chapter and paragraph it comes from. A sample
  of what the real extraction step should produce.
- `template.html`: the page, with `__CHAPTERS__` and `__INDEX__` placeholders.

To rebuild: unzip `fixtures/books/stevenson-jekyll-and-hyde.epub`, turn each
`chapter-N.xhtml` into `{title, paragraphs[]}` (strip tags, unescape
entities, collapse whitespace), sort by N, and replace the two placeholders
with the JSON. Check first that every quote is a substring of its paragraph.
