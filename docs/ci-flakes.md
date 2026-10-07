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
| `e2e/safari.spec.ts:42` "in Safari, the read-aloud highlight lands on every word in order, on time" | WebKit | `expect(seen words).toEqual(expected words)` or a word later than 100 ms | 37610044764 (#105), 37573973731 (#101), 37619217097 (#98), 37627959389 ×2 (#108), 37638918531 (#104), 37643052389 (#110), 37652722201 (#110): eight, each green on re-run | the mechanism, read from `e2e/listen.ts` `expectHighlightKeepsUp` and the error (`Expected − 4`: words missing from the recorded sequence): the bar's highlight moves once per animation frame, and the test's observer records every change, so the missing words are real skips: with the fake voice at 30 ms a character a short word lasts about 100 ms, and on a loaded runner one frame can span it. A fix is a product decision (light a skipped word anyway? accept skips under load in the test?), not a re-run |
| `e2e/stats.spec.ts:72` "the stats page shows your trend by week…" | Chromium | `expect(received).toBeGreaterThanOrEqual(90)`, received 60: the 90 s timed save had not landed | 37611357638 (#106): once | the test's own timing of a slow save |
| `e2e/readalong.spec.ts:604` "an EPUB plays its audiobook straight on…" | WebKit | `playUntil: the audio never reached 680 ms`; `currentTime 0.63`, not paused, `readyState 2`, `networkState 2`, `buffered [0, 11.6]` | 37629382754 attempt 1 (#103); earlier 37478603601, 37484095289, 37536227334 | the "stands still right after the position is set" stall; #104's `playUntil` report lists the audio requests at the next one |
| `e2e/readalong.spec.ts:1370` "in a PDF, a page turned back from…" | WebKit | a 46 s stall | 37627959389 attempt 1 (#108): once | probably the same stall |
| `e2e/readalong.spec.ts:791` "on a phone with large text, the page turns…" | Chromium | `bar: "the" (word 83) shown 129 ms after it starts`, `Expected: < 100` | 37638918531 attempt 3 (#104): once | one word lit 29 ms late on a loaded runner; the 100 ms limit is the test's own |

## Causes removed

| Test | Browser | What the failure said | Seen | Cause and fix |
|---|---|---|---|---|
| `e2e/readalong.spec.ts:267` "a two-part upload is announced once, can be cancelled…" | WebKit | `page.goto: Navigation to "/library?new=collection" is interrupted by another navigation to "/books/…"` | 37627959389 attempts 2 and 3 (#108), 37629382754 attempts 2 and 3 (#103), then 37652722201 attempt 2 (#110, *with* #109's wait): five, after passing on #98, #99 and #100 | removing an audiobook sets its message, then `router.refresh()` (`AudiobookUpload.tsx`, `settle`); the test left the page before the refresh landed. #109: the test waits for the network to go idle first; not enough on a slow renderer (the refreshed page commits, and the router rewrites the address, after the quiet half-second). #110: `gotoPastRefresh`, a `page.goto` retried once on exactly "interrupted by another navigation" |
| `e2e/readalong.spec.ts:1990` "the part before never comes: after the wait's limit, Back lands 15 s back…" | WebKit | `page.waitForRequest: Timeout 10000ms exceeded` in `asksBefore`: Back pressed, no request for the part before; with #110's diagnostic: `The player: {"currentTime":36.53,"paused":false,"seeking":false,"readyState":4}` | 37638918531 attempts 2 and 4 (#104), 37643052389 attempt 1 (#110): three; passed on #103's run and on the laptop | the test's own margin: it pressed Back 15 s from 14.5 s into paragraph 69, which must land *before* 69 to ask for the part before (0.5 s of slack); on a slow runner the press came later and the skip stayed inside 69. #110: the test starts 10 s into the paragraph (5 s of slack) and the error carries the player's state |

## The day it was measured

On 2026-10-07 (the first day on GitHub's shared runners for a public repository) the browser job passed first time on
about one run in three; on 4 to 6 October it passed far more often. The `TIMING_JSON` lines the read-along tests
print (`cpu`, phase timings) are in every browser log: the first step before touching any of these tests is to
compare them between the two periods.
