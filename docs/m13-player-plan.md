# M13 (d) and (e): the read-along players — plan for a dedicated session

Written for: the Claude session that builds M13 steps (d) EPUB player and
(e) PDF player, and for Samuel. Prepared 2026-10-04 by a research agent,
then checked by three skeptic agents that read the code and ran Chromium and
WebKit (Playwright 1.56.1) to confirm or correct every claim. Line numbers
are from `main` at `63c5fc1`; re-check them before editing.

Background: `docs/plan.md` (M13), `docs/readalong-plan.md`, the package
format in `tools/readalong/package-format.md`. Already merged: (a) package
check, (b) word-to-paragraph matching, (c1) ranged storage reads and part
uploads, (c2) import API + migration 0020, (c3) the "Your audiobook" upload
section on the book page.

## What exists

- An uploaded audiobook is one long audio file per package (or per
  chapter). Each paragraph of the book has an `audio_tracks` row with
  `source = 'upload'`, `voice = 'upload:<importId>'`,
  `cache_key = 'readalong:<importId>:<sectionId>'`, `audio_start_ms` /
  `audio_end_ms` (its stretch of the file) and `words`
  `[startMs, endMs, from, to]` where the times are **milliseconds from the
  start of the file** and `from`/`to` are offsets into the paragraph's text.
  Paragraphs where no spoken word matched have no row.
- Today's Listen plays one short clip per paragraph
  (`app/(reader)/books/[id]/read/ListenBar.tsx`) and highlights words with a
  per-frame follower (`wordAt`, `lib/speech/timings.ts:25`).

## Problems the skeptics proved (fix these as part of (d))

1. **Signed file links expire after 5 minutes, and every byte-range request
   re-checks them** (`lib/signed-url.ts:9`, `app/api/files/[...key]/route.ts:22-24`).
   One audio element playing a long file keeps asking for ranges, so after
   5 minutes: Chromium stops with `PIPELINE_ERROR_READ`; WebKit silently
   retries thousands of refused requests and sticks. Short browser tests will
   not show it. Fix: a longer-lived link for read-along audio (for example
   12 hours, still bound to the owner and key), or serve the audiobook through
   a route that checks the session cookie instead of a signature. Test it by
   shortening the expiry in a test.
2. **WebKit asks for closed ranges that run to the end of the file**
   (`bytes=0-21168043`). `servedRange` (`lib/http-range.ts:37-38`) caps only
   open-ended requests, so the server would read a whole 201 MB audiobook into
   memory for one request. Fix: cap closed ranges too (send at most 8 MB and
   say so in `Content-Range`; browsers ask for the rest). Prove WebKit and
   Chromium both keep playing with capped closed ranges.
3. **Setting `src` again reloads the audio, even to the same text** (abort,
   emptied, loadstart; time back to 0) in both engines, and every audio API
   call returns a freshly signed link. So the player must compare **storage
   keys**, seek within the same element, and set `src` only when the file
   changes.
4. **`Track` / `toTrack` drop `audioStartMs`, `audioEndMs`, `importId`**
   (`lib/library/audio.ts:21-35, 39-53`) although the table has them.
5. **"Your audiobook" is not a voice yet.** The audio route lists only
   `model.voices()` (`route.ts:46-53`); `storedTrack` matches only the
   ElevenLabs cache key and never returns an upload track.
6. **`next()` would fall back to paid speech** for a paragraph with no upload
   row (`ListenBar.tsx:114`: `body.track ?? trackFor(...)`): with a key it
   pays ElevenLabs, without one it gets 503. With an audiobook the player
   must skip to the next paragraph that has timings.
7. **The upload lookup must sit outside the route's inner try** (`route.ts:49-57`):
   `getSpeechModel()` throws `SpeechNotConfigured` without an ElevenLabs key
   and that branch is caught, so code placed inside it would be skipped. No
   test covers "audiobook, no ElevenLabs key" because tests run with
   `AI_FAKE=1`; add one.
8. Read-along is online-only: the service worker passes range requests
   straight to the network (`public/sw.js:25`). Fine for now; say so in the UI
   if offline.

## (d) EPUB player: changes by file

1. `lib/library/audio.ts`: add `uploadedReading(db, ownerId, bookId)`: the
   newest `ready` import's tracks, joined to `sections`, ordered by
   `sections.position`, rows without words left out:
   `[{ sectionId, cfi, audioKey, mime, startMs, endMs, words }]`. Add the
   three fields to `Track`.
2. `app/api/books/[id]/audio/route.ts` GET: before the speech-model try,
   look up `uploadedReading`. If found, return
   `audiobook: { voice: "upload:<importId>", name: "Your audiobook", files: { [audioKey]: longLivedUrl }, paragraphs: [...], startIndex }`
   with `startIndex` = the paragraph at the reading position, or the next
   timed one after it. Put "Your audiobook" first in `voices` so it is the
   default. `estimate: 0` so Play is enabled without a key.
3. `ListenBar.tsx`, in audiobook mode:
   - keep an index into `audiobook.paragraphs`; Play sets `src` only if the
     file differs (compare keys), waits for `loadedmetadata` if needed, sets
     `currentTime = startMs / 1000`, plays;
   - `follow()` (per frame): `t = currentTime * 1000`; when `t` passes the
     current paragraph's `endMs` (or the next one's `startMs`), move to the
     next paragraph: `onPassage(cfi)`, reset `lastWord`, keep playing (seek
     only if the next start is well ahead, i.e. an untimed gap); then
     `wordAt(p.words, t)` (times are file times; no offset);
   - `onEnded` advances only when the next paragraph is in another file;
   - note text "Your audiobook: free to play."; `changeVoice` must not fetch
     for `upload:` voices.
4. `Reader.tsx`: no change for EPUB (`highlightWord` and `showPassage` take a
   CFI plus offsets into the paragraph text).
5. Then update the book page's line "The Listen button will play it once the
   read-along player is finished…" in `app/(app)/books/[id]/AudiobookUpload.tsx`.

**Tests for (d):** unit (`uploadedReading` order, skips, start index;
route GET without a key still offers "Your audiobook"); Playwright in the
`readalong` project with a fixture package (`lib/readalong/fixture.ts`):
open the book, Listen shows "Your audiobook", play across at least two
paragraphs, record per frame `[currentTime, highlighted text, passage cfi]`
and audio events. Assert: two or more paragraphs; **no `emptied`/`loadstart`
after the first** (one element, never reloaded); every word in order, first
shown within 0.1 s of its start. Do **not** assert "no `waiting`": Chromium
fires waiting/canplay on every seek, WebKit fires none. In WebKit (the
`safari` project), read `CSS.highlights` directly: today's check only reads
`data-word`, which would pass even without the Highlight API. Add a test that
shortens the link expiry and plays past it.

## (e) PDF player

What the skeptics found:

- Each PDF page is its own iframe (`lib/reader/pdf-book.ts:57-73`); its body
  is an empty `#canvas` and `.textLayer`; `render()` (36-55) draws the canvas
  and rebuilds the text layer (line 51, `new pdfjsLib.TextLayer(...)`) on show,
  on zoom, **and on every resize** (foliate `fixed-layout.js:37, 136`), each
  time clearing it. With `spread: "none"` only one page iframe exists at a
  time.
- **The text layer cannot simply be re-joined into the server's paragraph
  text.** The server (`lib/library/pdf-sections.ts:41-53`) concatenates items
  with **no** separator and adds a space only when the baseline drops (not
  for a paragraph break, not when it rises). So running heads and page
  numbers get glued onto words: the demo PDF has
  `irreducibleIntroductionx`, `distinguishedIntroduction xv 13`. The text
  layer has one span per item plus `<br>` after end-of-line items, positioned
  by percentages, so spaces do not line up.
- **Proposed mapping:** count **non-whitespace characters**. A paragraph's
  start within its page = the number of non-space characters in the earlier
  paragraphs of that page; a word = its non-space start and length. Walk the
  `.textLayer` text nodes counting non-space characters to build the range.
  Spaces then do not matter. Rebuild after every `render()`.
- Server and browser use the same pdfjs-dist (6.4.299) and the same text
  options, but open documents differently (the server passes no `cMapUrl` and
  gets `useSystemFonts=false`), so PDFs with CJK or CID fonts may extract
  different text on the server. Untested; the demo PDF was identical.
- Today's `highlightWord` cannot work for PDFs: foliate's fixed layout
  `getContents()` returns `{doc}` with no index (`fixed-layout.js:308-313`),
  so `doc` is undefined; and `anchor(doc)` would throw for a bare page CFI.
  Add a PDF branch: find the page iframe, its `.textLayer`, map by
  non-space counts, set the highlight with **that iframe's** `CSS.highlights`;
  turn pages with `v.goTo(pageCfi)` when the paragraph's page changes, not by
  comparing word CFIs.
- The text layer is transparent (`pdf-book.ts:14`), so `::highlight` must set
  a background, not a text colour.
- Remove `|| props.fileType === "pdf"` at `Reader.tsx:796`.
- WebKit (26.0, Playwright build 2215) and Chromium (141) both support
  `CSS.highlights` inside same-origin iframes (checked locally on macOS; CI is
  Linux, recheck there).

**Tests for (e):** unit test of the non-space mapping with a fake
`.textLayer` built from a small generated PDF (no copyrighted text), including
a glued running head, a hyphenated line end and a second paragraph on the
page; Playwright in Chromium and WebKit: upload a generated PDF with a
matching fixture package, play across two paragraphs and a page break, check
every word in order within 0.1 s by reading `CSS.highlights` in the page
iframe, and that the page turns when the audio crosses it. Screenshots
(phone/desktop, light/dark) of a highlighted PDF word.

## Other engine differences worth knowing

- Folder pickers give files in different orders (Chromium: manifest first;
  WebKit: audio first) and `.wav` as `audio/wav` vs `audio/x-wav`: never rely
  on order or `file.type` (the upload client does not).
- WebKit seeks are slower (42-105 ms when downloaded, about 1.2-1.7 s
  otherwise), so seeking at paragraph boundaries could leave gaps in Safari:
  prefer playing straight through and only seek across untimed gaps.
- One unexplained Chromium `pause` happened once in 13 local runs (possibly a
  macOS media key); a strict "never pauses" test on a Mac may flake.

## Order and done-when

Do (d) first as one PR (route + `ListenBar` + the link-expiry and closed-range
fixes + tests), then (e) as its own PR. **Done when** (from `docs/plan.md`):
in the browser tests (Chrome and Safari engines) an uploaded package plays
across at least two paragraphs without a pause and the highlight lands on
every word in order, each within 0.1 s, in an EPUB and a PDF; then deploy
(backup first: migration 0020 runs) and Samuel reads Kuhn ch. 1 on the live
site and says it keeps time.
