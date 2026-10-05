# The learning loop of the M13 (d) and (e) session (2026-10-05)

Written for Samuel, and for the next Claude session that works on this repo.
It reconstructs how feedback (failed tests, CI runs, reviews, measurements)
changed what the session did next, while it built M13 step (d), the EPUB
player (PR #66), and step (e), the PDF player (PR #67). It is not a summary
of the features: those are in `docs/m13-player-plan.md` ("What (d) built",
"What (e) built") and in `PROGRESS.md`.

**Sources.** The session transcript
(`~/.claude/projects/-Users-sahuno-projects-personal-Neolibrary/4c68cd9b-30e7-47e7-a538-ba9c022f2315.jsonl`;
the work ran from 00:22 to 06:56 UTC). "L1234" below is a line of
that file (4,215 lines when measured). Every number is quoted from a tool
output at the line given. The advisor (a second model the session consults)
has its replies stored encrypted there. Those from the second half (L3059 on)
were read during the session and are reported from it; the earlier ones
(L243, L1760) are inferred from what the session did next, marked
"(inferred)".

**Words used here.**
- *Unit tests* check one piece of code on its own (Vitest, seconds).
- *Browser tests* drive the real app in two browser engines (Playwright):
  Chromium (Chrome's engine) and WebKit (Safari's engine), minutes.
- *CI* is GitHub's automatic run of all checks on each pull request, on a
  Linux machine. There, WebKit plays audio through *GStreamer*, unlike Safari
  on a Mac or iPhone.
- A *mutation check* deliberately breaks one fix, confirms that a named test
  then fails, and puts the fix back. It proves the test guards the fix.
- A *trace* is Playwright's recording of a test run: every request, every
  step, page snapshots.
- A *flake* is a test that fails sometimes for reasons outside the code
  under test.
- A *fixture* is test data made for a test (here: generated PDFs and
  read-along packages).
- A *worktree* is a second checkout of the repo in another folder, so two
  branches can be built and tested at once.

---

## 1. The iterations, each in eight parts

### Phase 1: building the EPUB player, step (d) (L12 to L937)

**1. Baseline and first build (00:23 to 00:46)**
1. *Goal:* build (d) as planned in `docs/m13-player-plan.md`, starting from a
   known-green `main`.
2. *Action:* read the ledger and plans; ran `npm run check` on `main` first;
   wrote the byte-range cap, a sign-in-checked audio route, the audiobook
   lookup, and the per-frame follow logic (`lib/readalong/player.ts`) as a
   pure function so it could be unit-tested.
3. *Files:* `lib/http-range.ts`, `lib/serve-file.ts`, the new audio route,
   `lib/library/{audio,listen}.ts`, `lib/readalong/player.ts`, unit tests.
4. *Evaluation:* baseline `Tests 313 passed | 2 skipped` (L237); unit tests
   per file.
5. *Result:* four mistakes in the tests or their fixtures surfaced one after
   another (L379 to L456).
6. *What failed:* comparing 20 MB arrays with `toEqual` crashed the test
   worker (`SIGABRT`, L379); spying on the in-memory storage counted its own
   internal calls (`called 4 times`, L389); the PDF test assumed the Descartes
   fixture had two pages, but it has one ("There is nothing to read aloud
   here", L415); one assertion tested a state the test had already changed
   (L456).
7. *Learned:* check fixtures and test tools against reality before relying
   on them.
8. *Next:* byte-buffer comparisons, a thin storage wrapper, and a PDF
   generated in the test (three pages). Generating fixtures in code became
   the default for the rest of the session.

**2. First browser run of the player tests (00:49 to 00:58)**
1. *Hypothesis:* the matcher (step (b), which places spoken words onto book
   paragraphs) would place the test package's paragraphs 60 to 65 as written.
2. *Action:* ran the whole browser suite.
3. *Files:* `e2e/readalong.spec.ts`, `e2e/listen.ts`.
4. *Evaluation:* `1 failed | 13 did not run | 179 passed` (L628); a
   temporary unit-test probe ran the matcher on the same package (L648).
5. *Result:* the server placed the words differently from the fixture.
6. *What failed:* the hypothesis. The matcher anchors a chapter at the first
   place its first four words agree, and "how did you know me" also occurs in
   an earlier paragraph.
7. *Learned:* a limit of older code (step (b)) that real packages, which
   start at a chapter's start, rarely meet; and tests must use passages the
   matcher places exactly.
8. *Next:* paragraphs 61 to 66; later an exact check of every placement
   (`expect(placed).toEqual(expected)`). Process change: instead of
   rebuilding and rerunning everything per fix, the session kept its own test
   server running and reran only the read-along projects (L692). Result:
   `193 passed` (L702).

**3. Crossing into a new chapter (00:58 to 01:04)**
1. *Hypothesis:* turning the page when the next paragraph's first word
   starts is soon enough.
2. *Action:* probed a chapter crossing with a spoken heading: paragraph 32
   ends at 2130 ms, paragraph 33 starts at 2790 ms (L751).
3. *Files:* `lib/readalong/player.ts` (an `ahead` field),
   `ListenBar.tsx`, `player.test.ts`.
4. *Evaluation:* unit tests: two expected failures, then updated (L757 to
   L769); a chapter-crossing browser test, run in both engines with
   `--project=readalong --project=readalong-safari --no-deps` (L808).
5. *Result:* the unit tests passed; the browser run failed in WebKit's
   folder-upload test (L814). Run alone, the WebKit project passed
   (`11 passed`, L820).
6. *What failed:* the way the tests were run. `--no-deps` starts the two
   projects at the same time, and both change the same book's audiobook, so
   they interfered.
7. *Learned:* a new chapter (a new page frame) needs time to open, so the
   turn should start as soon as the last word before it is over; and test
   projects that share data must not run at the same time.
8. *Next:* the early turn ("ahead"), then a mutation check to see whether
   any test would notice its loss. From here on the two read-along projects
   ran one after the other (a loop over the projects).

**4. First mutation round (01:04 to 01:11)**
1. *Goal:* prove each fix has a test that fails without it.
2. *Action:* 11 unit-level breakages (L838); browser-level breakages B1 to B3.
3. *Files:* scratch scripts only.
4. *Evaluation:* rebuild with each breakage, run the named test in both
   engines.
5. *Result:* the first B1/B2 attempt did not even build (`BUILD FAILED`,
   L874). Rerun with breakages that compile: B1 (audio source set again per
   paragraph) caught, `6` `loadstart` events instead of 1 (L892). **B2 (no
   early turn) not caught**: the test passed in both engines (L892). B3
   (closed ranges uncapped) caught in WebKit only: `15863884` bytes in one
   answer (L881).
6. *What failed:* the chapter test checked that words lit on time, which the
   spoken heading's slack let pass even without the early turn.
7. *Learned:* a test that passes with the fix removed is checking the wrong
   property.
8. *Next:* the test now requires the turn before chapter 2's first word; B2
   then caught: turned at `2839.318` and `2875.27` ms, needed `< 2790` (L909).
   This "mutate, and if it survives, change what the test asserts" step
   recurs in iterations 22 and 26.

### Phase 2: review of (d), the PDF prototype, PR #66 (L937 to L1758)

**5. Agent review of (d), and the PDF prototype in parallel (01:12 to 02:04)**
1. *Goal:* independent review before the PR; use the waiting time to
   prototype (e)'s word mapping (count non-space characters on a page).
2. *Action:* a workflow of five reviewers (player, server, tests,
   regressions, wording), with a skeptic per finding; meanwhile a prototype in
   a worktree.
3. *Files:* the (d) code under review; the prototype `lib/reader/text-range.ts`.
4. *Evaluation:* review verdicts; the prototype's unit test.
5. *Result:* 27 findings confirmed, 1 refuted. Examples: the Listen bar sat
   over the page and hid the last lines on a phone (L1139); offline gave the
   wrong message (L1184); the highlight check counted a word lit on a page
   that was not on screen (L1295). Prototype: `range.setStart is not a
   function` in the test DOM library (L980), then passing (L990).
6. *What failed:* the tests had not checked what the reader can *see*: the
   bar's position, the lit word being on screen.
7. *Learned:* reviewers find user-visible problems that pass functional
   tests.
8. *Next:* all 27 fixed; the recorder gained an "on screen" column and the
   bar became a row below the page, with a layout assertion. Unit tests rose
   to `336 passed` (L1437).

**6. A fixes worktree that would not build (01:52)**
1. *Goal:* test the fixes in a worktree, on its own port and data.
2. *Action:* linked the main checkout's `node_modules` into the worktree.
3. *Files:* none.
4. *Evaluation:* `npm run build`.
5. *Result:* Turbopack refused: "Symlink [project]/node_modules is invalid"
   (L1458).
6. *What failed:* the shortcut.
7. *Learned:* each worktree needs its own install for Next.js builds.
8. *Next:* `npm ci` in the worktree; the (e) worktree later got its own
   install from the start.

**7. A regression made by a bulk edit (01:55 to 02:00)**
1. *Hypothesis at first:* an older pictures test failing at 30 s (L1494) was
   a flake.
2. *Action:* reran it; "It fails every time, so it's real" (L1519); measured
   the layout just before the failing click.
3. *Files:* `app/(reader)/books/[id]/read/reader.module.css`.
4. *Evaluation:* the failure's page snapshot and screenshot.
5. *Result:* a Python `str.replace` meant for the Listen bar had also removed
   the selection bar's centring, so its "See it" button sat off screen
   (L1546).
6. *What failed:* replacing text without checking how many places matched.
7. *Learned:* a bulk edit can change more than intended, and an unrelated
   test may be the only witness.
8. *Next:* from then on every scripted edit asserted exactly one match
   (`assert s.count(a)==1`), and the session audited source diffs line by
   line before committing (L1559 to L1575).

**8. Two tests that were wrong (02:04 to 02:16)**
1. *Hypothesis:* failures in the new pause/resume and voice-switch tests
   meant player bugs.
2. *Action:* read each failure and the trace; mapped the stored paragraph
   ids to paragraph numbers (L1640, L1677).
3. *Files:* `e2e/readalong.spec.ts`, `ListenBar.tsx`.
4. *Evaluation:* reruns in both engines.
5. *Result:* the pause/resume test had taken the first Play as the resume
   (L1605). The voice-switch test leaned on a made-voice track stored by an
   earlier run, and both engines named different wrong paragraphs (L1676).
6. *What failed:* the tests' logic, plus one real gap: changing voice was not
   idempotent and did not hand over the exact position.
7. *Learned:* assert on what the feature actually does (the hand-over
   request's answer), not on state left by earlier tests.
8. *Next:* a fixed resume check, a direct check of the hand-over, an
   idempotent voice change. Full suite from a fresh database:
   `207 passed (5.2m)` (L1706). PR #66 opened.

**9. Advisor review after opening PR #66 (02:23 to 02:28, inferred)**
1. *Goal:* a second opinion before merging.
2. *Action:* consulted the advisor (reply encrypted).
3. *Files:* `Reader.tsx` (resume target).
4. *Evaluation:* re-ran mutation checks "as the advisor asked" (L1798).
5. *Result:* a new fix: after a pause, Play returns to the page of the word
   being read, not the paragraph's start (from the session summary).
6. *What failed:* resuming in a long paragraph flipped back a page, then
   forward.
7. *Learned:* bugs live where two features meet (pause and long paragraphs).
8. *Next:* a long-paragraph test, which uncovered the next iteration's bug.

**10. The long-paragraph test exposes an old M7 bug (02:52 to 03:06)**
1. *Hypothesis:* the new test would pass on the final code.
2. *Action:* ran it: `1 failed | 21 did not run | 187 passed` (L1924);
   measured where the reader went after the jump (L1943 to L1949); read
   foliate's page-turn code (L1962 to L1966). foliate is the library that
   shows the pages.
3. *Files:* `Reader.tsx`.
4. *Evaluation:* page-turn tests in both engines; mutations B4 and B7.
5. *Result:* foliate ignores a turn asked for within 0.1 s of the last and
   then sends no "relocate"; the reader waited for that event, so after a jump
   of several pages its turning flag stuck and the page never turned again.
   The fix turns straight to the word's page and clears the flag when the
   request ends. Then `209 passed (5.5m)` (L2032).
6. *What failed:* code from M7 (read-aloud), not code from (d).
7. *Learned:* reading the library's source settled in minutes what guessing
   had not; a new test path (jumps) surfaced an old bug.
8. *Next:* the long-paragraph test stayed as the guard; mutations B4 and B7
   showed it catches both regressions in Chromium.

### Phase 3: CI rounds on PR #66, porting (e) (L1758 to L2330)

**11. CI round 1: Linux WebKit asks differently (03:07)**
1. *Hypothesis:* green locally means green on CI.
2. *Action:* read CI's failure; checked whether Docker could reproduce Linux
   WebKit locally (its virtual machine was not running, L2069).
3. *Files:* `e2e/readalong.spec.ts`.
4. *Evaluation:* CI run 37255221059.
5. *Result:* `Error: answer to null  Expected: 200  Received: 0` (L2051): CI's
   WebKit first asks for the file with no byte range, and Playwright reports
   that answer as status 0.
6. *What failed:* the test encoded one engine's network behaviour.
7. *Learned:* CI's WebKit is not Safari; and setting up a Linux engine
   locally costs more than letting CI answer.
8. *Next:* the check accepts status 0 or 200 only for requests that asked
   for no range. The session iterated with CI from here.

**12. Hung unit runs (03:09 to 03:14)**
1. *Hypothesis:* the machine was just busy.
2. *Action:* listed processes by CPU (L2156): test workers at 100%.
3. *Files:* `lib/readalong/fixture.ts`, `lib/library/audio.test.ts`.
4. *Evaluation:* reran one file at a time.
5. *Result:* an infinite loop: `c.pauses?.[paragraph++]` never increments
   `paragraph` when `pauses` is missing. After the fix, `86` of `87` passed
   (L2171). The last failure: the server split a generated PDF page into 3
   paragraphs, not 4, because the split uses the median line step.
6. *What failed:* a side effect inside optional chaining; and a guess about
   the paragraph split.
7. *Learned:* "slow" can be a loop, so check CPU; generated PDFs need three or
   more lines per paragraph so that the median line step is the step within a
   paragraph.
8. *Next:* that rule shaped every later PDF fixture (iteration 20 computes the
   median before drawing).

**13. CI round 2: the audio ran out (03:19 to 03:23)**
1. *Hypothesis:* the test audio ending 0.4 s after the last word was enough.
2. *Action:* read CI run 37258251721.
3. *Files:* `e2e/readalong.spec.ts` (a closing line, `TAIL`).
4. *Evaluation:* both read-along projects locally, `18 passed` each (L2279).
5. *Result:* on CI's slower machine the file reached its end before the test
   stopped it: events `[..., "pause", "ended"]` (L2240).
6. *What failed:* the fixture had no margin for a slow machine.
7. *Learned:* add margin in the fixture (more audio), not in the assertion.
8. *Next:* every package got a closing line the book does not print; the
   placement check became exact, so the line could not be placed by accident.

**14. The PDF test's first WebKit run: "the fingerprints differ" (03:23)**
1. *Hypothesis:* the PDF test failing within 0.3 s in WebKit was a player
   bug.
2. *Action:* read the error: "This package was made from a different file
   of this book (the fingerprints differ)" (L2300).
3. *Files:* the PDF fixture in `e2e/readalong.spec.ts`.
4. *Evaluation:* checked the generated PDF was identical across runs.
5. *Result:* pdf-lib stamps the current time into the file. The Chromium run
   uploaded one version; WebKit's run generated another with the same title.
   The shelf treats the same title as a duplicate, so WebKit's package
   (fingerprinted from its own bytes) did not match the book on the shelf.
6. *What failed:* a non-deterministic fixture.
7. *Learned:* generated fixtures must be byte-identical every run, because
   the server deduplicates books by title.
8. *Next:* fixed creation and modification dates. The deeper rule (a changed
   book needs a new title) was learned only in iteration 21.

**15. Screenshots show the PDF highlight off its letters (03:24 to 03:33)**
1. *Hypothesis:* green PDF tests (`213 passed`, L2396) meant a correct
   highlight.
2. *Action:* looked at the screenshots; compared the text layer's CSS with
   pdf.js 6.4's own stylesheet (L2346). The text layer is pdf.js's invisible
   copy of the page's text, laid over the page picture.
3. *Files:* `lib/reader/pdf-book.ts`; a new alignment check in the test.
4. *Evaluation:* the lit box against the font's own widths, before and after
   the fix (L2402).
5. *Result:* before: `"opens" lit 193.9 pt from the left, printed at 142.8`
   (Chromium) and `190.6` (WebKit) (L2403); after, within 4 pt.
6. *What failed:* the tests read the highlight's text, not where it lay.
7. *Learned:* looking at the output catches what assertions miss; turn the
   observation into a measurement before fixing.
8. *Next:* the alignment check stayed in the main PDF test, run at every size
   and colour scheme.

### Phase 4: the stall hunt in CI's WebKit (L2330 to L2828)

**16. CI round 3: the long file stalls (03:35 to 03:44)**
1. *Hypothesis:* capping every byte range at 64 KB in tests (8 MB live) was
   safe for all engines.
2. *Action:* downloaded CI's report and listed the audio requests from the
   trace (L2446 to L2462).
3. *Files:* `lib/http-range.ts`, `lib/serve-file.ts`, their unit tests.
4. *Evaluation:* CI run 37259274244 (long-file test timed out, L2441); after
   the fix, a fresh full local run: `209 passed (5.1m)` (L2515), because
   serving touches every file the app sends.
5. *Result:* the trace showed two requests with no range, then open-ended
   requests ("from byte N to the end") answered with 64 KB, after which
   GStreamer stopped asking (L2462).
6. *What failed:* capped answers to open-ended requests.
7. *Learned:* read the actual requests in CI's trace before theorising.
8. *Next:* open-ended requests are answered in full but read and sent 8 MB
   at a time; closed ranges stay capped.

**17. CI round 4: a flake, and the stall again (03:58 to 04:11)**
1. *Hypothesis:* the open-ended fix had cured the long-file stall.
2. *Action:* the upload test had hung (L2577); its page snapshot at failure
   showed the page already "Ready" (L2622), so the job was re-run. The re-run
   cleared the upload test, but the long-file test still failed; the session
   listed its audio requests again (L2672).
3. *Files:* `ListenBar.tsx`.
4. *Evaluation:* CI run 37260648155 and its re-run.
5. *Result:* requests `bytes=5693440-`, `bytes=10247084-`, `bytes=5693440-`
   again, all answered in full, and the page stuck on "Loading your
   audiobook…" (L2672).
6. *What failed:* the first hypothesis. New hypothesis: setting the start
   time far into a file before its length is known confuses GStreamer.
7. *Learned:* the failure-time snapshot separates a flake (the app had
   finished) from a real failure.
8. *Next:* the player calls play() at once (inside the click, as Safari
   needs) but sets the start time on `loadedmetadata` (when the file's length
   is known), and the per-frame follower waits until then.

**18. Ripples of the start-time change (04:13 to 04:32)**
1. *Hypothesis:* the change affects only the long-file case.
2. *Action:* full run, then both read-along projects, fixing tests one by
   one.
3. *Files:* `e2e/readalong.spec.ts`, `e2e/listen.ts`.
4. *Evaluation:* four failures in turn: voice switch (L2707), WebKit main test
   (L2736), `the audio fell 441 ms behind the clock (stalled)` (L2755), long
   paragraph (L2770).
5. *Result:* tests had read the audio time the instant Play was pressed, or
   moved the audio before it had loaded. Each now waits for playback first or
   checks what gets lit, and the stall check starts once the audio moves.
   `18 passed` in both engines (L2776); `209 passed (5.1m)` fresh (L2807).
6. *What failed:* tests that encoded the old timing.
7. *Learned:* when timing semantics change, assert outcomes the reader sees,
   not internal timing.
8. *Next:* pushed; CI run 37264635995 passed (`209 passed (10.2m)`), and PR
   #66 merged as `dd2e86e`. The session also re-labelled the PR's mutation
   evidence with the commits it ran on (5ee19ce to 3d3dc27) instead of "final
   code".

### Phase 5: the PDF player, step (e) (L2828 to L3700)

**19. Measure before optimising (04:47 to 04:58)**
1. *Hypothesis (from a reviewer, rated uncertain):* a new PDF page opens too
   late for its first word; draw the next page ahead of time.
2. *Action:* the advisor said to measure first; a temporary probe timed page
   turns on Samuel's Kuhn PDF.
3. *Files:* a probe test, deleted after.
4. *Evaluation:* time from a turn to the page's text layer being ready.
5. *Result:* median 22 ms (Chromium) and 33 ms (WebKit); phone size at 3x
   pixels, 21 and 34 ms; Chromium with the processor slowed 4 times, 33 to
   42 ms.
6. *What failed:* nothing; the hypothesis was not needed on the laptop.
7. *Learned:* a cheap measurement avoided a larger build (pre-drawing pages).
8. *Next:* no pre-drawing. Instead, a browser test of the hard case: a
   sentence running across the page break with no pause.

**20. Fixing the first (e) review (04:56 to 05:05)**
1. *Goal:* fix what the branch owned of 17 confirmed findings; record the
   rest (matcher follow-ups) with numbers re-derived by the session itself.
2. *Action:* one text layer per shown page, laid out again on resize (it had
   been rebuilt on every resize, which could mix two copies); pdf.js's
   rotation rules; the server reads PDFs with pdf.js's character maps; parts
   of the paragraph list capped at about 8,000 words; turning back to the
   page being read; a Kuhn-like test PDF (running head first, median line
   step computed in advance).
3. *Files:* `lib/reader/pdf-book.ts`, `Reader.tsx`,
   `lib/library/{audio,pdf-sections}.ts`, tests.
4. *Evaluation:* unit mutations: no character maps → the Japanese line
   missing; page places counted from the part's start, or over timed
   paragraphs only, or no word cap → each caught.
5. *Result:* all caught.
6. *What failed:* nothing at unit level.
7. *Learned:* the branch's own test comments had called a running head glued
   onto a word "as in the Kuhn PDF"; a skeptic, reading Samuel's actual Kuhn
   file, showed that example came from the Descartes demo PDF and that Kuhn
   draws its running head first. The fixture changed to match Kuhn.
8. *Next:* browser tests.

**21. "The fingerprints differ" again (05:05)**
1. *Hypothesis:* the rewritten PDF tests would run on the existing local
   database.
2. *Action:* ran them: the same error as iteration 14.
3. *Files:* the PDF fixture's title.
4. *Evaluation:* rerun: 4 PDF tests passed in both engines.
5. *Result:* the local database still held the old test PDF under the same
   title, so the new file was a "duplicate" with different bytes.
6. *What failed:* the lesson from iteration 14 had been learned too narrowly
   (same dates) rather than in general (a changed book needs a new title).
7. *Learned:* the shelf knows a book by its title, so any change to a
   generated book needs a new title, or a fresh database.
8. *Next:* a new title and a code comment saying why.

**22. Browser mutations: a race the tests could not see (05:06 to 05:16)**
1. *Hypothesis:* the new PDF tests guard the new fixes.
2. *Action:* broke each fix and rebuilt.
3. *Files:* `e2e/readalong.spec.ts`.
4. *Evaluation:* E1 (no rotation rules) caught: lit box `23.4 pt wide, 13.9
   pt high`. E2 (no turning back) did not build: TypeScript narrowed `if
   (false)`. E3 (the old rebuild-on-resize code) **passed in both engines**.
5. *Result:* the redraw race is too fast to hit by chance on a laptop.
6. *What failed:* trying to catch a race through timing.
7. *Learned:* test the structural property that rules the race out: a
   resize must lay out the *same* text again, never rebuild it.
8. *Next:* the test marks a span before resizing and requires it afterwards.
   E3 then caught ("the same text, laid out again"), and E2 rewritten to
   compile was caught (`"own,"` never lit). Same lesson as iteration 4, at a
   new level.

**23. Draft PR and CI's connection reset (05:23 to 05:45)**
1. *Goal:* run a second verification of the fixes without the auto-merge
   Action merging first (it skips drafts).
2. *Action:* opened PR #67 as a draft; CI failed on an older upload test with
   `read ECONNRESET`; downloaded the trace.
3. *Files:* later `playwright.config.ts`.
4. *Evaluation:* the trace's request times: `613778.757` ms, then
   `619809.02` ms for the next request to the same address.
5. *Result:* about 6 s idle, past the test server's 5 s keep-alive limit (how
   long the server keeps an idle connection open). The client reused a
   connection the server was closing. The re-run passed: `217 passed
   (12.7m)`.
6. *What failed:* nothing in the app; a race in the test setup.
7. *Learned:* the trace's timings tell a flake's cause; a re-run proves it
   intermittent but does not remove it.
8. *Next:* the test server now keeps idle connections 120 s.

### Phase 6: verifying the fixes, and merging (L3700 to L4212)

**24. Second review: the fixes themselves (05:25 to 06:08)**
1. *Goal:* try to break the first round of fixes.
2. *Action:* five reviewers (drawing, reader, server, tests, written claims),
   a skeptic each.
3. *Files:* `pdf-book.ts`, `Reader.tsx`, `e2e/readalong.spec.ts`, docs.
4. *Evaluation:* verdicts: `confirmed 7, uncertain 0, refuted 0, nits 6`.
5. *Result:* a fix had introduced a bug: the drawing code now skipped a
   request at a size already asked for, even if that drawing had failed (an
   iPhone out of canvas memory), so the page was never drawn again. Also: a
   page still opening could be asked for twice; the character maps help only
   PDFs added from now on; CI's WebKit lit page 2's first word 79 ms late
   (limit 100); no test checked the lit word could be *seen*; and two written
   claims were wrong (below).
6. *What failed:* the session's own fixes and its own write-up.
7. *Learned:* review the fixes as well as the original code; an optimisation
   (skip same-size redraws) needs its failure path too.
8. *Next:* the fixes in iterations 25 to 27, and corrected docs.

**25. A fix that broke WebKit: fetching the next page's text (06:01 to 06:08)**
1. *Hypothesis:* fetching the next page's text ahead, through a stream made
   in our code, would give CI's WebKit more margin.
2. *Action:* built it; ran the PDF tests.
3. *Files:* `lib/reader/pdf-book.ts`.
4. *Evaluation:* WebKit main PDF test, three runs; a probe of page 2's text
   layer.
5. *Result:* `bar: words shown  Expected: >= 117  Received: 51` in 3 of 3
   runs. 51 is exactly page 1's word count, which pointed at page 2. The probe
   found page 2's text layer empty (`"spans":0`) and a page error `TypeError:
   undefined is not a function`. Handing pdf.js the fetched text as a plain
   object fixed it (`"spans":18` in both engines).
6. *What failed:* the hand-made stream, in WebKit only (the exact cause
   inside pdf.js was not proven; the code comment says only what was seen).
7. *Learned:* make the failure deterministic, read the exact count, then
   probe the page state directly; and state observations, not guessed
   causes.
8. *Next:* the fix, then the full suite in both engines.

**26. A test that could not fail (06:03 to 06:14)**
1. *Hypothesis:* a test faking "no canvas memory" on the first drawing would
   guard the retry fix.
2. *Action:* ran it, then mutated the fix.
3. *Files:* `e2e/readalong.spec.ts`.
4. *Evaluation:* first run: its precondition failed (`picture: true`): a
   later drawing at another size succeeded. Then, with the shortage
   controlled by a flag, the mutation **still passed**.
5. *Result:* the test asked foliate for page 1 (`goTo(0)`), but the book
   reopens at its last reading position, so foliate opened a different page in
   a new frame, which drew regardless.
6. *What failed:* the test exercised a different path from the one it named.
7. *Learned:* a failure-simulating test must control the failure's window
   and be mutation-checked; otherwise it can pass for unrelated reasons.
8. *Next:* ask again for the page actually shown; the mutation then failed in
   both engines, and the real code passed.

**27. Asserting what the reader sees (06:01 to 06:14)**
1. *Goal:* a test for "the lit word can be seen", since the text layer's
   letters are transparent and only the tint shows.
2. *Action:* screenshot the lit word's box and the box after it; count
   pixels near the tint colour.
3. *Files:* `e2e/readalong.spec.ts`.
4. *Evaluation:* mutation: the highlight given a text colour instead of a
   background.
5. *Result:* caught: `share of "opens" tinted: 0.02` (Chromium) and `0.04`
   (WebKit), needed `> 0.25`.
6. *What failed:* nothing.
7. *Learned:* when a bug would be invisible yet logically "lit", measure
   pixels.
8. *Next:* kept in every look (desktop and phone, light and dark).

**28. Correcting the written claims (05:59 to 06:16)**
1. *Goal:* make every number in the docs, ledger and PR re-derivable.
2. *Action:* re-ran the reviewers' scripts on Samuel's Kuhn narration and
   PDF; rewrote "What (e) built".
3. *Files:* `docs/m13-player-plan.md`, `docs/plan.md`, `PROGRESS.md`, PR #67.
4. *Evaluation:* `spoken 67824, matched 67270 (99.18%), unmatched 554`; of 553
   "other" unlit printed words, 362 are two blocks of footnotes the narrator
   does not read; the 554 unmatched spoken words split 155 / 43 / 8 / 259 / 61
   / 28; with character maps `0` of Kuhn's 222 pages change.
5. *Result:* the earlier text ("553 others, mostly numbers and
   abbreviations") was wrong, and the page-turn probe had no saved evidence
   (its numbers are only in this transcript).
6. *What failed:* repeating subagents' numbers without re-deriving them.
7. *Learned:* re-derive before writing; say where evidence lives.
8. *Next:* corrected docs; the probe described as "not kept in the repo",
   with where its output is.

**29. CI's WebKit margin, and the merge (06:21 to 06:56)**
1. *Hypothesis:* fetching the next page's text ahead had improved CI's
   WebKit page-break figure.
2. *Action:* full local run `219 passed (6.1m)`; pushed; read CI's logs.
3. *Files:* docs and ledger only after that.
4. *Evaluation:* CI run 37272057858: `219 passed (12.8m)`, page 2's first word
   lit `22 ms` (Chromium) and `68 ms` (WebKit) after it began; CI run
   37273447978 (same code): `24 ms` and `92 ms`.
5. *Result:* WebKit on CI: 79, 68 and 92 ms across three runs. Within
   run-to-run noise, the prefetch's effect there is not shown.
6. *What failed:* the implied claim in the docs that the prefetch helped on
   CI.
7. *Learned:* one noisy sample proves nothing. Don't change what the reader
   sees (an earlier page turn) to steady a test on an engine Samuel does not
   use without first measuring where the time goes (advice from the
   advisor, which the session followed).
8. *Next:* the docs state the figures as measured; the PR names the next
   step (log the turn's phases, then an earlier PDF turn if needed); PR #67
   merged as `74b7d0e`, matching the checked commit exactly.

---

## A. Chronological learning-loop table

Times are when each iteration started. Iterations 24 to 28 overlapped (one
batch of fixes after the second review), so their times interleave.

| # | Time (UTC) | Hypothesis or goal | Signal (test, CI, review, measure) | What was learned | How the next attempt changed |
|---|---|---|---|---|---|
| 1 | 00:23 | Build (d) from a green baseline | `313 passed`; 4 harness failures | Fixtures and test tools must be checked against reality | PDFs and packages generated in test code |
| 2 | 00:52 | The matcher places the fixture as written | `1 failed`, probe of the matcher | The matcher anchors at the first 4-word match | Exactly-placed paragraphs; own long-running test server |
| 3 | 00:58 | Turning at the next word is soon enough | Probe of a chapter crossing; a parallel run failed | New chapters need time to open; projects sharing data collide | Early turn (`ahead`); projects run one after the other |
| 4 | 01:05 | The tests guard each fix | B2 mutation passed | A test that survives its fix's removal checks the wrong thing | Test requires the turn before chapter 2's first word; caught |
| 5 | 01:12 | (d) is ready for review | 27 confirmed findings | Visible problems pass functional tests | "On screen" checks; bar below the page |
| 6 | 01:52 | A linked `node_modules` is fine in a worktree | Build refused | Worktrees need their own install | `npm ci` per worktree |
| 7 | 01:55 | A failing older test is a flake | Fails every time; snapshot | A bulk replace changed two places | Every scripted edit asserts one match; diffs audited |
| 8 | 02:04 | Failing new tests mean player bugs | Traces, id mapping | Two tests were wrong; voice change not idempotent | Assert the hand-over directly; `207 passed` |
| 9 | 02:23 | PR #66 is final | Advisor (inferred) | Pause and long paragraphs interact | Resume to the word's page; a long-paragraph test |
| 10 | 02:52 | The long-paragraph test passes | `1 failed`; foliate source | An M7 page-turn flag could stick | Turn straight to the word; clear the flag on settle |
| 11 | 03:07 | Green locally means green on CI | `Received: 0` on CI | CI's WebKit asks with no range first | Engine-specific acceptance; iterate with CI, not Docker |
| 12 | 03:09 | The machine is just busy | Workers at 100% CPU | A loop in optional chaining; the median line step | Fixed loop; 3+ lines per generated paragraph |
| 13 | 03:19 | 0.4 s of audio after the last word is enough | `"pause","ended"` on CI | Fixtures need slack for slow machines | A closing line in every package; exact placement check |
| 14 | 03:23 | The WebKit PDF failure is a player bug | "fingerprints differ" | pdf-lib stamps the time; the shelf dedupes by title | Fixed dates in the test PDF |
| 15 | 03:24 | Green PDF tests mean a correct highlight | Screenshots; 193.9 vs 142.8 pt | Look at the output; measure it | pdf.js 6.4 stylesheet; alignment check kept |
| 16 | 03:35 | 64 KB answers suit every engine | CI trace of the requests | GStreamer stops after a short open-ended answer | Open-ended answered in full, in 8 MB reads |
| 17 | 03:58 | That fixed the stall | Snapshot "Ready"; requests again | Flake vs real failure by the snapshot; start time too early | Start time set on `loadedmetadata` |
| 18 | 04:13 | Only the long file is affected | 4 test failures in turn | Tests encoded the old timing | Tests wait for playback; `209 passed`; #66 merged |
| 19 | 04:47 | Pre-draw the next PDF page | Probe: 21 to 42 ms | Not needed on a laptop | No pre-drawing; a no-pause page-break test |
| 20 | 04:56 | Fix the 17 findings | Unit mutations all caught | Kuhn draws its running head first | Kuhn-like fixture |
| 21 | 05:05 | Rewritten tests run on old data | "fingerprints differ" again | A changed book needs a new title | New title, with a comment |
| 22 | 05:06 | New PDF tests guard the fixes | E3 mutation passed | Test the property that rules out the race | "Same text, laid out again" check; caught |
| 23 | 05:23 | Draft PR holds the merge while verifying | `ECONNRESET`; 6 s idle in the trace | Keep-alive race in the test server | Re-run; later a 120 s keep-alive |
| 24 | 05:25 | The fixes are right | 7 confirmed, 0 refuted | Fixes can add bugs; claims can be wrong | Retry after failed drawing; one turn request |
| 25 | 06:01 | Fetch the next page's text via our own stream | 51 of 117 words, 3 of 3 | Exact counts localise a bug | Plain object to pdf.js; 18 spans |
| 26 | 06:03 | The no-canvas test guards its fix | Mutation passed | The test took another path (`goTo(0)`) | Ask for the page shown; caught |
| 27 | 06:01 | Lit means seen | Pixels: 0.02 / 0.04 tinted when broken | Measure what the eye sees | Tint check in every look |
| 28 | 05:59 | Docs numbers are right | Re-run scripts | 362 of 553 "others" are unread footnotes | Corrected counts, evidence named |
| 29 | 06:37 | The prefetch helped CI's WebKit | 79, 68, 92 ms | One sample proves nothing | Honest docs; measure before an earlier turn; merged |

---

## B. Major mistakes and dead ends

1. **Tests that could not fail.** Three times a test passed with its fix
   removed: the chapter test (iteration 4), the redraw test (22) and the
   no-canvas test (26). Each was caught only because the session
   mutation-checked every fix. Without that step, three regressions would
   have been unguarded.
2. **Edits that changed more than intended.** A Python `replace` removed the
   selection bar's centring (7). It cost a full debugging cycle, and the only
   witness was an unrelated pictures test.
3. **Breakages that did not compile.** The first B1/B2 mutations and E2 broke
   the build rather than the behaviour (4, 22), costing a rebuild each.
4. **The same identity trap twice.** "The fingerprints differ" (14, 21): the
   first fix (fixed dates) solved the symptom; the rule behind it (the shelf
   knows a book by its title) was understood only the second time.
5. **Theories before evidence on CI.** Two CI rounds (16, 17) each fixed one
   real cause; the second stall was found only by listing the requests in
   CI's own trace. Reproducing Linux WebKit locally (Docker) was a dead end:
   its virtual machine was not running (11).
6. **A fix that broke an engine.** Fetching the next page's text through a
   hand-made stream emptied page 2's text layer in WebKit (25). It was made
   to buy margin on CI, and nearly shipped a regression there.
7. **Tests with wrong logic.** The pause/resume test took the first Play as
   the resume; the voice-switch test leaned on state from an earlier run (8).
8. **Claims ahead of evidence.** "Mutation checks on the final code" (they
   ran on earlier commits), "553 others, mostly numbers" (362 are unread
   footnotes), probe figures with no saved output, and an implied CI
   improvement from one run (18, 28, 29). Each was corrected before merging.
9. **A suspected flake that was real, and one that was not.** The pictures
   test failure was real (7); the CI upload hang was a flake (17). The
   failure-time snapshot told them apart both times.

## C. Reusable lessons

1. **Mutation-check every fix.** If the test still passes with the fix
   removed, change what the test asserts, not the fix.
2. **For races, assert the invariant that excludes the race** (the same nodes
   laid out again), not the timing that triggers it.
3. **Make generated fixtures deterministic, and respect the system's identity
   rules.** Same bytes every run; a changed book gets a new title.
4. **On a CI-only failure, read CI's trace first:** the requests, their
   ranges, the times between them, the page snapshot at failure. Two
   stalls and one connection reset were explained that way.
5. **Separate flake from failure with evidence,** then remove the flake's
   cause instead of relying on re-runs (the keep-alive setting).
6. **Scripted edits assert their match count; diffs are read before every
   commit.**
7. **Look at the screenshots, then turn what you see into a measurement**
   (the alignment check, the tint check).
8. **Measure before optimising, and don't claim a gain from one noisy
   sample** (the page-turn probe; CI's 79/68/92 ms).
9. **Re-derive every number before writing it, and label evidence with the
   commit it ran on.**
10. **Review the fixes, not just the first draft.** The second review found a
    bug that one of the fixes had introduced.
11. **When timing semantics change, update tests to check what the reader
    sees,** not when an internal value changes.
12. **Read the library's source** when behaviour is surprising (foliate's
    turn lock, pdf.js's text layer); it was faster than guessing every time.
13. **Use the auto-merge rules deliberately:** a draft PR holds the merge
    while a verification runs; then merge by hand once checks are green.
14. **Never run test projects that share data at the same time;** a
    "failure" that disappears when a project runs alone is a collision, not
    a bug.

## D. The strategy that emerged

By the end of (e), each change went through the same loop:

1. Write the change and its unit tests; run only the affected files.
2. Run the affected browser tests against a long-running local test server
   (rebuilding only the app), in both engines.
3. Break the fix on purpose and confirm a named test fails; if not, change the
   test's assertion until it does.
4. Run the whole suite from a fresh database, as CI does.
5. Have agents review the change, with a skeptic per finding; fix what the
   branch owns; record the rest with numbers the session re-derived.
6. Push as a draft PR. On a CI failure, download the trace, read the requests
   and the snapshot, then decide whether it is a flake or a real failure.
7. Have agents try to break the fixes too; mutation-check the new fixes.
8. Write the evidence as measured (command, output, commit, run id), mark the
   PR ready, merge once every check is green, and confirm `main` equals the
   checked commit.

Two habits ran through every step: scripted edits assert exactly one match,
and every claimed number is re-derived from its source.

## E. Unresolved questions

1. **Where does CI's WebKit spend its page-turn time?** Page 2's first word
   was lit 79, 68 and 92 ms late against a 100 ms limit, so that test may fail
   now and then on CI. Next step: log the turn's phases (turn asked, frame
   loaded, text layer ready, page reported, word lit) before choosing a fix,
   such as turning a PDF page slightly before its last word ends.
2. **How does a real iPhone behave?** Page-turn time, canvas memory, and
   audio start in Safari's own media stack (not GStreamer). This is step (f).
3. **Was the GStreamer start-time diagnosis right?** Setting the start time
   once the file's length is known fixed CI, but the mechanism was inferred
   from the requests, not shown.
4. **The matcher follow-up.** 168 words before footnote numbers, 46 words
   broken across pages, 4 suspended hyphens: fix them in the matcher, in the
   PDF text reader, or both? Either way the Kuhn package must be imported
   again.
5. **PDFs already on the shelf** keep text read without character maps, and
   the app cannot yet re-read a book's text.
6. **No reader-side check** that the server's text and the page's text layer
   agree.
7. **The intermittent upload-test hang** in CI's WebKit (iteration 17) has no
   known cause.
8. **Does the highlight keep time for Samuel** on Kuhn ch. 1? This is the
   second half of M13's done-when.
9. **A limit of this reconstruction:** the advisor's replies are stored
   encrypted in the transcript. Those in the first half were not available
   when writing this, so iteration 9 rests on what the session did next, not
   on the advice text.
