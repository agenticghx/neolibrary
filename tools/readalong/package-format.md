# Read-along package format (`neolibrary-readalong/1`)

Written for: whoever builds Neolibrary's importer, and for checking a package
by hand. This is the contract between the skill (which makes packages) and
the app (which imports them). Change it only by bumping the version.

## Folder layout

```
<package>/
  manifest.json      what is in the package (below)
  audio/01.m4b       the audio: one file with chapter times, or one file per chapter
  scripts/01.txt     the text that was read aloud, one file per chapter (UTF-8)
  timings/01.json    when each word of scripts/01.txt is spoken
  checks/01.json     what the audio actually says compared with the script (may be absent)
  book-map.json      where each script paragraph is in the book
```

The book itself is not in the package: it is already in the reader's library.
`manifest.book.sha256` identifies which file the package belongs to.

## manifest.json

```json
{
  "format": "neolibrary-readalong/1",
  "title": "The Structure of Scientific Revolutions",
  "author": "Thomas S. Kuhn",
  "book": {"file": "Kuhn-SSR-2ndEd.pdf", "sha256": "…"},
  "audio": [{"file": "audio/01.m4b", "sha256": "…", "seconds": 23808.96}],
  "voice": "kyutai-pocket:javert | elevenlabs:<id> | free text for outside audio",
  "made_with": "who or what made the audio",
  "timings": {"source": "aligned", "aligner": "…", "checked_against_transcript": true},
  "chapters": [
    {"n": 1, "title": "Chapter One, Part One", "audio": "audio/01.m4b",
     "start": 0.0, "end": 1095.456, "script": "scripts/01.txt",
     "timings": "timings/01.json", "check": "checks/01.json"}
  ],
  "book_map": "book-map.json"
}
```

`start`/`end` are seconds within that chapter's audio file. With one file
per chapter, `start` is 0 and `end` is the file's length.

## timings/NN.json

```json
{"words": [
  {"w": "It", "from": 0, "to": 2, "start": 0.06, "end": 0.18, "score": -0.01, "source": "aligned"},
  {"w": "“Do", "from": 9534, "to": 9537, "start": null, "end": null, "score": null, "source": "not_spoken"}
]}
```

- One entry per word of the script, in order. A word is a run of
  non-space characters (`/\S+/`), so the app can rebuild the list from the
  script and check it.
- `from`/`to`: character offsets into the script (end exclusive). Neolibrary's
  word timings are `[startMs, endMs, from, to]`; convert with
  `[round(start*1000), round(end*1000), from, to]` after subtracting the
  chapter's `start` if the app plays the chapter as its own clip.
- `start`/`end`: seconds within the chapter's audio file (not from the
  chapter start). Starts are the reliable part: measured within about 0.04 s
  of ElevenLabs' own timings for 90% of words. Ends are shorter than the
  sound of the word (the model marks where it is sure); for highlighting,
  treat a word as current from its start until the next word's start.
- `score`: the aligner's confidence; 0 is certain, below about -2 the word
  was probably not spoken as written. The app may fall back to highlighting
  the sentence rather than the word there.
- `source`: `aligned` (measured from the audio) or `not_spoken` (in the
  script, not in the audio: never highlight it; the reader can still see it).

## checks/NN.json

The transcript comparison from `check_script.py`: `match` (share of words
that agree), `not_spoken` (character ranges the audio skipped), `extra`
(things said that are not in the script, with times). For people, not the
app; useful when a reader reports "the highlight jumped".

## book-map.json

```json
{"book": "Kuhn-SSR-2ndEd.pdf", "paragraphs": [
  {"script": "01.txt", "paragraph": 1, "from": 57, "found": true,
   "page": 12, "chapter": null, "quote": "Since that version was drafted, many other friends …"}
]}
```

One entry per script paragraph (paragraphs are separated by blank lines).
`page` is the PDF page (1-based); `chapter` the EPUB spine index. `quote`
is the opening of the paragraph as printed in the book, which the app can
search for on that page (the app already maps quoted text to positions for
notes). `found: false` is normal for headings written only for listening.
