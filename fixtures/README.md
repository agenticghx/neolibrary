# Test fixtures

Written for: Claude sessions writing tests. Ground rule 1: only
public-domain books live here; never a copyrighted book.

## books/

| File | Book | Source | Licence |
|---|---|---|---|
| `stevenson-jekyll-and-hyde.epub` | *The Strange Case of Dr. Jekyll and Mr. Hyde*, Robert Louis Stevenson | Standard Ebooks source repo `standardebooks/robert-louis-stevenson_the-strange-case-of-dr-jekyll-and-mr-hyde` | US public domain; Standard Ebooks' work CC0 |
| `shelley-frankenstein.epub` | *Frankenstein*, Mary Shelley | `standardebooks/mary-shelley_frankenstein` | as above |
| `wells-the-time-machine.epub` | *The Time Machine*, H. G. Wells | `standardebooks/h-g-wells_the-time-machine` | as above |
| `descartes-meditation-one.pdf` | Meditation I, René Descartes (John Veitch translation, 1901) | made by `scripts/make-fixture-pdf.mjs` | US public domain |

The EPUBs are zipped from each repository's `src/epub` folder by
`scripts/build-fixture-epubs.py` (the cloud environment cannot reach
standardebooks.org, but `git clone` from GitHub works). The cover painting
inside each `cover.svg` is shrunk to 350×525 to keep the files small.

To rebuild: `git clone --depth 1 https://github.com/standardebooks/<repo>`
for each repo above into one folder, then run
`python3 scripts/build-fixture-epubs.py fixtures/books` from that folder.
