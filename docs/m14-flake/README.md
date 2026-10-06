# WebKit read-along flakes on CI: the plan and its files

Written for the Claude session that removes the WebKit read-along failures
on CI (M14, before step 6a), and for Samuel, who needs only `plan.md` §3
(his decisions).

`plan.md` is the plan, as a read-only design workflow wrote it on
2026-10-06 from four analyses (pdf.js font loading, the Listen bar's update
path, measuring on CI, the other failure kinds). Where it says `$S/…` (the
session's scratchpad, which does not last), use these copies:

| In `plan.md` | Here | What it is |
|---|---|---|
| `$S/timing-measurement.patch` | `timing-measurement.patch` | Step 1: timing marks (off for readers), a recorder that prints timings before any check, and a GitHub workflow that runs one test many times. `git apply --check` passed on `main` 8cd0b49. |
| `$S/barfix/{Reader.tsx,ListenBar.tsx,listen.ts}` | `bar-fix.diff` | Step 2: the reader writes the spoken word to the Listen bar's `data-word` in the same step as it lights it. |
| `$S/tscheck/warmup.diff` | `pdf-warmup.diff` | Step 3: draw the next PDF page once, small and thrown away, so its fonts load before the page turn. |
| `$S/plan-logs/replay.py`, `$S/flake/decode.py` | `replay.py`, `decode.py` | Replay a decoded CI recording; decode Playwright trace values. |
| `$S/flake/*-recording.json`, `words.json` | `*.json.gz` | The per-frame recordings decoded from three CI traces (`gunzip -k` first). |

The CI traces themselves (300 MB) and the WebKit and GStreamer source files
the analyses read were not kept: the plan cites their line numbers, and CI
keeps run logs for 90 days (`gh api repos/sahuno/neolibrary/actions/jobs/<id>/logs`).

Rules the plan keeps: the 100 ms limit never changes; each step removes a
cause, in its own PR; each fix has a check that fails without it, and CI
results from several runs (one run proves nothing).
