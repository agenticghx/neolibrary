# Root cause: scanned PDFs open as blank white pages

Written 2026-10-15 for Samuel and for the sessions that build Neolibrary.
Plain English first; the technical detail follows.

## What Samuel saw

*The Pay Off* (Leibbrandt and de Terán) opens in the reader as a blank white
page: page 16, where he left off, and page 17 too. Other PDFs, such as
*Meditations on First Philosophy*, open normally. The browser console shows
no error, and the reader reports itself "ready".

## The cause, in one paragraph

*The Pay Off* is a scan from the Internet Archive. Each of its 388 pages is a
picture, stored in two compact picture formats made for scans: JPEG 2000 and
JBIG2. The PDF library the reader uses (pdf.js) decodes those two formats with
small add-on programs (WebAssembly files: `openjpeg.wasm`, `jbig2.wasm`, plus
plain-JavaScript backups). It only finds them if it is told where they are,
through a setting called `wasmUrl`. Neolibrary never set it, and never copied
those files to the site. So pdf.js skipped every picture, quietly (a warning
inside its worker, not an error on the page), and drew empty white pages.

## Evidence

| Check | Result |
|---|---|
| The live file's raw bytes, scanned in the browser | 388 pages, 776 JPEG 2000 pictures (`/JPXDecode`), 388 JBIG2 pictures (`/JBIG2Decode`), 3 fonts. Made by "Internet Archive PDF 1.4.16" |
| `lib/reader/pdf-book.ts`, `getDocument({...})` | `cMapUrl` and `standardFontDataUrl` are set; `wasmUrl` is not |
| `scripts/copy-pdfjs.mjs` | copies the worker, `cmaps/` and `standard_fonts/` to `public/pdfjs/`, not `wasm/` |
| `curl https://web-production-f27a0e.up.railway.app/pdfjs/wasm/openjpeg.wasm` | 307 (sent to sign-in): the file is not on the site |
| A one-page test PDF with one JPEG 2000 picture, drawn by pdf.js 6.4 the way the app sets it up | 0 dark pixels (blank), and pdf.js warns "Ensure that the `wasmUrl` API parameter is provided" |
| The same page with `wasmUrl` pointing at `node_modules/pdfjs-dist/wasm/` | 4,167 dark pixels (the page draws) |

## Why the tests did not catch it

Every PDF in `fixtures/` is a born-digital PDF: text and vector drawing, no
JPEG 2000 or JBIG2 pictures. The browser tests check that pages open and that
words light up, which a text PDF always passes. Scanned books (the Internet
Archive, library digitisation, a phone scanner app) are exactly the
DRM-free files a reader like Samuel collects, and none was tested.

## The lesson

Test with the kinds of files the real library holds, not only the kind that
is easy to make. Here that means at least one scanned PDF (JPEG 2000 and
JBIG2 pictures) among the fixtures, and a check that its first page draws
ink, not only that the reader says "ready". A white page counts as a failure.

## The fix (not built yet)

1. `scripts/copy-pdfjs.mjs`: copy `node_modules/pdfjs-dist/wasm/` to
   `public/pdfjs/wasm/` (and list them for "Download for offline").
2. `lib/reader/pdf-book.ts`: pass `wasmUrl: "/pdfjs/wasm/"` to
   `getDocument`.
3. Check the security policy (`proxy.ts`): WebAssembly needs
   `'wasm-unsafe-eval'` in `script-src`. Without it pdf.js falls back to the
   slower JavaScript decoders, which load from the same folder; either works,
   so test which one runs.
4. `/pdfjs/` must be reachable without the sign-in redirect, as the worker
   already is.
5. A fixture: a small, public-domain scanned PDF with a JPEG 2000 and a
   JBIG2 page, and a browser test that page 1 draws dark pixels on its
   canvas.
6. The server side (`lib/library/pdf-sections.ts`) also opens PDFs with
   pdf.js; check whether it reads pictures (it reads text, so probably not).
