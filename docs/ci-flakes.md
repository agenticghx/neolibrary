# CI flakes: the tests that fail without a change in the code, with evidence

Written for Claude sessions (and Samuel, who reads it to know what the red checks mean). A "flake" is a test that
fails on some runs and passes on others with the same code. The rule (M14 flake plan): separate a flake from a
failure with evidence, remove a flake's cause rather than re-running, and when the same test fails twice in a row on
one pull request, treat it as real until shown otherwise — twice that was a race in the test, not luck.

The merge train (`.claude/skills/merge-train`) re-runs a job once when every failing test matches
`.claude/skills/merge-train/scripts/flaky-tests.txt`. Add a line here when you meet a flake; add the fix's PR
number when its cause is removed; drop its pattern from `flaky-tests.txt` once it has been quiet for a week.

## Open

| Test | Browser | What the failure says | Seen (runs, 2026-10-07 unless noted) | Cause |
|---|---|---|---|---|
| `e2e/safari.spec.ts:42` "in Safari, the read-aloud highlight lands on every word in order, on time" | WebKit | `expect(seen words).toEqual(expected words)` or a word later than 100 ms | 37610044764 (#105), 37573973731 (#101), 37619217097 (#98), 37627959389 ×2 (#108), 37638918531 (#104), 37643052389 (#110), 37652722201 (#110): eight, each green on re-run | the mechanism, read from `e2e/listen.ts` `expectHighlightKeepsUp` and the error (`Expected − 4`: words missing from the recorded sequence): the bar's highlight moves once per animation frame, and the test's observer records every change, so the missing words are real skips: with the fake voice at 30 ms a character a short word lasts about 100 ms, and on a loaded runner one frame can span it. A fix is a product decision (light a skipped word anyway? accept skips under load in the test?), not a re-run. **2026-10-09:** also run 37988043034 attempt 1 (#126). Samuel chose (b) (PROGRESS.md Open unknowns row 14): the test now accepts a missing word only when the page never redrew while it was said (`lib/player/highlight-check.ts`); a word later than 100 ms still fails. Keep the pattern in `flaky-tests.txt` until the test has been quiet for a week. **2026-10-11:** scheduled run 38148803577 attempt 1 on main (20ed7a4): "dreary" was lit 142 ms after the voice started it (limit 100 ms); M19 did not touch EPUB read-aloud timing |
| `e2e/stats.spec.ts:72` "the stats page shows your trend by week…" | Chromium | `expect(received).toBeGreaterThanOrEqual(90)`, received 60: the 90 s timed save had not landed | 37611357638 (#106): once. **2026-10-11:** 38176713897 attempt 1 (#165): the week of 5 Oct showed "6 min" where `/[45] min/` was expected; green on the re-run. Not investigated; a guess: the week of 5 Oct is still the current week, so reading by earlier projects may count in it until Monday 12 Oct | the test's own timing of a slow save |
| `e2e/readalong.spec.ts:604` "an EPUB plays its audiobook straight on…" | WebKit | `playUntil: the audio never reached 680 ms`; `currentTime 0.63`, not paused, `readyState 2`, `networkState 2`, `buffered [0, 11.6]` | 37629382754 attempt 1 (#103); earlier 37478603601, 37484095289, 37536227334; again on `main` after #200 (now `readalong.spec.ts:729`): run 39176268796 attempt 1 (b103b0fb, 2026-10-18, `playUntil` timeout 45 s), green on the re-run | the "stands still right after the position is set" stall; #104's `playUntil` report lists the audio requests at the next one |
| `e2e/readalong.spec.ts:1370` "in a PDF, a page turned back from…" | WebKit | a 46 s stall | 37627959389 attempt 1 (#108): once | probably the same stall |
| `e2e/home.spec.ts:193` "/library has the same View switch" | Chromium | `expect(getByTestId('spines')).toBeVisible()` failed, `Received: hidden` after 5 s, though the locator resolved to the `<ul data-testid="spines">` 9 times | 37999281935 attempt 1 (#128, 2026-10-09): once; #128 changes no app code (test files and docs only), and the same test passed on #127's run that day | not investigated beyond the error: the list was in the page but not counted as visible (zero size or still hidden by the View switch's change) |
| `e2e/readalong.spec.ts:791` "on a phone with large text, the page turns…" | Chromium | `bar: "the" (word 83) shown 129 ms after it starts`, `Expected: < 100` | 37638918531 attempt 3 (#104): once | one word lit 29 ms late on a loaded runner; the 100 ms limit is the test's own |

## Causes removed

| Test | Browser | What the failure said | Seen | Cause and fix |
|---|---|---|---|---|
| `e2e/uploads.spec.ts:446` "books are added from a Google Drive link to a shared folder; other files are skipped" | Chromium | axe `document-title` on `html` at the first look (desktop light), `Expected []`, `Received ["desktop light document-title"]` (`uploads.spec.ts:472`) | 39788695057 attempt 1 (#219, 2026-10-22), the first time the test ran on that branch; #219 changes no code the test touches (page text only); passed on #217's and #218's runs | the same race as `review.spec.ts` (above, #175): a successful Drive import calls `router.refresh()` (`useBookUpload.ts`) so the audiobook picker lists the new books, and during that refresh the page title is empty for a moment, which the accessibility check ran into. Fix (m30-drive-title-wait): the test waits until the title reads "Import" again before the first check, as review.spec.ts does. Not listed in `flaky-tests.txt` |
| `e2e/readalong.spec.ts:1652` (was `:1629`) "a PDF is read aloud in a made voice: every word lit in order on its page…" | Chromium | `page 2 shown when its first word was lit`, `Expected: "epubcfi(/6/4)"`, `Received: "epubcfi(/6/2)"` (`readalong.spec.ts:1789`, was `:1766`) | 38023071378 attempt 1 (#134, 2026-10-10); `main` after #137 (run 38035730993); `main` after #170 (run 38188681497, 2026-10-12); twice on #200 (run 39173476108 attempts 1 and 2, 2026-10-18); three times on #211 (run 39349975911 attempts 1 and 2, run 39355817168, 2026-10-19), while #212 and #213, with the same code, passed. None of these pull requests touched the reader | the test read the page on screen from the reader's `data-cfi`, which React wrote one render *after* foliate showed the page. foliate shows the next PDF page and sends `relocate` in one step; the page's text layer is ready 1 to 4 ms later and lights its first word (`via: text-layer`); React wrote `data-cfi` 2 ms after `relocate` on an idle laptop but 22 ms after on a loaded one, and a screen frame in between recorded the word lit with page 1 still in `data-cfi`. In that frame the word was on page 2 and on screen (the test's own `onScreen` column: true): no reader saw a word lit on a page not yet shown. Reproduced on the laptop with Chrome's CPU slowed 6 times (`Emulation.setCPUThrottlingRate`): 3 of 6 runs failed with the CI message. Fix (#214): the reader writes `data-cfi` itself in the `relocate` handler, in the same step as foliate shows the page, as `recordLit` already does for the lit word (LEARNING_LOG Iterations 25 and 39); the assertion is unchanged. With the fix: 12 of 12 passed at 6 times slower, 10 of 10 at normal speed. It was never in `flaky-tests.txt` |
| `e2e/reader.spec.ts:915` "Spine fold › in Night the turning sheet is dimmed like the pages, and as printed when they are" | Chromium | `expect.poll(() => pdfLeaves(page)).toEqual([1, 2])` received `[3, 4]` | 38271487444 attempt 1 (#175, 2026-10-12). The same test passed on main the same day (run 38200557078, 4.7 s) | the test before it, in the same file, leaves the shared PDF "Spine Fold Line" on pages 3 and 4. The place is saved about half a second after a turn. Continue reading reopens there once that save has landed; two pages are already showing, so the step that only waits for a pair stays put. The page-ahead change does not open Listen, so it does not move this book. Fix (#175): walk back to pages 1 and 2 before measuring the turn. Not listed in `flaky-tests.txt` |
| `e2e/review.spec.ts:70` "Daily review: the passage, Show, rate with the keys…" | Chromium | axe `document-title` on `html`, look name `empty` | 38273542441 attempt 1 (#175, 2026-10-12), after the spine test above had passed. The new PDF page-ahead test passed in the same run (2.7 s) | the last rating calls `router.refresh()` so the sidebar count updates (`ReviewSession.tsx`). The empty state is already on screen, and for a moment during that refresh the page title is empty. Fix (#175): wait until the title reads Review, then run the same accessibility check. Not listed in `flaky-tests.txt` |
| `e2e/shell.spec.ts:440` "command palette › works in the reader, and its keys do not turn the page" | Chromium (Linux) | `expect(getByRole('dialog', { name: 'Go to' }).getByRole('combobox', …)).toBeFocused()` failed, `element(s) not found`, at the third Cmd+K (line 467), pressed 12 ms after Escape closed the palette | 38175236571 attempt 1 (#164, 2026-10-11); 4 of 4 runs in Playwright's Linux image on the laptop (arm64); passed on #162's, #167's and main's runs the same day, and on the Mac | a real race in the app, not the test. A dialog's `close` event is sent a moment after it closes (on Linux, up to about 20 ms). Cmd+K inside that moment opened the palette again, then the late `close` event reached `onClose`, which closed the new one (a logged run: showModal at 2 ms, the stale close event at 5 ms, `close()` called from `onClose`). Fix (m21-palette-race): `onClose` ignores the event while the dialog is open; then 177 passed in the Linux image |
| `e2e/readalong.spec.ts:267` "a two-part upload is announced once, can be cancelled…" | WebKit | `page.goto: Navigation to "/library?new=collection" is interrupted by another navigation to "/books/…"` | 37627959389 attempts 2 and 3 (#108), 37629382754 attempts 2 and 3 (#103), then 37652722201 attempt 2 (#110, *with* #109's wait): five, after passing on #98, #99 and #100 | removing an audiobook sets its message, then `router.refresh()` (`AudiobookUpload.tsx`, `settle`); the test left the page before the refresh landed. #109: the test waits for the network to go idle first; not enough on a slow renderer (the refreshed page commits, and the router rewrites the address, after the quiet half-second). #110: `gotoPastRefresh`, a `page.goto` retried once on exactly "interrupted by another navigation" |
| `e2e/readalong.spec.ts:1990` "the part before never comes: after the wait's limit, Back lands 15 s back…" | WebKit | `page.waitForRequest: Timeout 10000ms exceeded` in `asksBefore`: Back pressed, no request for the part before; with #110's diagnostic: `The player: {"currentTime":36.53,"paused":false,"seeking":false,"readyState":4}` | 37638918531 attempts 2 and 4 (#104), 37643052389 attempt 1 (#110): three; passed on #103's run and on the laptop | the test's own margin: it pressed Back 15 s from 14.5 s into paragraph 69, which must land *before* 69 to ask for the part before (0.5 s of slack); on a slow runner the press came later and the skip stayed inside 69. #110: the test starts 10 s into the paragraph (5 s of slack) and the error carries the player's state |

## Not flakes: a crash inside Playwright's own copy of WebKit (resolved 2026-10-19 by Playwright 1.64.1)

**Resolved.** Playwright 1.64.1 (WebKit 27.2, folder `webkit-2370`) no longer crashes: the check below now prints
`webkit /b.html: next page loaded: no crash | entries 3, current 2`, the same as Chromium, where 1.56.1 printed
`webkit PAGE CRASHED`. The focus test's "walk away" in WebKit (setup + a WebKit copy of the `focus` project) passed
(`2 passed (2.4m)`). Nothing below applies to the current WebKit; it stays as the record, and the check is worth
running again after a Playwright upgrade or a Safari update.

Found 2026-10-19 while checking M26 R4b; this section is written for Claude sessions that run a test in WebKit (Safari's
engine) and see `Page crashed`. Playwright downloads its own build of each browser; "Playwright's WebKit" below means
that build (folder `webkit-2215`, Playwright 1.56.1, user agent "Version/26.0"), not the Safari on Samuel's Mac or
iPhone.

| Test | Browser | What the failure says | Seen | Cause |
|---|---|---|---|---|
| `e2e/focus.spec.ts:344` "a focus session you cannot walk away from…" | Playwright's WebKit on a Mac (not in CI: the `focus` project runs in Chromium only) | `page.goto: Page crashed`, `navigating to "…/account"` at `focus.spec.ts:412`, the line before `fourLooks(reader, "focus-account", …)` | every run tried: twice on `m26-r4b-ways-out`, once on main at 67e7ef4 (the session that found it), once more on main at 31b815b here | a bug in Playwright's WebKit, not in Neolibrary and not in Safari 27: see below. Every time, not now and then |

**What triggers it.** Three steps in one tab: (1) the page changes its own address without loading a new page
(`history.pushState`; every link inside a Next.js app does this, a "soft navigation"); (2) the page is reloaded; (3) any
other page is loaded in that tab (`page.goto`, or following an ordinary link). Step 3 crashes. It needs no focus
session, no Account page, no change of window size and no dark mode (`emulateMedia`): the two-page script below, with
no Neolibrary code at all, crashes the same way, and without step 1 it does not crash. In the focus test, step 1 is
the Review link on Account (the server sends it to the focused book), step 2 is "A reload keeps the time left", step 3
is `reader.goto("/account")`.

**Why.** Browsers keep a list of the tab's history for the Navigation API (`window.navigation`, a newer way for pages
to read their own history). In Playwright's WebKit, `pushState` adds to `history.length` but not to that list: a probe
printed `entries 1 → 1` after `pushState`, where Chromium printed `1 → 2`. After the reload, `navigation.currentEntry`
is `null`, which the standard never allows. When the next page starts, WebKit copies the old page's list and stops
itself on an internal check. The crash report (`~/Library/Logs/DiagnosticReports/com.apple.WebKit.WebContent.Development-*.ips`,
`EXC_BREAKPOINT`) has `WebCore::Navigation::initializeForNewWindow` at the top, called from `FrameLoader::didBeginDocument`
as the new page's first bytes arrive. Which check fails is a guess: in WebKit's current source that function has one
`RELEASE_ASSERT` (a check kept in shipped builds that stops the page on purpose), that the old list is longer than the
old current position; the list left behind above would fail it.

**Safari is not affected (checked 2026-10-19).** The same three steps, in the same kind of two-page test:

| Browser | After `pushState` | After the reload | The next page |
|---|---|---|---|
| Playwright's WebKit (Version/26.0) | entries 1, current 0 | entries 1, current `null` | **crashed** |
| Safari 27.0 on macOS 26.7.1 | entries 2, current 1 | entries 2, current 1 | loaded |
| Safari 27.0 in the iPhone 18 Pro simulator, iOS 27.0 | entries 2, current 1 | entries 2, current 1 | loaded |
| Playwright's Chromium | entries 2, current 1 | entries 2, current 1 | loaded |

Playwright's WebKit is a snapshot of WebKit's development version (its framework says 623+) that calls itself Safari
26.0; the Safari tested here is 27.0, and this repository pinned Playwright 1.56.1 (until 2026-10-19) while 1.64.1 was out. So the WebKit in
the tests is the older one, and the fault is most likely one WebKit has since fixed. Confirmed 2026-10-19: Playwright 1.64.1's
WebKit 27.2 does not crash (see Resolved, above).

**What to do when you meet it.** Do not change the app for it. Do not re-run: it fails every time. In a WebKit test,
avoid a reload followed by `page.goto` in the same tab after a soft navigation (open a new page for the next step,
or go to the next address before reloading). CI runs WebKit only for `safari` and `readalong-safari` (on main and the
night run), whose tests have not hit this pattern so far. No upstream report was found (`gh search issues --repo
microsoft/playwright`, "webkit page crashed" and "pushState webkit", 2026-10-19).

**The check.** Save this as `webkit-history-crash.mjs` outside the repository and run it from the repository root
(it uses Playwright from `node_modules`). With Playwright 1.56.1 it printed `webkit PAGE CRASHED`; with 1.64.1 both
WebKit and Chromium print `/b.html: next page loaded: no crash | entries 3, current 2`. For Safari, run `node webkit-history-crash.mjs serve` and open
`http://127.0.0.1:3199/a.html` (an iPhone simulator: `xcrun simctl openurl booted http://127.0.0.1:3199/a.html`); the
page should end on `/b.html: next page loaded: no crash`.

```js
// pushState, reload, then another page: crashed Playwright 1.56.1's WebKit; not 1.64.1's, nor Safari 27.
// Run from the repository root: node webkit-history-crash.mjs (Playwright's WebKit and Chromium),
// or node webkit-history-crash.mjs serve, then open http://127.0.0.1:3199/a.html in Safari.
import { createServer } from "node:http";
const page = (body) => `<!doctype html><meta name=viewport content="width=device-width"><pre id=o></pre><script>
const say = (m) => { const n = window.navigation; o.textContent += location.pathname + location.search + ": " + m +
  " | entries " + (n ? n.entries().length + ", current " + (n.currentEntry?.index ?? null) : "none") + "\\n"; };
const step = sessionStorage.getItem("step"); ${body}</script>`;
const A = page(`if (!step) { say("loaded"); history.pushState({}, "", "?pushed"); say("after pushState");
  sessionStorage.setItem("step", "reloaded"); setTimeout(() => location.reload(), 300); }
else { say("after reload"); sessionStorage.removeItem("step"); setTimeout(() => (location.href = "/b.html"), 300); }`);
const B = page(`say("next page loaded: no crash")`);
const server = createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(req.url.startsWith("/b") ? B : A)).listen(3199);
if (process.argv[2] !== "serve") {
  const { webkit, chromium } = await import(new URL("node_modules/playwright/index.mjs", `file://${process.cwd()}/`).href);
  for (const type of [webkit, chromium]) {
    const browser = await type.launch();
    const p = await browser.newPage();
    p.on("crash", () => console.log(type.name(), "PAGE CRASHED"));
    await p.goto("http://127.0.0.1:3199/a.html");
    await p.waitForTimeout(2000);
    console.log(type.name(), await p.locator("#o").innerText().catch(() => "(no page)"));
    await browser.close();
  }
  server.close();
}
```

## The day it was measured

On 2026-10-07 (the first day on GitHub's shared runners for a public repository) the browser job passed first time on
about one run in three; on 4 to 6 October it passed far more often. The `TIMING_JSON` lines the read-along tests
print (`cpu`, phase timings) are in every browser log: the first step before touching any of these tests is to
compare them between the two periods.
