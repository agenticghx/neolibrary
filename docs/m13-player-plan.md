# M13 (d) and (e): the read-along players — plan for a dedicated session

Written for: the Claude session that builds M13 steps (d) EPUB player and
(e) PDF player, and for Samuel. Prepared 2026-10-04 by a research agent,
then checked by three skeptic agents that read the code and ran Chromium and
WebKit (Playwright 1.56.1) to confirm or correct every claim. Line numbers
are from `main` at `63c5fc1`; re-check them before editing.

Background: `docs/plan.md` (M13), `docs/readalong-plan.md`, the package
format in `tools/readalong/package-format.md`. Built before this session:
(a) package check, (b) word-to-paragraph matching, (c1) ranged storage reads
and part uploads, (c2) import API + migration 0020, (c3) the "Your audiobook"
upload section on the book page (check `git log` that its pull request is
merged before starting).

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
5. Then update the book page's wording in
   `app/(app)/books/[id]/AudiobookUpload.tsx`: the sentences "Playing it with
   the words lit up comes in {later}. Until then it is checked and kept ready
   here." (ready state) and "…Playing it with the words lit up comes in
   {later}; for now the audiobook is checked against this book and kept
   ready." (empty state), and the `later` text ("the next update of the app",
   or for PDFs "…PDF books come after EPUB books"). After (d), say Listen plays
   it (EPUB); after (e), drop the PDF caveat. The browser test in
   `e2e/readalong.spec.ts` checks these sentences; change it with them.

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

## What (d) built (2026-10-04)

Written for the session that builds (e), and for Samuel. Built on branch
`m13-epub-player`; evidence in the `PROGRESS.md` Log. Then five reviewers
(player, server, tests, regressions, wording) read it, a skeptic checked
each finding, and every confirmed one was fixed (listed at the end).

- **Problem 1, links that expire:** the plan's second option. The audio is
  served by `GET /api/books/<id>/readalong/<importId>/audio/<n>`, checked by
  the sign-in cookie and the owner, with no signature and no expiry. So
  "shorten the expiry and play past it" has nothing left to test; the browser
  test checks instead that the address has no `exp`/`sig`, that ranges come
  with the cookie alone, and that a signed-out request gets 401. Serving the
  bytes is shared with `/api/files` in `lib/serve-file.ts`, which also sends
  a large file asked for whole in pieces instead of reading it whole.
- **Problem 2, closed ranges:** a closed range ("bytes=0-<last>", how
  Safari's engine asks for a whole file) is answered with at most 8 MB, and
  the player asks for the rest. An open-ended range ("bytes=N-", from here to
  the end, how Chromium and WebKit on Linux ask) is answered in full, but
  read and sent 8 MB at a time (`lib/serve-file.ts`), so memory stays small.
  It was capped at first; CI showed WebKit on Linux (GStreamer) takes a
  shorter answer to "from here to the end" for the end of the file and stops
  playing. The browser tests run with pieces of 64 KB
  (`FILES_MAX_RANGE_BYTES`, `TEST_MAX_RANGE` in `e2e/pages.ts`), so every
  test that plays audio crosses several pieces and checks that the audio
  never stalled (the audio clock keeps pace with the wall clock).
- **Problem 3, reloading:** one audio element; its source is set only when
  the file number changes. The tests count `loadstart` events: one per file.
- **Problems 4 to 7:** `Track` has the three fields; `listenInfo`
  (`lib/library/listen.ts`) looks the audiobook up before the voice service,
  so it is offered with no ElevenLabs key (unit test with an environment
  without the key); audiobook mode never asks for made-on-demand audio. The
  ElevenLabs voice list is now kept for ten minutes and waited on for at most
  3 s, so a slow ElevenLabs cannot hold the audiobook up.
- **Problem 8, offline:** the bar says reading aloud needs an internet
  connection, both when Listen is opened offline and when the audio fails
  offline (browser test with the network turned off).
- **Changes from the plan:**
  - The response lists the timed paragraphs *from the reading position on*
    (no `startIndex`), 200 at a time: `more` says where the next part
    starts, `partsUrl` serves it, and the bar asks for it 40 paragraphs
    before it runs out. An empty list means the audiobook ends before here.
  - The audiobook is the default voice only when it begins near the reading
    position (same chapter, or within 10 paragraphs). Further on, the bar
    says where it begins ("begins further on (Search for Mr. Hyde): Play
    turns to it") and a made voice is the default, so Play never takes the
    reader chapters ahead unasked (it would also move their saved place).
  - `estimate` stays null without a key: Play is enabled by choosing "Your
    audiobook", so the note for a made voice stays honest.
  - A whole PDF page now starts reading at its first paragraph
    (`passageFor` used to pick the page's last; every PDF paragraph has its
    page's address). (e) needs this.
  - The per-frame logic is a pure function, `follow` in
    `lib/readalong/player.ts`, with its own tests. What lies between
    paragraphs plays: pauses, a chapter title read aloud, a paragraph's last
    words that got no time. Only untimed audio longer than **6 s** is
    skipped by a seek. The page turns to the next paragraph **as soon as the
    last word before it is over**, and a skip waits 0.85 s more, so a new
    chapter (or PDF page) has opened before its first word. A file with
    nothing more on the page for 6 s hands over to the next file, which
    starts at its beginning (its chapter title is heard).
  - The Listen bar is a row of the reader's grid between the page and the
    foot, not floating over the page: on a phone it used to hide the last
    three lines, where the word being read was.
  - Switching voices hands the place over (a made voice reads on from the
    audiobook's paragraph, and back); made-voice audio still being fetched
    when the voice changes is dropped.
  - Play after a pause goes back to the page of the word being read if the
    reader turned away (not to the paragraph's first page: in a long
    paragraph that would turn back and then forward again). "Loading your
    audiobook…" shows when the audio has waited for data for more than 0.6 s.
  - The automatic page turn (from M7, shared with made voices) goes straight
    to the word's page, and its "turning" flag clears when the request ends:
    foliate ignores a turn asked for within 0.1 s of the last one and then
    sends no "relocate", so after a jump of several pages the page used to
    stop turning for good.
  - A word is counted as lit only when it was found on the page, so a word
    asked for while a chapter is still opening is tried again on the next
    frame; an error in one frame (a chapter half-opened) no longer stops the
    per-frame loop for the rest of the session.
- **Found while testing (step (b), not fixed here):** the matcher anchors a
  chapter's audio at the first place in the book chapter where its first
  four words agree. A package that starts mid-chapter can be placed wrongly
  when its opening words also occur earlier in that chapter (Jekyll's
  "how did you know me" is in two paragraphs). Real packages start at a
  chapter's start, so it is unlikely there; the book map's `quote` and
  paragraph order could anchor it more firmly. The browser tests use
  paragraphs checked to be placed exactly.
- **Engines:** CI runs WebKit on Linux, which plays media through GStreamer,
  not Safari's AVFoundation; its first audio request asks for no range, and
  Playwright reports that answer with status 0; the tests accept a whole-file
  answer (status 0 or 200) only to a request that asked for no range. The closed
  whole-file range ("bytes=0-<last>") is Safari-on-Mac behaviour, checked by
  local Mac runs. GStreamer also stalled ("Loading your audiobook…" for
  good) when the start time was set before the file's length was known, far
  into a 16 MB file (CI run 37260648155); so play() is still called at once
  (inside the click, as Safari needs), but the start time is set on
  `loadedmetadata` (the moment the first bytes, which say how long the file
  is, have arrived), and the follower waits until then. Real Safari on an
  iPhone has not been tried: that is (f).

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
  numbers get glued onto words: the Descartes demo PDF has
  `irreducibleIntroductionx`, `distinguishedIntroduction xv 13` (Samuel's
  Kuhn draws its running head first, so there it is its own paragraph). The text
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

## What (e) built (2026-10-05)

Written for the session that does (f), and for Samuel. Built on branch
`m13-pdf-player-v2`; evidence in the `PROGRESS.md` Log. Three reviewers
(the reader in the browser, the server, the tests) read it and a skeptic
checked each finding: 17 confirmed, 1 uncertain, none refuted. What was done
about each is below.

- **What you get:** in a PDF book, **Listen** plays the book's own
  audiobook, and each word lights up on the page as it is spoken, over its
  printed letters. Made voices still cannot be placed on a PDF page, so a
  PDF without an audiobook says "In a PDF book, Listen plays your own
  audiobook: add one on the book's page."
- **How a word is found on the page:** as planned, by counting non-space
  characters from the top of the page. The server sends each word's count
  with its times (`inPage` in `lib/library/audio.ts`, from every paragraph
  on that page, including the running head and those outside the part being
  sent); the reader walks the page's text layer (pdf.js's invisible copy of
  the page's text over its picture) to the same count (`rangeForNonSpace`,
  `lib/reader/text-range.ts`) and lights it with the CSS highlight in that
  page's frame. Spaces do not matter, so a running head glued onto a word
  does not move the count. The browser test checks that the page's text
  layer and the server's text for the page are the same characters.
- **The text layer is built once per page shown** (`lib/reader/pdf-book.ts`),
  at the same time as the picture, not after it, and a new size lays the
  same text out again (pdf.js's `TextLayer.update`) at the moment the new
  picture is ready. It used to be thrown away and built again on every
  resize; two of those under way at once (a window being dragged) could
  leave pieces of both, and words would be lit on the wrong text (review
  finding, "major"). An older drawing still under way is cancelled; a
  drawing at the size already shown is skipped.
- **Page turns:** the player turns the page as soon as the last word on it
  is over (as in (d)), and a sentence that runs on across a page break with
  no pause works: in the browser test, page 2 was shown 17 to 50 ms after
  page 1's last word ended, and its first word was lit about 20 ms after it
  began (Chromium and WebKit, laptop; the limit is 100 ms). A probe on
  Samuel's Kuhn PDF (a temporary test, not kept, run on the laptop) measured
  the time from a page turn to its text layer being ready: median 22 ms in
  Chromium and 33 ms in WebKit; at phone size with 3 pixels per point, 21 and
  34 ms; with Chromium's processor slowed 4 times, 33 to 42 ms. So drawing
  the next page ahead of time, which a reviewer proposed, was not needed;
  a real iPhone is tried at (f).
- **A page turned back from while it is read comes back** at the next word
  (as an EPUB's pages follow the voice); a page turned to ahead is left
  alone. While a page is opening, the reader does not ask for it again
  (foliate shows one page at a time and fails on a second request).
- **Rotated pages:** pdf.js's three rules that turn the text layer with a
  page printed sideways were missing; added, with a test on a page turned a
  quarter turn.
- **Character maps on the server:** the server now opens PDFs with pdf.js's
  character maps, as the reader does. Without them, text in some fonts
  (Chinese, Japanese, Korean) was missing on the server but shown on the
  page, and every word after it on that page was lit on the wrong letters.
- **Parts by words too:** a part of the paragraph list stops at 200
  paragraphs or about 8,000 words (always at least one paragraph). Kuhn's
  PDF paragraphs are often whole pages, so 200 of them were most of the
  book. Measured on Kuhn with a reviewer's script (`size.mjs`, re-run with
  the word cap): the first part was 200 paragraphs, 181 of 221 pages,
  54,969 words, 2.16 MB (0.74 MB compressed) every time Listen opened; it
  is now 37 paragraphs, 8,006 words, 0.31 MB (0.11 MB compressed).
- **Tests:** the test PDF is laid out as Kuhn is (running head drawn first,
  page number last, footnotes in smaller type with italics, so pdf.js sends
  the page's text in two pieces), and every word read aloud must light up,
  page 2's first word too, which follows page 1's last with no pause; the
  unit test sends parts of three paragraphs so that a part starts in the
  middle of a page. Earlier comments said the running head glued onto the
  last word was "as in the Kuhn PDF": that was the Descartes demo PDF; Kuhn
  draws its running head first, so it is a paragraph of its own.

**Found by the review, not fixed here** (older code from steps (b) and (c):
the matcher and the PDF text reader; each needs the audiobook imported again
to take effect, so they belong in a follow-up). Counted on Samuel's own
narration of Kuhn (`kuhn-ssr-word-timings.json`) against his PDF with this
branch's code, by a reviewer's script re-run for this note
(`node <scratchpad>/skeptic-srv/verify1.mjs anchor`): 67,270 of 67,824
spoken words matched (99.18%). Words that never light up:

1. **168 words before a footnote number** ("research.2"): the number is
   raised, the server adds a space only when the line goes down, so it is
   glued on, and the narrator does not say it.
2. **46 words broken across a page** ("phe-" / "nomena"): both halves stay
   unlit, because the matcher joins a broken word only within one paragraph
   and each PDF page is its own paragraphs. The page then turns one word
   early.
3. **4 suspended hyphens** ("pre- and post-"), joined into one word that is
   never said.
4. 553 others, mostly numbers and abbreviations read out differently
   ("1962" said as "nineteen sixty-two", "i.e." as "that is").

Also not done: a check in the reader that the server's text and the page's
text layer agree (the server now uses the same character maps, and the
browser test compares them for its page, but a PDF that differs in some
other way would light words in the wrong place without a warning).

## Other engine differences worth knowing

- Folder pickers give files in different orders (Chromium: manifest first;
  WebKit: audio first) and `.wav` as `audio/wav` vs `audio/x-wav`: never rely
  on order or `file.type` (the upload client does not).
- WebKit seeks are slower (42-105 ms when downloaded, about 1.2-1.7 s
  otherwise), so seeking at paragraph boundaries could leave gaps in Safari:
  prefer playing straight through and only seek across untimed gaps.
- One unexplained Chromium `pause` happened once in 13 local runs (possibly a
  macOS media key); a strict "never pauses" test on a Mac may flake.

## Before the first deploy of M13 (step (f))

Found by the reviewers of (c3); none can be checked from the laptop alone:

1. **Backup first**: the deploy runs migration 0020 at startup (the recipe is
   in the PROGRESS.md 2026-10-04 11:40 entry).
2. **Try the real bucket once**: a package with audio over 16 MB (three 8 MB
   parts or more), so the bucket's multipart join, its 5 MB minimum part size,
   a HEAD and a ranged GET are all exercised. The tests enforce the same rules
   with local storage, but the bucket itself has not been tried.
3. **Time the last step on the real bucket**: "finish" re-reads every audio
   byte (8 MB at a time) to check its fingerprint, in one request that sends
   nothing back until done; Railway closes a silent request after a few
   minutes. Time a 201 MB finish. If it is close to the limit, stream a
   keep-alive from the finish route, or check the fingerprint while the parts
   arrive.
4. **Bucket clean-up rule** (Samuel, Railway settings): abandoned part uploads
   are cancelled when the same reader starts another upload, after two days;
   a bucket "lifecycle rule" that aborts incomplete multipart uploads after a
   few days would catch readers who never come back.

## Order and done-when

Do (d) first as one PR (route + `ListenBar` + the link-expiry and closed-range
fixes + tests), then (e) as its own PR. **Done when** (from `docs/plan.md`):
in the browser tests (Chrome and Safari engines) an uploaded package plays
across at least two paragraphs without a pause and the highlight lands on
every word in order, each within 0.1 s, in an EPUB and a PDF; then deploy
(backup first: migration 0020 runs) and Samuel reads Kuhn ch. 1 on the live
site and says it keeps time.
