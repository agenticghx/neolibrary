# WebKit read-along flakes on CI: plan to remove them

**Written for:** the engineer (a Claude session) who implements this next, starting from `origin/main`. Samuel reads it through the ledger; the decisions he has to make are in §3.

**Rules this plan keeps:**
- The 100 ms limit never changes.
- Each step removes a cause.
- Each independent fix gets its own small PR.
- Each fix has a check that fails without it, plus results from several CI runs. One run proves nothing.

**Sources:** four read-only analyses (pdfjs, bar, measure, other). I re-checked them against the repo, the CI logs and the saved recordings; the commands are below. Repo paths are relative to `/Users/sahuno/projects/personal/Neolibrary`. This run changed no repo file, so it owes no ledger entry.

**Copy these files first.** The analyses' code and data sit in this session's scratchpad, which can disappear: `S=/private/tmp/claude-503/-Users-sahuno-projects-personal-Neolibrary/2fb5c526-83b9-4fe4-a979-0bce0d6c44e4/scratchpad`. Copy them into the step's branch, or attach them to its PR.

| File | Used by |
|---|---|
| `$S/timing-measurement.patch` (966 lines, sha1 `3a03d53ef178f28fd3c9cf671e9aeca437928fb2`) | step 1 |
| `$S/barfix/{Reader.tsx,ListenBar.tsx,listen.ts}` (full files) | step 2 |
| `$S/tscheck/warmup.diff` | step 3 |
| `$S/flake/{main,pr75a1,t727-11340168070}-recording.json`, `$S/flake/words.json`, `$S/plan-logs/replay.py` | step 2's replay |
| `$S/flake/logs/`, `$S/plan-logs/*.log`, `$S/wk/` (WebKit and GStreamer sources) | evidence for §1 |

**Terms**
- **Main thread:** the page's single thread for scripts, layout and painting. While it is busy, nothing on screen changes.
- **Frame:** one screen refresh, about 16 ms. A *frame callback* (`requestAnimationFrame`) runs just before each one.
- **Task:** one unit of main-thread work. React writes a state change into the page in a separate, later task.
- **Highlight:** the tint on the spoken word inside the page (CSS Custom Highlight). It is what the reader sees.
- **`data-word`:** a hidden attribute on the Listen bar that holds the spoken word. Only tests read it.
- **System-font lookup:** pdf.js asking the browser for an installed font by name (`local(…)`), for a font the PDF does not carry.
- **GStreamer:** the media library that Linux WebKit plays audio with. Safari on a Mac or an iPhone uses Apple's own instead.
- **Dispatch:** a GitHub Actions workflow started by hand (`workflow_dispatch`). It can only be started once it exists on `main`.
- **Near miss:** a word 80-99 ms late.
- **Rule of three:** 0 failures in n runs puts the true failure rate below 3/n, with 95% confidence.

## 1. What is known

**CI record.** I checked every CI run from 2026-10-05 10:39 to 2026-10-06 08:34 UTC in which `readalong-safari` (the WebKit project) ran: 20 runs.
- **`:1123` (PDF page break):** ran 17 times. 11 passed and 6 failed (35%).
- **The six failures:**
  - "most" (word 51): 109 ms (run 37384682044), 116 (37392862541 attempt 1), 112 (37397581699), 100 (37399604844 attempt 1), 112 (37402614403).
  - "of" (word 110): 105 ms (37304452844).
- **Passing runs:** the logged "first word lit" times were 24, 27, 29, 37, 56, 77, 77, 79, 82, 89 and 91 ms. These are upper bounds: that log line also waits for React's `data-cfi` (`e2e/readalong.spec.ts:1182`). Chromium: 9-29 ms.
- **`:727`:** failed 2 of the 19 runs in which it ran. **`:241`:** failed 1 of 20.
- **New since the analyses:** run 37435021391 passed, at 27 ms.

```
grep -hE '"[^"]+" \(word [0-9]+\) shown [0-9]+ ms' $S/flake/logs/*.log   # failure lines
grep -hE 'page 2 shown' $S/flake/logs/*.log    # per run: 1st line Chromium, 2nd WebKit (printed only when the test passes)
gh api repos/sahuno/neolibrary/actions/jobs/<id>/logs   # 37399604844 a1+a2, 37402614403, 37433148408, 37435021391
```

### S1 · `:1123`, Listen bar: "most" 100-116 ms late (5 of 17 runs) → steps 2 and 3, decision D1

**Cause.** The visible highlight was on time: 30.5 ms and 47.0 ms late. The bar's hidden `data-word` trailed it by 2 frames, for two reasons:
- **React writes it in a later task.** `data-word` is React state (`app/(reader)/books/[id]/read/ListenBar.tsx:62`, rendered at `:459`).
  - `setWord` (`:308`) runs in a frame callback, so it gets the default priority, 32 (`node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js:962-967`).
  - That priority gets its own task (`:13447-13473`): the scheduler posts a message (`node_modules/next/dist/compiled/scheduler/cjs/scheduler.production.js:197-203`).
- **At a PDF page break, the bar's first try returns null.** Page 2's frame or its text layer is not ready yet (`Reader.tsx:697-712`; `lightPdfWord` at `:145-146`).
  - Reader's text-layer listener then lights the word itself (`Reader.tsx:365-368`) and does not tell the bar.
  - #75's recording shows this: the bar's paragraph changed at frame 551, but its word stayed "in" until frame 553.
- **Both waited behind a main-thread block right after the page turn.** Frames were 49 and 62 ms apart on `main`, and 40 and 48 ms apart in #75.

**What blocked the main thread.** Page 2 is the first page to use Times-Italic, and the test PDF does not carry that font (`e2e/readalong.spec.ts:966-967`).
- `useSystemFonts` is on by default (`node_modules/pdfjs-dist/legacy/build/pdf.mjs:21785`). So one `FontFace.load()` call (`pdf.mjs:14172-14175`) tries 16 installed-font names. The pdfjs analysis got that count by running pdf.js's own substitution code.
- On CI's Linux, all 16 fail, each one a fontconfig search (WebKit FontCacheFreeType.cpp:367-437, per the pdfjs analysis).
- pdf.js then logs `Cannot load system font: Times-Italic` (`pdf.mjs:14179`). In both recorded runs that line falls inside the longest frame.

**Confidence.** High for the bar's lag. Medium that the font lookups are the block: they end inside it, but their own length is not isolated (at most 58 ms and 41 ms, per the pdfjs analysis).

### S2 · `:1123`, Listen bar: "of" (word 110, mid-page 2) 105 ms late (1 of 17, run 37304452844)

No trace was kept, and the cause is unknown. If it was React's late write, step 2 removes it. Confidence: low.

### S3 · `:727`: "was" (word 1) 117 ms late (1 of 19, run 37296828074)

- This is an EPUB whose audio starts 640 s in. The screen froze for 106 ms once, right after the seek, between the seek request's last byte and GStreamer's go-back request.
- **Cause:** unknown.
- **Untested hypothesis:** GStreamer's on-disk mode, whose 200 ms buffer-level timer runs on the main thread (`$S/wk/MediaPlayerPrivateGStreamer.cpp:2579-2582`).
- **Confidence:** low. Re-measure after step 4.

### S4 · `:727`: audio stalled 45 s and `playUntil` timed out (`readalong.spec.ts:463-464`) (1 of 19, run 37348223223) → step 4

M13's earlier stall had the same request pattern (run 37260648155, `docs/learning-loop-2026-10-05.md`, Phase 4, item 17).

**Cause.** Headless Playwright WebKit on Linux is WebKit's WPE build (`$S/wk/pw_run.sh:32-34`), and it plays audio through GStreamer.
- After `play()`, GStreamer copies the whole audio file into a temporary file on disk.
- After a far seek, it asks again for the bytes it skipped. The requests were:
  1. no range;
  2. `bytes=7348224-`;
  3. `bytes=10247084-` (the seek);
  4. `bytes=7348224-` again.
- Playback stopped although the bytes it needed had arrived. The server answered every open-ended request in full (`lib/http-range.ts:50`).

**Confidence.** Medium. The pattern is in both `:727` traces, but it was not reproduced. It is unknown whether WebKit paused to buffer or GStreamer froze.

### S5 · `:241`: `setInputFiles` never returned although the page said "Done." (1 of 20, run 37392862541 attempt 2) → step 5

The call hung until the 2-minute test timeout. This is also M13's unexplained hang (`docs/learning-loop-2026-10-05.md` §E.7).

**Cause.** Playwright 1.56.1 starts listening for the `input` event only after it has handed the folder over (`node_modules/playwright-core/lib/server/dom.js:566-571`). WebKit lists the folder in the background and can fire `input` before that listener exists.

**Confidence.** Medium-high: source code plus trace, not reproduced.

### Re-derived in this run

The saved CI recordings, replayed:
```
$ python3 $S/plan-logs/replay.py $S/flake
main-recording.json   words bar/lit 117/117, bar−lit frame diff {0: 116, 2: 1}: word 51 'most' bar frame 553, lit 551
                      word 51: bar 111.6 ms late, highlight 30.5 ms; frame gaps ... 16, 49, 62, 14, 39
pr75a1-recording.json words 117/117, {0: 116, 2: 1}: word 51 'most' bar 553, lit 551
                      word 51: bar 116.1 ms late, highlight 47.0 ms; frame gaps ... 29, 40, 48, 21, 38
t727 (run 37296828074) words 213/213, {0: 212, 1: 1}: word 10 'and' bar 106, lit 105; largest frame gap 106 ms
```
Highlight lateness over all 117 words: median 25.4 / 27.3 ms, maximum 47.6 / 47.0 ms.

The fonts, for decision D1 (the 4th column, "emb", says whether the font is embedded):
```
$ pdffonts fixtures/books/descartes-meditation-one.pdf
Times-Roman                          Type 1            WinAnsi          no  no  no       4  0
$ pdffonts ~/projects/sandbox/Kuhn-SSR-2ndEd.pdf      # 222 pages (docs/m13-player-plan.md:353 counts Kuhn at 222)
NEMMEJ+GammaITCStd-Medium            Type 1C           Custom           yes yes yes    717  0
NEMMGJ+GammaITCStd-Book              Type 1C           Custom           yes yes yes    718  0
NEMMHK+GammaITCStd-MediumItalic      Type 1C           Custom           yes yes yes    729  0
Arial                                TrueType          WinAnsi          no  no  no     669  0
NEMMLJ+MercuryTextG1-Roman           Type 1C           Custom           yes yes yes    670  0
NEMNBK+GammaITCStd-BookItalic        Type 1C           Custom           yes yes yes    678  0
per-page loop (pdffonts -f p -l p, p = 1..222, grep '^Arial ')  →  pages using Arial: 1 (first: 3)
```
Kuhn's extracts (`Kuhn-SSR-2ndEd_p21_p222.pdf`, `_p12_p20.pdf`) embed every font.

## 2. Steps

**How every step works**
- **Branch:** start from the current `origin/main` (8cd0b49 today; #78 may have merged since) and use the branch name given. The auto-merge Action takes branches whose names start with `m`.
- **One PR per step.** Each PR carries a `PROGRESS.md` Log entry (CI's hygiene job requires one), a `LEARNING_LOG.md` iteration, and its evidence pasted in.
- **Self-merge** only when every check is green and no check was weakened.
- **Order:**
  - Step 1 comes first. Its workflow must be on `main` before it can be dispatched, and both sides of every comparison need its timing marks.
  - Prepare steps 4 and 5 while step 1's CI runs; they do not need it.
  - Steps 2-5 do not depend on each other. Rebase on `main` between merges.
- **Comparison:** parent and candidate always run in the same dispatch:
  `gh workflow run timing-samples.yml -f refs="main <branch>" -f machines=3 -f repeats=10`
  That is 30 runs each, about 10 minutes, and about 50 runner-minutes (the measure analysis's estimate). The table appears in the run's Summary.
- **Counting rule, fixed in advance:**
  - Today's `:1123` failure rate is 6 in 17.
  - 0 late in 30 runs puts the rate below 10% (rule of three). Against 6 in 17, that gives p = 0.0012 (Fisher's exact test, one-sided).
  - Calling a cause "removed" needs 0 in 60 runs, or a week of ordinary CI (harvest command at the end of this section).

### Step 1 · Measure, change no check (`m14-flake-a-measure`)

**Change.** Run `git apply $S/timing-measurement.patch`. `git apply --check` passed on 1902338, whose copies of these files are identical to `origin/main`'s.

What the patch adds:
- `lib/perf-marks.ts`: named time marks. They are off unless `window.__nlMarks` is set, so readers pay only one property read.
- Marks in `pdf-book.ts`, `Reader.tsx` and `ListenBar.tsx`.
- In `e2e/listen.ts`:
  - `instrument()`, which wraps `FontFace.prototype.load` to record each font load and how long it held the page.
  - New recorder columns: the recorder's own cost, a sample after each paint, and each write of `data-word`, `data-passage` and `data-cfi`.
  - `reportTiming()`, which prints `TIMING_JSON` and attaches a file before any check runs.
- At `:1123`: `instrument()` before the reader `goto` (`:1161`), and `reportTiming()` after `recording()` (`:1171`).
- New files: `playwright.timing.config.ts`, `scripts/timing-summary.mjs` and `.github/workflows/timing-samples.yml`.

**Two edits before committing:**
1. **Delete the opt-in `timing` option of `expectEveryWordOnTime`** (the patch's "Phase B": the `source`, `byClock` and `Math.max` lines). Keep `clockAt`, `writtenFrames` and `wordTimings`, because the report uses them.
   - Proof that no check changed: `git diff origin/main -- e2e | grep -E '^[-+][^-+].*expect\('` must print nothing.
2. **Add a workflow input `tests`** (a regular expression, default `on across a page break`), passed to `--grep` in both shapes.
   - This lets `:727` and `:241` be sampled with `-f shape=suite`.
   - The quick shape cannot run them: they use the Jekyll book that earlier projects upload (`readalong.spec.ts:729`, `:247-248`).

**Local checks:**
- `npm run check`.
- `npx playwright test -c playwright.timing.config.ts --list --repeat-each 3` should list 1 setup test and 3 timing tests, without starting a server.
- One local `readalong-safari` run of `:1123`. Port 3100 is shared, so coordinate first. Confirm three things:
  - WebKit keeps each mark's `detail`. If not, put the page and word into the mark's name.
  - `afterLate` is about 0.
  - An italic font load appears in the timeline.

**After it merges:**
- Baseline: `gh workflow run timing-samples.yml -f refs=main -f machines=3 -f repeats=10`.
- Once with `-f shape=suite -f machines=1 -f repeats=5`. Trust the quick shape only if its medians agree with this run within one frame.
- Once with `-f trace=off`, to measure what Playwright's trace costs.

**Done when.** `LEARNING_LOG.md` has the baseline, recorded as "measurement, no fix", with these columns:
- late (100 ms or more) and near-miss counts;
- the frame difference between the bar and the highlight;
- the gap between lighting a word and writing `data-word`;
- how long each font load held the page (the first direct measurement of the lookups);
- the longest frame in the 300 ms after the turn.

The baseline must show the problem: 3 or more near misses or failures in 30. If it does not, add machines.

### Step 2 · The reader records the word it lights (`m14-flake-b-bar`)

This removes both reasons for S1's bar lag. It also stops the whole bar re-rendering on every spoken word. The full files are in `$S/barfix/`; the bar analysis reports eslint and tsc exit 0 on them.

**`app/(reader)/books/[id]/read/Reader.tsx`**
- After `lightPdfWord` (`:150`):
  ```ts
  /** Records the word read aloud on the Listen bar (data-word: read by tests, shown and announced nowhere) in the same step as it is lit, wherever it is lit; a word already recorded is not written again. */
  function recordLit(bar: HTMLElement | null, text: string | null) {
    if (bar && text !== null && bar.getAttribute("data-word") !== text) bar.setAttribute("data-word", text);
    return text;
  }
  ```
- `const listenBar = useRef<HTMLDivElement>(null);` beside `spokenPdf` (`:213`).
- Wrap all three places that light a word:
  - `:367` → `recordLit(listenBar.current, lightPdfWord(doc, w.at))`
  - `:698` → `return recordLit(listenBar.current, lightPdfWord(doc, inPage))`
  - `:743` → `return recordLit(listenBar.current, range.toString())`
- `:892` → `<ListenBar ref={listenBar} …>`.

**`ListenBar.tsx`**
- `:3`: also import `type Ref`.
- Add a prop `ref?: Ref<HTMLDivElement>` (`:36-54`). React 19 passes `ref` to function components.
- Delete the `word` state (`:62`) and both `setWord` calls (`:308`, `:321`). Keep the `=== null` early returns.
- `:459` → `<div ref={ref} … data-passage={passageCfi}>`, with no `data-word`. Add a comment that the reader writes it; two writers would fight.
- Until the first word is lit, `data-word` is absent rather than `""`. Every reader of it copes (`listen.ts:22`, `:95` use `?? ""`; `e2e/audio.spec.ts:124-125`).

**On top of step 1.** Step 1's `mark("nl:bar-set")`, which sits after `setWord` (`ListenBar.tsx:301-321`), moves into `recordLit`, firing only when it writes. The recorder's attribute watcher still sees every write.

**`e2e/listen.ts`**, after the `due` line (`:137`):
```ts
  // The bar records each word in the same step as the book lights it (Reader.tsx, recordLit): both change on the same frame.
  const lit = changes(frames, 3);
  changes(frames, 1).forEach((s, i) =>
    expect({ word: s.value, frame: s.at }, `bar: "${s.value}" (word ${i}) recorded on another frame than the book lit it`).toEqual({ word: lit[i]?.value, frame: lit[i]?.at }),
  );
```
- It runs at all 7 calls of `expectEveryWordOnTime` (`readalong.spec.ts:554, 618, 642, 680, 715, 748, 1176`), in both engines.
- It must ship in this same PR: on `main` it fails whenever React's write lands a frame late.

**Checks that fail without it:**
- **Deterministic, on CI data:** the new check, replayed on the three saved recordings, fails all three (§1: word 51 twice, word 10 once).
- **Live, from step 1's data:** the per-word gap between lighting a word (`nl:lit`) and the `data-word` write. Without this step, most words show React's separate task. With it, every word should be under 2 ms.
- **Not proof:** a local mutation run on the Mac. React usually writes before the next frame there, so the check can pass without the fix.

**CI runs:** the same-dispatch comparison, plus the PR's own CI. These also read `data-word`, so they must stay green:
- `expectHighlightKeepsUp` (`listen.ts:11-47`, in the `audio` project);
- the polled checks at `readalong.spec.ts:587, 1201, 1290, 1344`.

**Fixed when:**
- The candidate has 0 bar failures and 0 same-frame failures in 30 runs.
- The lighting-to-write gap is under 2 ms on every word.
- The whole suite is green.

The highlight check is unchanged and stays the judge of what the reader sees. Count its late words separately; if they cluster at the turn, step 3 is next. This step does not make the visible check stricter (step 6 does).

### Step 3 · Draw the next PDF page ahead (`m14-flake-c-pdf-warmup`)

This moves S1's block off the turn. Page N+1's fonts are now first loaded just after page N's picture appears. The cost is relocated, not removed (see §4).

**Change** in `lib/reader/pdf-book.ts`, from `$S/tscheck/warmup.diff`. The pdfjs analysis checked that it type-checks; it has not been run in a browser.
```ts
// after `unexpected` (:92-94)
const warmed = new Set<number>();
let warmingUp = false;
let closed = false;
const warmUp = (pageNumber: number) => {
  if (closed || warmingUp || pageNumber > pdf.numPages || warmed.has(pageNumber)) return;
  warmed.add(pageNumber);
  warmingUp = true;
  setTimeout(async () => {
    const canvas = document.createElement("canvas"); // the top document: pdf.js registers fonts there (see :140)
    try {
      if (closed) return;
      const page = await pdf.getPage(pageNumber);
      if (closed) return;
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 128 / Math.max(width, height) });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (context) await page.render({ canvas, canvasContext: context, viewport }).promise; // none: the turn loads the fonts, as today
    } catch (e) {
      unexpected(e); // closing the book cancels it
    } finally {
      warmingUp = false;
      canvas.width = canvas.height = 0;
    }
  }, 0);
};
```
- `warmed.add(pageNumber)` after `fetchTextOf(pageNumber + 1)` (`:131`).
- `warmUp(pageNumber + 1)` once the picture is in place (`:167`; on top of step 1, after `mark("nl:draw-done")`).
- `destroy` sets `closed = true` before calling `task.destroy()` (`:226`).
- Marks `nl:warmup-start` and `nl:warmup-done`. Add both to `MarkName` in `lib/perf-marks.ts`.

**Why `render()` and not `getOperatorList()`.** `render()` shares the real drawing's cache key, which ignores scale (`pdf.mjs:22824-22827`). So the turn reuses the drawing instructions it keeps (`:22206-22216`). `getOperatorList()` sets another flag (`:22318`), so the page would be built twice.

**Don't:**
- Call `page.cleanup()` or `pdf.cleanup()` afterwards. They drop the kept instructions and the loaded fonts (`pdf.mjs:23296`).
- Keep the canvas, move it into a page, or pass a page frame's document as `ownerDocument`.
- Build page N+1's text layer in another document (`pdf-book.ts:125-127`).
- Pre-open foliate's next frame.
- Draw ahead at full size: about 7 MB per canvas on an iPhone (pdfjs analysis).
- Install fonts on CI instead. It would not help: WebKit on Linux accepts only family names, and names like "Liberation Serif Italic" are full names (pdfjs analysis).

**Test that fails without it.** Add to `:1123`, after `reportTiming`: no font may load between page 2's turn request and its first lit word. Pages are counted from 0 (`data-page`, `pdf-book.ts:181`), so page 2 is 1.
```ts
const turnAt = rec.marks.find((m) => m.name === "nl:turn-request" && m.detail?.page === 1)?.t;
const litAt = rec.marks.find((m) => m.name === "nl:lit" && m.detail?.page === 1)?.t;
expect(turnAt !== undefined && litAt !== undefined, "page 2's turn and first word were marked").toBe(true);
expect(rec.fonts.filter((f) => f.t0 >= turnAt! && f.t0 <= litAt!), "a font was loaded at the page turn").toEqual([]);
```
- Without the warm-up, pdf.js loads page 2's italic font at the turn in every run, in both engines: it loads a font on first use, whether or not the lookup succeeds.
- In `main`'s trace the warning came 9 s after Play (Play at 870031, warning at 879032; pdfjs analysis), which is at the turn.

**CI runs:** the same-dispatch comparison.

**Fixed when:**
- The new check passes in 30 of 30 runs, and step 1's timeline for the parent shows the italic load inside that window in every run.
- The longest frame in the 300 ms after the turn is lower than the parent's at both the median and the 90th percentile.
- 0 late in 30.
- Page 1's first five words are no later than the parent's (median within 5 ms). This shows the stall did not move into the start of playback.

### Step 4 · CI's WebKit without GStreamer's on-disk mode (`m14-flake-d-gstreamer`)

This removes S4's cause, on CI only (decision D2).

**`playwright.config.ts`**, after `:13`:
```ts
/** Playwright's headless WebKit on Linux (WPE) plays audio through GStreamer, which after play() copies the whole file to disk and, after a far seek, goes back for the bytes it skipped; WebKit's own code calls that mode deadlock-prone. CI run 37348223223 stalled 45 s right after such a request. Safari on a Mac or an iPhone never uses it. */
const noMediaDiskCache = { env: { ...process.env, WPE_SHELL_DISABLE_MEDIA_DISK_CACHE: "1" } };
```
- Line `:87` becomes `use: { ...desktop, browserName: "webkit", launchOptions: noMediaDiskCache }`. Playwright's `env` replaces the whole environment, hence the spread.
- WebKit reads this variable on WPE only, in `isMediaDiskCacheDisabled()` (`$S/wk/MediaPlayerPrivateGStreamer.cpp:3452-3467`, from WebKit `main`). CI's Playwright build may differ.

**`e2e/readalong.spec.ts`**, after `:746`:
```ts
console.log(`[${test.info().project.name}] audio requests: ${answers.map((a) => `${a.asked ?? "no range"} → ${a.status}`).join("; ")}`);
// Linux WebKit asks only open-ended ranges: after the seek far into the file, nothing may go back for skipped bytes.
if (test.info().project.name === "readalong-safari" && answers.every((a) => a.asked === null || /^bytes=\d+-$/.test(a.asked))) {
  const starts = answers.map((a) => Number(/^bytes=(\d+)-$/.exec(a.asked ?? "")?.[1] ?? -1));
  const seek = starts.findIndex((s) => s >= 8 * 1024 * 1024);
  expect(seek, "a request far into the file").toBeGreaterThanOrEqual(0);
  expect(starts.slice(seek + 1).filter((s) => s >= 0 && s < starts[seek]), "a request went back for skipped bytes").toEqual([]);
}
```
Also replace `playUntil` (`:463-464`) with the other analysis's diagnostic version. On a timeout it prints `readyState`, `paused`, `buffered` and the audio's recorded events:
- `readyState` 2 with a `waiting` event means WebKit paused to buffer.
- `readyState` 4, not paused, no `waiting` means the media pipeline froze.

**Check that fails without it.** Both `:727` traces show the go-back request: `bytes=7348224-` (or `6914048-`) after `bytes=10247084-`. This check is also the only proof that the variable reaches WebKit's web process. If the PR's first CI run still shows a go-back request, withdraw the step.

**CI runs:**
- Every ordinary CI run checks the request pattern once.
- Optionally: `-f shape=suite -f tests='far into its file' -f machines=3 -f repeats=5`. Try `--repeat-each 2` locally first, since each repeat imports another reading.

**Fixed when.** The pattern check passes in the PR and in every later run.
- The stall's rate (2 in 19) cannot be shown to be lower soon: 0 in 20 only puts it below 15%. Keep harvesting.
- Whether this also cures S3 is a hypothesis. Read the frame gaps after the seek in step 1's report.

### Step 5 · Folder picks that cannot hang (`m14-flake-e-folder`)

This removes S5, on the test's side.

**`e2e/readalong.spec.ts`**
- Line `:2` becomes `import { expect, test, type Locator, type Page } from "@playwright/test";`.
- After `:22`:
```ts
/** Chooses a folder as a reader does. Playwright 1.56 waits for "input" but starts listening only after handing the folder over (playwright-core/lib/server/dom.js:566-571); WebKit can fire it first, and setInputFiles never returns (CI run 37392862541, attempt 2). Once the page shows it took the folder, one more "input" ends that wait; the app listens to "change" only. */
async function chooseFolder(section: Locator, label: string, dir: string) {
  const input = section.getByLabel(label);
  await Promise.all([
    input.setInputFiles(dir, { timeout: 30_000 }),
    (async () => {
      await expect(section.getByTestId("audiobook-status")).toHaveText(/^(Checking |Sending |Done\.$)/, { timeout: 20_000 });
      await input.dispatchEvent("input");
    })(),
  ]);
}
```
- Use it at `:166` (keep the `folder` locator at `:164-165` for the `webkitdirectory` check), `:208`, `:286` and `:304`.

**Why it is safe:**
- The folder input reacts to `change` only (`app/(app)/books/[id]/AudiobookUpload.tsx:206`).
- The status line is empty before each pick, or reads "Removed …": each upload clears it first (`:101`), and a removal sets "Removed" (`:131`). So the helper cannot fire on a stale status.
- A second upload would fail the "announced once" checks (`readalong.spec.ts:178`, `:294`).

**Check that fails without it.** The race itself cannot be forced, but its end state can. This is a one-off check, not kept in the suite:
1. Before the pick at `:166`, add `await page.evaluate(() => window.addEventListener("input", (e) => e.stopPropagation(), { capture: true, once: true }))`. Playwright's own listener then misses the browser's `input`, exactly as on CI.
2. Plain `setInputFiles(root, { timeout: 30_000 })` should time out.
3. `chooseFolder` should pass.
4. Run it in both engines and paste both results.

**CI runs.** The hang was seen once in 20 runs, so clean runs cannot show the rate fell. Any future hang becomes a named error after 30 s, instead of a 2-minute timeout.

**Not the fix now: upgrading Playwright.** It is pinned at 1.56.1 to match cloud sessions' Chromium (Open unknowns row 2). A new version would also change the WebKit build, and with it every timing baseline.

### Step 6 (optional, after steps 2-5) · Judge the highlight after it is painted: stricter only

- Take only the strict half of the dropped "Phase B". For the page's highlight, a word's lateness becomes the later of two readings: the one at the start of a frame, and the one after the frame is painted.
- Do the same for clocks: take the later of the audio clock and the page clock. #75's frame 552 had one out-of-date audio reading.
- Never use the earlier of two readings: that would loosen the check. The limit stays 100 ms.
- **Gate:** step 1's baseline shows `afterMissing` of 1 or less and an `afterLate` median of 0.
- Expect more failures, not fewer. Merge only after steps 2-5 sample clean. This is the step that makes `:1123` stricter about what a reader actually sees.

### Step 7 (only if Samuel says yes to D1) · `useSystemFonts: false`

- **Change:** add `useSystemFonts: false` at `pdf-book.ts:56-60`. pdf.js then draws a font the PDF does not carry with its own bundled files. Those files are already copied (`scripts/copy-pdfjs.mjs:11`) and kept by "Download for offline" (`lib/offline.ts:31, 37-39`).
- **Proof:** the `Cannot load system font` line is gone from `:1123`, and step 1's font-load time drops, in 30 of 30 runs.
- **Screenshots:** the Descartes fixture and Kuhn p. 3, before and after, in the four looks. No visual test shows a PDF page today.

**After the last step.** Harvest ordinary CI for a week and record the rate in `LEARNING_LOG.md`:
```
for id in $(gh run list --workflow ci.yml --limit 40 --json databaseId -q '.[].databaseId'); do gh run view "$id" --log | grep 'TIMING_JSON '; done > ci.log
node scripts/timing-summary.mjs --all ci.log
```

## 3. Decisions only Samuel can make

Add each one to `## Open unknowns`, to be decided by 2026-10-13. The defaults apply until he answers.

**D1. May a PDF that does not carry its own fonts be drawn with pdf.js's look-alike fonts on every device?**
- **The look-alikes:** Foxit Serif for Times, Liberation Sans for Helvetica and Arial, Foxit Fixed for Courier (pdf.js worker 24865-24878, per the pdfjs analysis).
- **Gain:** it removes the system-font lookups. They cost 40-60 ms on CI's Linux; the cost on an iPhone is unmeasured.
- **What changes:**
  - Kuhn barely: it carries every font except Arial, which is used on 1 of its 222 pages (§1).
  - The Descartes demo PDF and the test PDFs would look different.
- **Default: no**, keep today's look. Steps 2 and 3 go ahead without it. Revisit if late words still coincide with a font load after step 3.

**D2. Run CI's WebKit without GStreamer's on-disk audio mode (step 4)?**
- CI would stop exercising a Linux-only mode (GNOME Web) that none of Samuel's devices use.
- **Default: yes.**

**D3. Should the reader write the Listen bar's hidden `data-word` at the moment it lights a word (step 2)?**
- The bar's timing checks would then measure the lighting itself, not React's write 0-2 frames later, which nothing on screen shows.
- This is not counted as weakening a test: the 100 ms limit stays, the visible-highlight check is unchanged, and a stricter same-frame check is added.
- **Default: yes.** If overruled, `:1123` stays flaky until step 3 lands.

## 4. Risks, and what to check on a real iPhone (M13 (f))

**Risks**
- **Step 3 relocates the stall; it does not remove it.** When page N+1 brings a font the PDF does not carry, the lookups now run just after page N appears, near page N's first words.
  - On CI's Linux they last at most 40-60 ms (not isolated).
  - In a long book on a slow device they can still push a word past 100 ms. CI's two-page test cannot see this.
  - Kuhn is exposed only on p. 3.
- **Step 1's instruments add work to every frame:** a task after each paint, a wrapped `FontFace.load` and attribute watchers.
  - The ordinary CI pass rate may shift.
  - Comparisons stay fair because both sides carry the same instruments. Watch the harvested `TIMING_JSON`.
- **Step 2's same-frame check could fail for a reason other than the bar,** for example the recorder reading another frame's highlight (`listen.ts:77-90`). Read the first failure's timeline before acting.
- **Merge conflicts.** Step 1 and step 2 both touch `ListenBar.tsx:301-321` and `Reader.tsx:143-150, 698, 743`. Step 1 and step 3 both insert after `pdf-book.ts:167`.
- **Actions minutes.** The repo is private.
  - A 3×10 comparison costs about 50 runner-minutes; the whole plan about 300.
  - I could not read the remaining minutes: `gh`'s billing calls need the `user` scope.
  - Never raise a spending limit. If minutes run short, use 2 machines and note it under Waiting on Samuel.
- **Step 4 hides a real GStreamer bug from CI.** It only matters to Linux WebKit users.

**On the iPhone.** Its fonts and audio work differently from CI's, so CI says nothing about these:
1. **Page turns:** Listen to Kuhn ch. 1 and to the Descartes PDF across five or more page turns. The first word on each new page, and the first 2-3 words after a page appears (where step 3 moves any stall), must light on time.
2. **Console:** open Mac Safari → Develop → the iPhone → Console and look for `Cannot load system font` lines.
   - Apple's WebKit matches `local()` names only by family or PostScript name (FontCacheCoreText.cpp:497-530, per the pdfjs analysis), so italic lookups may fail there too, at an unknown cost.
   - Type `window.__nlMarks = true` before pressing Play; step 1's marks are off for readers.
   - Afterwards, read `performance.getEntriesByType("mark")` and `performance.getEntriesByType("measure")` for the device's drawing and text-layer times.
3. **Memory:** read 30 or more pages of Kuhn. Watch for `Page N: no canvas to draw on` (`pdf-book.ts:149`) or Safari reloading the tab.
4. **Rotation:** rotate the phone while a word is lit. It must stay tinted over its letters (the same kind of check as `:1225`).
5. **Audio:** start Kuhn's audiobook far into its file, from the real storage bucket, and time it to the first sound. Safari asks for closed ranges, which production answers in pieces of at most 8 MB. Step 4 tells you nothing about this.
6. **If D1 is yes:** compare the Descartes pages and Kuhn p. 3 with the old look.

## 5. Not covered

- **S2 and S3:** causes unknown. Step 1's `TIMING_JSON` from ordinary CI will show whether they recur after steps 2 and 4.
- **`:1225` "share of 'opens' tinted: 0.00":** seen once, in WebKit on the Mac (`LEARNING_LOG.md` Iteration 32), and not analysed. It is in the same test, so every dispatch runs that check 30 times. If it recurs, open a separate investigation.