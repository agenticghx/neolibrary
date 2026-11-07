---
name: figures-on-subscription
description: Redraw a paper's figures cleanly in Samuel's Neolibrary (M41 R6) on his Claude subscription, on the laptop. Each redraw is checked against the printed figure, every passed one is looked at by eye, then they are sent to the live site and checked there in Chrome and on an iPad-sized Safari engine. Use when Samuel asks to redraw, remake or clean up a paper's figures, when a redrawn figure looks wrong or broken, when Aa > Figures is missing on a paper that should have redraws, or when the redraw instructions or checks change.
---

# Figures redrawn on the subscription

Written for Claude sessions working on Neolibrary (`agenticghx/neolibrary`, public). Samuel, the owner, is a scientist: tell him in plain English what was redrawn, what was kept as printed and why, and what was checked.

## What this makes

A paper's scanned figures are often blurred and heavy. A **redraw** is the same figure drawn again as a clean SVG (a drawing made of lines, shapes and real text): the same boxes, axes, tick marks, curves, data points and words in the same places. It is never a new picture. The reader shows it in place of the printed figure, labelled "Redrawn by AI from the paper's figure · tap it to compare". **Aa > Figures** (Redrawn / As printed) switches back, and the full-screen view has **Show the original**.

A redraw is shown only when every check agrees it is the same figure; otherwise the printed figure stays. On Greco 1995 (2026-11-07) that was 4 of 33. Most figures stay as printed, and that is the design, not a fault.

The redrawing runs on the laptop with `claude -p` on Samuel's subscription ($0). `scripts/figures-on-subscription.ts` does it, figure by figure:

1. **Read the words twice.** Opus and Sonnet each read the figure's words (`prompts/figure-transcribe.md`). They must agree word for word, capitals included; a third reading breaks a tie. A photograph, shaded surface or dense mesh is kept as printed.
2. **Draw.** Opus draws an SVG using exactly those words (`prompts/figure-redraw.md`).
3. **Check the drawing** (`lib/library/figure-redraw.ts`). It must:
   - hold only plain drawing elements (`checkSvg`);
   - use exactly the words read (`wordDiff`);
   - lie over the figure when both are drawn into pixels (`compareInk`). Lines are thinned to one pixel and compared both ways. No missing piece of 3 px or more counts: a tick mark does, a dust speck or the paper's wider lettering does not. Nothing may be added.
4. **Second look.** Sonnet lists any difference in content between the two pictures.
5. **Marker check.** Opus lists every data point's symbol in both pictures (`prompts/figure-markers.md`). Filled and open must match. A marker the print doesn't show for certain keeps the printed figure: thinning lines can't see fill.
6. **Correct.** A problem goes back to Opus with a picture of where it is, at most three times.

The site stores each redraw as a `generations` row (kind `figure-redraw`; no migration). Before storing it, the server checks the redraw again against the book's own file: that picture's bytes, at that place in that chapter.

## Rules that bound everything

- **Subscription only.** Never call the Anthropic API for this, and never set `ANTHROPIC_API_KEY`; the script removes it from `claude -p`'s environment. If the subscription limit is reached, stop and say when it resets; never switch to the API.
- **Never edit a redraw by hand, and never loosen a check to get a figure through.** A figure that fails keeps its printed picture. To hold one back after looking at it, move its files aside (step 5); to try again, redraw it again.
- **Look at every passed redraw before sending.** The checks have missed things before, so a person's look is part of the method. Filled versus open circles slipped past the first four checks on Greco's Figure 14, which is why step 5 exists.
- **No paper's figures in git.** The figures and their redraws are the paper's, and copyrighted. Keep the working folder outside the repository, and don't paste figures, redraws or the sheet into a pull request. Tests use invented pictures.
- **Keys by name only.** The owner's API token is the Keychain item `NEOLIBRARY_AGENT_TOKEN` (`keyls` shows it). Never print it, and never ask Samuel to paste it. If it is missing, ask him to make one at /agents and run `keyadd NEOLIBRARY_AGENT_TOKEN` in Terminal.
- **The live site's address is not written in docs** (the repository is public). It is in the ledger's deploy entries.
- **Deploy only when code or instructions change.** Sending redraws needs no deploy. A change to `prompts/figure-transcribe.md` or `prompts/figure-redraw.md` does: the server refuses redraws made with other instructions than its own. `prompts/figure-markers.md` is a gate on the laptop only.

## The workflow

`S=scripts/figures-on-subscription.ts`, and `<folder>` is a working folder outside the repository, one per paper. Every command runs from the repository root. On the laptop the token loads from the Keychain only in a login shell, so run anything that uses it through `zsh -ic '…'`.

1. **Find the paper and its id** with the token:
   ```bash
   zsh -ic 'curl -s -H "authorization: Bearer $NEOLIBRARY_AGENT_TOKEN" "<site>/api/agent/books?q=<title>"'
   ```
   Only an EPUB's figures can be redrawn. A Markdown paper uploaded as a `.zip` with its pictures (M41 R2) is one.
2. **Download its book file**, the very file the site holds, so the picture fingerprints match:
   ```bash
   zsh -ic 'curl -s -o <folder>.epub -H "authorization: Bearer $NEOLIBRARY_AGENT_TOKEN" "<site>/api/agent/books/<book id>/file"'
   ```
3. **Try two figures first**, then look at them (step 5) before running the rest:
   ```bash
   npx tsx $S redraw <folder>.epub <folder> --only p1,p2 --jobs 2
   ```
   Figure keys are the picture file names without extension (`images/p1.png` is `p1`). Then run the whole paper in the background and watch its log:
   ```bash
   npx tsx $S redraw <folder>.epub <folder> --jobs 3 > <folder>-run.log 2>&1 &
   ```
   - Each figure gets one line: `redrawn (passed after N corrections)` or `kept (why)`, then the time and the number of calls.
   - A simple figure takes 2 to 5 minutes. A dense one can take an hour and still fail. Greco's 33 took about 2 hours with 3 at a time.
   - Stopped part-way, the same command carries on: a figure already done with the same instructions and picture is skipped. A line `FAILED …` (a declined or cut-off answer, or the limit reached) is not recorded, so running again retries it.
4. **Marker check on older redraws.** This step is needed only if some redraws in `<folder>` were made before the marker check existed (it runs inside `redraw` now). It costs one call per redrawn figure:
   ```bash
   npx tsx $S recheck <folder>.epub <folder>
   ```
5. **Look at every redrawn figure.** Run `npx tsx $S sheet <folder>` and open `<folder>/sheet.html`. Each row shows the figure, the redraw, and the check (the figure in grey; red where the redraw lacks something, orange where it adds something, green where it put words where the figure has none). For each redrawn one, compare against the printed picture at full size:
   - every word and number, and capitals;
   - every data point's symbol: filled or open, its shape;
   - tick marks on all four sides;
   - arrowheads, dashed versus solid lines, error bars, and legend entries.

   To hold a figure back, move its `.json` and `.svg` into `<folder>/held/`; `send` reads only the folder itself. Say why in the ledger.
6. **Send the redraws that passed:**
   ```bash
   zsh -ic 'npx tsx scripts/figures-on-subscription.ts send <folder> <site> <book id>'
   ```
   It prints `{"saved":N,"figures":N}`. Sending again stores nothing new (`saved: 0`). Only figures that also passed the marker check are sent.
7. **Check it live.** Use a browser session signed in as Samuel; the password is the Keychain item `NEOLIBRARY_PASSWORD`, never printed. Check in Chrome at desktop size **and in WebKit at iPad size** (1366×1024; Playwright's `webkit`). Samuel reads on an iPad, and every iPad browser is WebKit.
   - Open the paper and go to a redrawn figure. Its `<img>` must be loaded (`naturalWidth > 0`), its `src` a `blob:` address equal to `data-nl-redraw`, and the label under it must show.
   - Aa > Figures must say how many figures are redrawn; As printed shows the scan with no label.
   - Tap the figure: the full-screen view names the model and has Show the original.
   - **Before**, note the paper's saved place (`books.position`, `progress`) and the latest sitting ids. **After**, write the place back exactly, and delete any sitting the check logged, by id. A test screen's pages break differently from his iPad's, so the check moves his place by a screen or so.
8. **Record it in the ledger.** Include the paper; how many figures were redrawn and which; how many were kept, by reason; what was held back by eye and why; and the live check's result. Never include figures or text from the paper.

## Reading the results

| `kept` because | What it means | What to do |
|---|---|---|
| not line art | A photograph, shaded surface or dense mesh | Nothing: it can't be drawn again line for line |
| the readings of its words disagree | The scan's words are unclear | Nothing; a better scan of the paper is the only fix |
| still differs after 3 corrections, few pieces | A near miss: often a real omission (an arrowhead, a dash pattern, a zigzag), sometimes bold lettering touching a line | Look at `<key>-check.png`. To try again, delete its `.json` and rerun with `--only <key>` |
| still differs, many pieces or a large share | The drawing is far off: dense curves, many panels | Nothing for now |
| the marker check | Filled or open can't be told for certain in the print, or the redraw got one wrong | Nothing: a guess would mislead the reader |

## What can go wrong

- **`401` from `send`:** the token is missing or revoked (/agents).
- **`made with other instructions` from `send`:** the site's prompts differ from the laptop's. Deploy the prompt change first, or redraw with the deployed instructions.
- **`made from another picture` from `send`:** the paper's file on the site changed since `<folder>.epub` was downloaded. Download it again and redraw.
- **The subscription limit is reached:** stop. The run carries on from where it stopped when started again after the reset.
- **A redrawn figure shows as a broken picture:** check where the picture is fetched from.
  - On 2026-11-07, WebKit sent the book page's picture requests without the sign-in cookie, so every redraw was a `401` on an iPad. The reader now fetches each redraw from its own page and hands the book page a `blob:` address; `e2e/safari.spec.ts` "a paper's redrawn figure loads in Safari" guards this.
  - While a fix is made, take the redraws off the live site: delete that paper's `figure-redraw` rows from `generations`, by id (CLAUDE.local.md says how to reach the live database). The printed figures come back at once, and the redraws stay in `<folder>` to send again later.
- **Aa > Figures is missing:** the paper has no stored redraws (nothing was sent), it is not an EPUB, or the reader is on another of the owner's copies of it. Readers a paper is shared with see the owner's redraws.
