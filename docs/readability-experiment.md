# Do the rewrites of The Grid read more easily? A readability measurement (M21)

Written for: Samuel, and the next Claude session. Measured 2026-10-11. Numbers only: the book is
copyrighted, so no text from it appears here.

## The short answer

Yes, by the measure used. A typical page of *The Grid* scores about **grade 13** (roughly a first-year
university reader). Every one of the four rewrite styles brings it down to about **grade 8 or 9**
(roughly age 13 to 15), a drop of **4.2 to 4.9 grades** on average. About **94%** of pieces got easier;
the ones that did not are almost all headings a few words long. STE strict reads easiest and STE light
least easy, but the four styles are close to one another: the big step is from the book to any rewrite.

## What was measured

Two classic formulas that look only at **how long the sentences are** and **how long the words are**
(counted in syllables):

- **Flesch-Kincaid grade level**: about the number of years of US schooling a reader needs to read the
  text comfortably. 8 is age 13 to 14; 12 is the end of high school; 16 is a university degree. Lower is easier.
- **Flesch reading ease**: a score where higher is easier. 60 to 70 is ordinary adult prose (a newspaper);
  30 to 50 is hard (academic or technical writing).

The same grade is now shown in the app, on every rewrite: a quiet badge "Grade 14 → 8" under the
rewrite (in the Rewrite panel and in the Rewritten view), which opens to a one-line explanation.

## How

- The originals: `sections.json` in `~/Documents/neolibrary-grid-book` (the book's pieces exactly as the
  app has them). The rewrites: the `rewrite-<style>.md` files in that folder, plus chapter 1's in
  `~/Documents/neolibrary-grid-ch1/rewrites`. Both folders are outside git.
- A "piece" is what the app calls a paragraph of this PDF. The PDF has no paragraph marks, so most pieces
  are a whole printed page. 304 pieces, from the Introduction (page 7) to the Acknowledgments (page 248).
- Each piece was scored on its own, original and rewrite, by `lib/library/readability.ts` (the same code
  the app's badge uses). The script `scripts/readability-report.mjs` prints the tables below; it prints
  numbers only and writes no file.
- To repeat it: `node scripts/readability-report.mjs` (add `--json` for every number, unrounded).

## Results

Flesch-Kincaid grade, per piece (lower is easier). "Mean drop": the original's grade minus the rewrite's,
averaged over pieces. "Easier": the share of pieces whose rewrite has a lower grade than the original.

| Style | Pieces | Original mean | Original median | Rewrite mean | Rewrite median | Mean drop | Easier |
|---|---:|---:|---:|---:|---:|---:|---:|
| Plain | 304 | 13.3 | 13.4 | 9.0 | 8.9 | 4.3 | 94% |
| STE light | 304 | 13.3 | 13.4 | 9.1 | 9.0 | 4.2 | 93% |
| STE | 304 | 13.3 | 13.4 | 8.7 | 8.6 | 4.6 | 94% |
| STE strict | 304 | 13.3 | 13.4 | 8.4 | 8.3 | 4.9 | 94% |

Flesch reading ease, per piece (higher is easier). "Easier": the share of pieces whose rewrite scores higher.

| Style | Pieces | Original mean | Original median | Rewrite mean | Rewrite median | Mean rise | Easier |
|---|---:|---:|---:|---:|---:|---:|---:|
| Plain | 304 | 42.1 | 43.3 | 57.2 | 58.8 | 15.0 | 93% |
| STE light | 304 | 42.1 | 43.3 | 55.6 | 57.7 | 13.5 | 93% |
| STE | 304 | 42.1 | 43.3 | 56.9 | 58.2 | 14.7 | 93% |
| STE strict | 304 | 42.1 | 43.3 | 58.2 | 59.6 | 16.0 | 94% |

The pieces that did not get easier (grade the same or higher):

| Style | Not easier | Their median length (words) | Pieces that got easier | Their median length (words) | Their median drop (grades) |
|---|---:|---:|---:|---:|---:|
| Plain | 19 | 6 | 285 | 442 | 4.4 |
| STE light | 20 | 5.5 | 284 | 442.5 | 4.3 |
| STE | 19 | 6 | 285 | 442 | 4.7 |
| STE strict | 18 | 6.5 | 286 | 442 | 5.2 |

### Checked against your own checker

The whole book at once (all pieces joined), beside `scores.md` in the book folder, which your
`plain_check.py` (plain-english skill) produced on 2026-10-10:

| Version | Words per sentence (this) | Reading ease (this) | Reading ease (plain_check.py) | Rise from the original (this) | Rise (plain_check.py) |
|---|---:|---:|---:|---:|---:|
| Original | 25.8 | 42.3 | 46.1 | | |
| Plain | 16.0 | 58.7 | 62.8 | 16.4 | 16.7 |
| STE light | 15.5 | 57.1 | 61.2 | 14.8 | 15.1 |
| STE | 14.4 | 58.3 | 62.6 | 16.0 | 16.5 |
| STE strict | 13.9 | 59.5 | 63.7 | 17.2 | 17.6 |

The two programs were written separately and agree on **how much easier** each style made the book to
within half a point, and rank the styles the same way. This one scores every version about 4 points
harder. That offset comes mostly from three counting choices, measured on the original (syllables per
word 1.635 here against 1.570 there): it counts a hyphenated word ("well-known") as one longer word
(about +0.026), it counts numbers (years, sums of money) as words (+0.018), and its syllable rules
catch a few more syllables, for example in "radio" and "media" (+0.021). It also finds a few more
sentence ends (it splits before curly quotes), which pulls slightly the other way. Each choice is
defensible; the point is that the change, not the absolute level, is what both agree on.

## What the numbers suggest

1. **Any rewrite helps a lot; the style matters less.** The step from the book to any style is about
   4 to 5 grades. Between the easiest and the hardest style the gap is under 1 grade (STE strict 8.4,
   STE light 9.1).
2. **The order is the one you would expect** for STE: strict < standard < light, by grade. Plain
   English sits between STE and STE light by grade, and just above STE by reading ease.
3. **Nearly every page of prose got easier.** The pieces that did not are headings and captions a few
   words long, where these formulas mean nothing (a 6-word title has no "sentence length").
4. **The rewrites land at grade 8 to 9**, the range often advised for writing meant for the general
   public, from a book at grade 13.

## Caveats (read before quoting the numbers)

- **The formulas count, they do not understand.** They reward short sentences and short words, nothing
  else. A rewrite that drops a key qualification, or says something wrong in short words, scores as
  easier. These numbers say nothing about whether the meaning survived; the meaning-choice notes on each
  rewrite and your own reading are the check for that.
- **STE is built to win this test.** Simplified Technical English limits sentence length (20 words for
  instructions, 25 for descriptions) and prefers short common words, which are exactly the two things
  the formulas measure. STE strict scoring best is partly by design, not proof that it reads best.
- **Syllables are estimated from spelling**, not looked up: on 115 common words chosen before the rules
  were tuned, 109 were right at first and none was off by more than one (111 after one rule was added
  for "million" and "billion"; `lib/library/readability.test.ts`).
- **Pieces are whole printed pages** that often start or end mid-sentence. The cut-off fragment at each
  edge counts as a short sentence, which makes every piece look slightly easier than its full sentences
  are. It affects the original and the rewrites alike, so the comparison holds.
- **English only**, and made for prose: lists, tables, equations and names (of companies, places,
  people) are scored as if they were sentences of ordinary words.
- **Rewrites run a little longer.** STE strict uses about 6% more words than the original
  (110,640 against 104,302), which these formulas do not count against it.
