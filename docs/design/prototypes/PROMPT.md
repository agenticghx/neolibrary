# Prompt sent to Codex (OpenAI) for design prototype images

Written for: Samuel and future Claude sessions, so the images can be
regenerated or extended. Sent 2026-10-03 from a Claude Code session via the
Codex plugin. These are *proposals* to react to, not a design system; the
references Samuel picks in `docs/design/refs/` still lead.

---

<task>
Generate design prototype images for "Neolibrary", a private web app for
independent study, using your built-in image generation tool. Save every
image as PNG into `docs/design/prototypes/` in this repository. Do not modify
any other file.

What the product is (context for the art direction):
- A personal digital library that should feel like a beautiful private
  reading room, not a SaaS dashboard. Aesthetics are the top requirement.
- The shelf is organised as a study *Path*. The first Path is "Hidden
  Machinery": about 18 *pillars* (topics such as "Electricity & the grid",
  "Semiconductors", "Shipping & logistics", "Water & rivers", "How systems
  fail"). Each pillar holds a narrative book (N, read first) and an
  engineering/economics book (E, read second), plus extras; one "master key"
  book (Seeing Like a State) is read last. Books not yet owned are shown
  dimmed as placeholders.
- The reader lets you read and listen at once (natural-voice narration with
  the spoken word highlighted), make highlights and notes, rewrite a
  paragraph in plainer words with saved versions, see "what do I need to know
  first" for each section, and pin an explanatory image to a word.

Art direction (apply to all UI images):
- Mood: a quiet, warm reading room at dusk; literary, tactile, calm,
  confident. Think fine book typography and museum wayfinding, not tech
  startup.
- Type: a refined serif for book text and titles; a restrained humanist sans
  for small UI labels. Generous line spacing and margins.
- Light theme: warm paper (off-white, faint grain), deep ink text, one
  accent (oxidised copper or deep teal). Dark theme: deep ink-blue/charcoal
  background, soft parchment text, same accent, no pure black or pure white.
- Restraint: few borders, soft shadows, real hierarchy. No glassmorphism, no
  purple gradients, no stock-illustration people, no emoji, no clutter.
- Any visible text must be short and legible. Use only these book titles
  and only as plain typographic covers (never imitate real published cover
  art or publisher logos): "The Grid", "Power System Economics",
  "Chip War", "Fabless", "Ninety Percent of Everything",
  "Maritime Economics", "Normal Accidents", "Meltdown",
  "Seeing Like a State".
</task>

<deliverables>
Create exactly these files (16:10 for desktop, 9:19.5 for phone, 1:1 for
icon and cards):
1. `01-path-shelf-desktop-light.png`: desktop, light. The "Hidden Machinery"
   Path view: pillars as vertical columns or shelf rows, each with an N book
   then an E book, owned books as rich typographic covers, unowned books
   dimmed, a small "you are here" marker on one pillar, progress shown
   subtly. "Seeing Like a State" set apart at the end as the master key.
2. `02-path-shelf-desktop-dark.png`: the same screen in the dark theme.
3. `03-reader-desktop-light.png`: desktop reader on a page of "Chip War":
   wide book-like text column, a margin with two highlights and a short
   handwritten-style note, a slim narration bar at the bottom (play, voice
   name, speed) with the current spoken word highlighted in the text, and a
   collapsed "What you need to know first" panel at the top of the section.
4. `04-reader-rewrite-desktop-dark.png`: dark theme, a paragraph selected
   with a small popover offering "Plain English", "For a biologist",
   "Add background", "Shorter", and a version switcher ("Original · v1 · v2")
   showing the rewritten text visibly marked as machine-written.
5. `05-reader-listen-phone-light.png`: phone, light, reading while
   listening: large readable text, the spoken sentence softly highlighted,
   compact player.
6. `06-concept-card-wafer.png`: a pinned image card that pops up from the
   word "silicon wafer": the picture, a one-line caption, and a small
   credit line ("Wikimedia Commons · CC BY-SA").
7. `07-placeholder-covers.png`: a grid of 6 typographic placeholder covers
   for unowned books (title, author initials, pillar colour band) showing a
   consistent generative cover system.
8. `08-app-icon.png`: an app icon/mark for "Neolibrary": simple, works at
   32 px, suggests a book or doorway into hidden structure; no letters
   other than an optional "N".
9. `09-signin-dark.png`: a minimal invite-only sign-in screen, dark theme,
   with an atmospheric but quiet background.
</deliverables>

<default_follow_through_policy>
Do not ask questions; make reasonable art-direction choices within the brief
and keep all nine images visually consistent as one product. If an image
comes out with garbled text, unreadable labels or real cover art, regenerate
it once with a simplified prompt.
</default_follow_through_policy>

<action_safety>
Only write PNG files into `docs/design/prototypes/`. Do not edit, create or
delete any other file. Do not run git commands. Do not install anything.
</action_safety>

<completeness_contract>
If image generation is unavailable or fails, stop and say exactly what
error you got; do not substitute SVGs, HTML or descriptions.
</completeness_contract>

<compact_output_contract>
Reply with: a table of the files written (filename, one-line description,
any known flaw such as garbled text), then the exact prompt text you used
for each image, so the set can be regenerated. Nothing else.
</compact_output_contract>
