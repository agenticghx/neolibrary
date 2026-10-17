# Prompt audit: scan to text (2026-10-17)

Written for Samuel and for the Claude sessions that change the page-reading instructions. It follows the `claude-api` skill's `prompt-audit` procedure.

## What was audited, and for which model

- **Scope** (Samuel asked to audit the prompts and the skill for book scans):
  - `prompts/transcribe-page.md`;
  - the two pieces of code that send it: `lib/ai/claude-batch.ts` (the server, Batch API) and `readPage` in `scripts/text-edition-on-subscription.ts` (the laptop, `claude -p`);
  - the new skill, `.claude/skills/scan-to-text/SKILL.md`.

  The repository's other prompts and `CLAUDE.md` are out of scope.
- **Target model:**
  - Claude Sonnet 5.5 for the instructions and the request code (`TRANSCRIBE_MODEL`);
  - Claude Opus 5.5 for the skill, the model that runs it.
- **Evidence used:** the whole-book reading of *The Pay Off* (360 pages, 2026-10-17), with every fault found in it, and the 5-page answer key from 2026-10-15.

## Summary

The instructions are short and plain: no pressure language, no step-by-step script, no reasoning scaffold. Their rule list is a format specification, which is the right shape for a format-sensitive output. The findings come from what went wrong on a real book, not from dated wording:

1. **No context about whose book it is, or why.** Page 213 came back as "I can't transcribe this page word for word, since it's a copyrighted book. Here is a summary instead." The instructions never said the reader owns the book and is making a private copy to read.
2. **Heading rules too loose for pages read one at a time.** "Chapter and section titles as Markdown headings (#, ##)" left the level to each page's guess. Chapter 1 lost its "1.", PART II's name came back one level low, and one Sources page gave "# Chapter 16" where its neighbours gave "## Chapter N".
3. **Effort left to two different defaults.** The server's batch requests used the API's default, and `claude -p` used Claude Code's. The two ways of reading a page should match, so effort is now set explicitly to `high` in both.

Counts:

| Group | Findings |
|---|---|
| 1 (prompt text) | 2 |
| 2 (skill files) | 3 |
| 3 (tool descriptions) | not applicable |
| 4 (request config) | 1 |

## Findings

| Location | Evidence | Pattern | Why | Confidence | Action |
|---|---|---|---|---|---|
| `prompts/transcribe-page.md:1` | "This image is one page of a scanned printed book." (no owner, no purpose) | Keep list 1 / 11: context the model cannot get elsewhere; re-baselining adds text | Sonnet 5.5 declined a page as copyrighted (p. 213). Saying the reader owns the book and is making a private, checkable copy is context only the author has. | Medium (seen once in 360 pages) | `rewrite`: name the owner, the purpose and the page-by-page reading |
| `prompts/transcribe-page.md:8` | "Chapter and section titles as Markdown headings (#, ##)" | 1c, under-specified where the output is format-sensitive | Each page is read alone, so the level must follow a rule, not a guess: 3 faults in one book (p. 23, 45, 358) | Medium | `rewrite`: # for a part or chapter title with its printed number (a part's label and name as two # lines), ## for headings inside, including chapter labels in notes and sources |
| `lib/ai/claude-batch.ts:41` and `scripts/text-edition-on-subscription.ts` `readPage` | no `output_config.effort` and no `--effort` | Group 4, thinking/effort configuration | Two paths that should read alike ran at two unset defaults | Medium | `rewrite`: effort `high` (Sonnet 5.5's API default) in both |
| `.claude/skills/scan-to-text/SKILL.md:3` | the description lists sample phrases ("OCR this book", "convert the scan", …) | Group 2, trigger-case enumeration | Descriptions ride in every request; categories of intent generalise better | Medium | `rewrite` as categories |
| `.claude/skills/scan-to-text/SKILL.md` | "Written 2026-10-17, from the first whole book", "it happened once in 360 pages" | Group 2, history narrative | A rule's authority is the behaviour it prescribes | Low | `flag`: kept where it tells the reader how often a fault happens |
| `.claude/skills/scan-to-text/SKILL.md` (Files) | `references/prompt.md` | Group 2, volatile specifics: the named path did not exist | A path the skill names must resolve | High | `add` the file: when and how to change the instructions, and this audit's evaluation |

Kept, though a grep matches: "Do not correct, modernise, summarise or reword anything" (the core constraint, with its reason now stated: every word is checked against the printed page); "Output only the Markdown, nothing else" (a format requirement: a preamble would become text on the page); the drop-cap rule (a layout fact; Apple's OCR dropped two lines beside a drop cap in the 5-page test).

## Evaluation (Step 7)

Both versions were read on 17 pages of *The Pay Off*, twice each, on the subscription, with effort `high`, by `scripts/eval-transcribe-prompt.ts`. The pages were:

- the 5 with a checked answer key;
- the 4 pages that went wrong (23, 45, 213, 358);
- part pages and chapter openings;
- 4 Sources pages;
- the index.

| | Current | Audited |
|---|---|---|
| Readings | 34 | 34 |
| Failed or declined | 0 | 0 |
| Flagged by the page check | 4 | 4 |
| Words wrong against the checked text | 0 of 2,280 | 0 of 2,280 |
| Headings as expected | 26 of 28 | **28 of 28** |

The current version read page 358 as "# Chapter 16" both times. Chapter 1's number and PART II's level, wrong in the whole-book run, came out right in this run's two tries: those faults come and go.

Page 213 was also read 10 times with each version: neither declined. The refusal is rare (once in 360 pages), so this evaluation cannot show whether the owner-and-purpose context prevents it. That line is kept because it costs nothing and lost nothing here; its effect on refusals is **not measured**.

The audited version is kept. It fixes the heading fault and loses nothing measured. Results (book text, outside git) are in `~/Documents/neolibrary-text-edition/payoff-eval/`.

## What follows from changing the instructions

Their fingerprint changes. The live server refuses pages read with other instructions than its own, so:

1. Deploy the new instructions before sending pages read with them.
2. The pages of *The Pay Off* already on the site stay as they are (they were read with the old instructions and checked).
3. Pages read again later use the new instructions.

## Second round: a note carried over to the next page

A first-time user tested the skill (below) and found paragraphs that open mid-sentence. Looked at against the scan, two were notes carried over from the page before: the foot of page 150 ends footnote text begun on page 149, and the same happens on page 287. Claude had written them as ordinary paragraphs, which broke the main text around them; the instructions had no rule for them.

The new rule asks for a carried-over note as `[^0]: text`, and the builder ends the previous note with it. The same 19 pages were read twice with each version, those two pages included:

| | Audited | Audited + carried-note rule |
|---|---|---|
| Readings | 38 | 38 |
| Failed or declined | 0 | 0 |
| Flagged by the page check | 4 | 4 |
| Words wrong against the checked text | 0 of 2,280 | 0 of 2,280 |
| Headings as expected | 27 of 28 | 28 of 28 |
| Carried-over notes written as `[^0]` | 0 of 4 | **4 of 4** |

The rule is kept.

## The skill, tested by a first-time user

A fresh Claude session was given only the skill and Samuel's request: "check The Pay Off's text edition is ready to send". It was not allowed to send or read again. It met every item of the quality bar it could check here. It found six faults the lists did not cover; each is now fixed or covered:

- **Page markers out of order, and the cover's last line run into page 3:** a paragraph carried on across a blank page. Fixed in the builder; a paragraph never carries on across a blank page.
- **Sentences cut by a table** (pp. 165–166, 211–212), by a figure at the top of a page (p. 72), by a whole page of table (pp. 51–52), or ending on ";" (p. 48). Fixed in the builder: a page that opens mid-sentence carries on the last unfinished paragraph, past tables, figures and their title and source lines.
- **What is left after that.** `preview` now lists paragraphs that open mid-sentence. On *The Pay Off*, that was two carried-over notes (fixed above) and a printed block quote, which is right.
- **The check's numbers unexplained, and no reason recorded.** `check` now says why each page is flagged.
- **No way to see a page's text beside its picture.** Fixed: `pictures --from`.
- **Others.** No rule for sampling unflagged pages; the `[?]` marks left unmentioned; the token not loading in step 1; the preview's About page without the pages to check; stale figures in `page-check.ts`. All fixed.

It also noticed a library's barcode stamp on the scan's title and back pages. Whether the file is Samuel's to keep is his call; the skill now says to tell him when a scan shows such a sign.
