#!/usr/bin/env python3
"""Split a PDF into chapter scripts ready for narration (readalong-audio).

    python3 split_pdf.py BOOK.pdf OUTDIR [--pages 22-41] [--drop-front-back] [--spoken-headings]
                         [--max-chars 38000] [--min-chars 200] [--keep-small-text]

The same three outputs as split_epub.py: OUTDIR/NN-slug.txt (paragraphs separated by
one blank line), OUTDIR/chapters.json (a list of {"title","script","audio": null,
"pages": [first, last],"chars","kind"}) and OUTDIR/report.md (every decision, every
change made to the text, and a Doubts list). Needs PyMuPDF (`import fitz`).
Never asks questions: it decides and writes down why.

pages are 1-based, as a PDF viewer counts them. Neolibrary keeps a PDF as one
"chapter" per page, so a page's chapterIndex there is page - 1.

How (docs/pdf-narration-plan.md, Part D, in the Neolibrary repo):
1. Chapters from the PDF's outline (bookmarks); without one, from heading lines
   (type at least 1.3 times the body size near the top of a page).
2. The text in reading order, cleaned for the ear. Nothing is reworded:
   - running headers and footers are dropped: a line in the top or bottom tenth of
     a page that repeats (digits ignored) on at least 20% of the pages and on 5 (the
     rule map_to_book.py uses), or on a third of one chapter's pages and on 3;
     a line there that is only a page number goes too;
   - small text is dropped (footnotes, figure captions: lines mostly in type under
     85% of the body size), unless --keep-small-text; the report lists it;
   - footnote markers are dropped: small digits or symbols raised above the line.
     Small digits set lower (a subscript, as in "CO2") stay, joined to their word;
   - a word broken at the end of a line or page is joined: without the hyphen when
     the book spells the joined word elsewhere without one ("frag-" + "ment"), with it
     otherwise ("well-" + "appointed": a book made from an ebook breaks lines only at
     real hyphens). A soft hyphen always goes;
   - a new paragraph starts where a line begins further in than the line before (an
     indent), where an indented line follows one that stopped short of the right
     margin (a one-line paragraph, then the next), or after a gap of more than 1.5 lines. A page's first line goes on with
     the paragraph the last page ended in, unless it is indented;
   - a chapter's own heading lines at the top of its first page are dropped (short lines
     up to the last one whose words are in its title, or that is in display type);
     --spoken-headings says the title instead.
Then check every script against the book with readalong-audio's map_to_book.py,
best with --app-text (the paragraphs as Neolibrary reads them, from its
scripts/pdf-paragraphs.mjs).
"""
import argparse
import json
import math
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from split_epub import classify, slug  # noqa: E402  (the same rules for what is narrated)

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    sys.exit("split_pdf.py needs PyMuPDF: pip install pymupdf")

BAND = 0.1  # the top and bottom tenth of a page: where running headers and page numbers sit
SMALL = 0.85  # type under this share of the body size is "small" (footnotes, captions, markers)
DISPLAY = 1.15  # type at least this share of the body size is display type (headings)
HEADING = 1.3  # without an outline, a line this much larger near a page's top starts a chapter
MARKER = re.compile(r"^[\d*†‡§¶,\s]+$")
NUMBER = re.compile(r"^\s*(\d+|[ivxlcdm]+)\s*$", re.I)
HYPHENS = "-‐"  # hyphen-minus and hyphen
SOFT = "­"


def letters(s):
    return re.sub(r"[^0-9a-z]", "", s.lower())


def key(text):
    """A running header's identity: lower case, without digits and spaces (as in map_to_book.py)."""
    return re.sub(r"[\d\s]+", "", text.lower())


class Line:
    __slots__ = ("page", "text", "x0", "x1", "y0", "y1", "base", "size", "small", "markers")

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


def body_size(doc):
    sizes = Counter()
    for page in doc:
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    sizes[round(s["size"], 1)] += len(s["text"].strip())
    return sizes.most_common(1)[0][0] if sizes else 10.0


def page_lines(page, pno, body):
    """The page's text lines in reading order, footnote markers taken out (and counted)."""
    flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP  # ligatures ("ﬁ") come out as letters
    out = []
    for b in page.get_text("dict", sort=True, flags=flags)["blocks"]:
        for l in b.get("lines", []):
            spans = [s for s in l["spans"] if s["text"]]
            if not spans:
                continue
            main = max(spans, key=lambda s: len(s["text"].strip()) * (s["size"] >= SMALL * body))
            base = main["origin"][1]
            text, markers, small_chars, chars = "", [], 0, 0
            for s in spans:
                t, size = s["text"], s["size"]
                n = len(t.strip())
                chars += n
                small = size < SMALL * body
                if small:
                    small_chars += n
                inline = small and main["size"] >= SMALL * body and s is not main
                raised = s["origin"][1] < base - 0.2 * main["size"] or (s["flags"] & 1)
                if inline and raised and MARKER.match(t):
                    markers.append(t.strip())  # a footnote marker: not read aloud
                    continue
                text += t
            if not text.strip():
                continue  # a line of spaces (calibre leaves them between blocks)
            out.append(Line(page=pno, text=text.rstrip(), x0=l["bbox"][0], x1=l["bbox"][2], y0=l["bbox"][1], y1=l["bbox"][3],
                            base=base, size=main["size"], small=chars > 0 and small_chars > chars / 2, markers=markers))
    return merge_pieces(out, body)


def merge_pieces(lines, body):
    """One line again where the PDF's text came out in pieces on one baseline (a justified line
    with wide word spaces comes out word by word on some pages)."""
    out = []
    for l in lines:
        last = out[-1] if out else None
        if last and abs(l.base - last.base) < 0.3 * max(l.size, last.size) and 0 <= l.x0 - last.x1 < 2.5 * body and l.small == last.small:
            last.text = last.text + ("" if last.text.endswith(" ") or l.text.startswith(" ") else " ") + l.text
            last.x1, last.y0, last.y1 = l.x1, min(last.y0, l.y0), max(last.y1, l.y1)
            last.markers += l.markers
            continue
        out.append(l)
    return out


def outline_chapters(doc):
    """[(title, first page)] from the outline's shallowest level that has two entries or more."""
    toc = doc.get_toc()
    for level in sorted({lvl for lvl, _, _ in toc}):
        entries = [(t.strip(), p) for lvl, t, p in toc if lvl == level and p >= 1]
        if len(entries) >= 2:
            return sorted(entries, key=lambda e: e[1]), level
    return [], None


def heading_chapters(lines_by_page, body):
    """Without an outline: a page whose first lines include one in type HEADING times the body size."""
    found = []
    for pno, lines in lines_by_page.items():
        top = [l for l in lines[:4] if not l.small]
        big = [l for l in top if l.size >= HEADING * body]
        if big:
            found.append((" ".join(l.text.strip() for l in big), pno))
    return found


def kind_of(title):
    if re.match(r"^\s*(a note on|about) the author", title, re.I):
        return "back", "back matter (about the author)", None
    return classify(title, set(), title)


def split_long(paras, limit):
    parts, cur, n = [], [], 0
    for p in paras:
        if cur and n + len(p["text"]) > limit:
            parts.append(cur)
            cur, n = [], 0
        cur.append(p)
        n += len(p["text"]) + 2
    if cur:
        parts.append(cur)
    return parts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf")
    ap.add_argument("out")
    ap.add_argument("--pages", help="only these pages, e.g. 22-41 (1-based, inclusive); chapters are cut to them")
    ap.add_argument("--drop-front-back", action="store_true", help="also drop dedication/epigraph/appendix-type matter (prefaces and introductions are still kept)")
    ap.add_argument("--spoken-headings", action="store_true", help='start each script with its title as a spoken line, e.g. "Chapter 1. The Way of the Wind."')
    ap.add_argument("--max-chars", type=int, default=38000, help="split chapters longer than this (about 45 min of speech) at paragraph ends")
    ap.add_argument("--min-chars", type=int, default=200, help="drop chapters with less text than this (title cards, blank pages)")
    ap.add_argument("--keep-small-text", action="store_true", help="keep footnotes and captions (small type) in the scripts")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(a.pdf)
    n_pages = doc.page_count
    body = body_size(doc)
    lines_by_page = {i + 1: page_lines(doc[i], i + 1, body) for i in range(n_pages)}
    doubts, changes = [], {"header": [], "number": [], "small": [], "marker": [], "join": [], "keep": [], "heading": []}

    # 1. Chapters.
    entries, level = outline_chapters(doc)
    if entries:
        how = f"the PDF's outline (bookmarks), level {level}: {len(entries)} entries"
    else:
        entries = heading_chapters(lines_by_page, body)
        how = f"no outline; heading lines in type {HEADING}x the body size: {len(entries)} found"
        if not entries:
            entries = [("Whole book", 1)]
            doubts.append("The PDF has no outline and no heading lines were found, so the whole book is one script. Split it by hand if it is long.")
        else:
            doubts.append("The PDF has no outline: chapters were found from large heading lines. Check the titles in the table.")
    if entries[0][1] > 1:
        entries.insert(0, ("Before the first bookmark", 1))
    chapters = []
    for k, (title, first) in enumerate(entries):
        last = (entries[k + 1][1] - 1) if k + 1 < len(entries) else n_pages
        if last < first:  # two bookmarks on one page: the later one owns it
            continue
        chapters.append({"title": title, "first": first, "last": last})
    lo, hi = 1, n_pages
    if a.pages:
        lo, hi = (int(x) for x in a.pages.split("-"))
    chapter_of = {p: c for c in chapters for p in range(c["first"], c["last"] + 1)}

    # 2a. Running headers and footers, and page numbers, in the top and bottom tenth of a page.
    def in_band(l):
        h = doc[l.page - 1].rect.height
        return l.y1 <= BAND * h or l.y0 >= (1 - BAND) * h

    book_counts = Counter(k for p, ls in lines_by_page.items() for k in {key(l.text) for l in ls if in_band(l) and key(l.text)})
    book_repeat = {k for k, c in book_counts.items() if c >= max(5, 0.2 * n_pages)}
    chap_repeat = {}
    for c in chapters:
        pages = range(c["first"], c["last"] + 1)
        counts = Counter(k for p in pages for k in {key(l.text) for l in lines_by_page[p] if in_band(l) and key(l.text)})
        chap_repeat[c["title"], c["first"]] = {k for k, n in counts.items() if n >= max(3, math.ceil(len(pages) / 3))}

    # A vocabulary of the whole book, for line-end hyphens.
    words, hyphenated = Counter(), Counter()
    for ls in lines_by_page.values():
        for l in ls:
            t = l.text.rstrip()
            if t and t[-1] in HYPHENS + SOFT:
                t = t[: len(t) - len(re.search(r"[\w" + re.escape(HYPHENS + SOFT) + r"]*$", t).group())]  # the broken word is not evidence
            for w in re.findall(r"[^\W\d_]+(?:[" + HYPHENS + r"][^\W\d_]+)*", t):
                w = w.lower()
                words[w.replace("-", "").replace("‐", "")] += 1
                if "-" in w or "‐" in w:
                    hyphenated[w.replace("‐", "-")] += 1

    def runs_on(cur, text):
        """A sentence left open that the next line finishes in lower case: a figure or a gap, not a new paragraph."""
        return cur is not None and not re.search(r"[.?!:;\"”’)\]]$", cur["text"]) and bool(re.match(r"[a-z]", text))

    def join(prev, nxt, page, ch):
        """prev + the next line of the same paragraph (decisions noted in ch)."""
        if prev.endswith(SOFT):
            return prev[:-1] + nxt.lstrip()
        m = re.search(r"([^\W\d_]+)[" + HYPHENS + r"]$", prev)
        n = re.match(r"\s*([^\W\d_]+)", nxt)
        if m and n and n.group(1)[0].islower():
            left, right = m.group(1).lower(), n.group(1).lower()
            if hyphenated[f"{left}-{right}"] == 0 and words[left + right] > 0:
                ch["join"].append((page, f"{m.group(1)}-{n.group(1)} → {m.group(1)}{n.group(1)}"))
                return prev[:-1] + nxt.lstrip()
            ch["keep"].append((page, f"{m.group(1)}-{n.group(1)}"))
            return prev[:-1] + "-" + nxt.lstrip()
        if prev.endswith(("—", "–")):
            return prev + nxt.lstrip()
        return prev + " " + nxt.lstrip()

    # 2b. Paragraphs, chapter by chapter.
    report, results, n = [], [], 0
    two_column, kept_pages = [], set()
    for c in chapters:
        first, last = max(c["first"], lo), min(c["last"], hi)
        if first > last:
            continue
        title = c["title"]
        kind, why, drop = kind_of(title)
        repeat = book_repeat | chap_repeat[title, c["first"]]
        paras, cur, prev = [], None, None
        any_text = False
        ch, ch_columns = {k: [] for k in changes}, []  # noted here, kept only if the chapter is
        for p in range(first, last + 1):
            ls = lines_by_page[p]
            page = doc[p - 1]
            if ls:
                any_text = True
            body_lines = [l for l in ls if not l.small]
            if body_lines and sum(l.x0 > 0.45 * page.rect.width for l in body_lines) > 0.3 * len(body_lines) and sum(l.x1 < 0.55 * page.rect.width for l in body_lines) > 0.3 * len(body_lines):
                ch_columns.append(p)
            steps = [b.base - a_.base for a_, b in zip(body_lines, body_lines[1:]) if b.base > a_.base]
            step = statistics.median(steps) if steps else body * 1.2
            margin = Counter(round(l.x0) for l in body_lines).most_common(1)[0][0] if body_lines else 0
            right = sorted(l.x1 for l in body_lines)[int(0.9 * (len(body_lines) - 1))] if body_lines else page.rect.width
            prev_on_page = None
            running = [l for l in ls if in_band(l) and (NUMBER.match(l.text.strip()) or (key(l.text) and key(l.text) in repeat))]
            # The chapter's heading: on its first page, the first lines up to the last of them (among
            # the first four) that is in the outline title or set in display type, if all are short.
            heading = set()
            if p == c["first"]:
                top = [l for l in ls if l not in running][:4]
                marks = [k for k, l in enumerate(top) if (letters(l.text) and letters(l.text) in letters(title)) or (l.size >= DISPLAY * body and l.y0 < 0.4 * page.rect.height)]
                if marks and all(len(l.text.strip()) <= 60 for l in top[: marks[-1] + 1]):
                    heading = {id(l) for l in top[: marks[-1] + 1]}
            for l in ls:
                text = l.text.strip()
                if l in running:
                    ch["number" if NUMBER.match(text) else "header"].append((p, text))
                    continue
                if id(l) in heading:
                    ch["heading"].append((p, text))
                    continue
                if l.small and body_lines and not a.keep_small_text:  # a page all in small type (an epigraph) is not footnotes
                    ch["small"].append((p, text))
                    continue
                for mk in l.markers:
                    ch["marker"].append((p, f"…{text[-20:]} [{mk}]"))
                if not letters(text):
                    cur, prev = None, None  # an ornament ("* * *"): a break, not words
                    continue
                if prev is None:
                    new = True
                elif prev_on_page is None:  # the page's first line
                    new = l.x0 > margin + 0.5 * body
                else:
                    indented = l.x0 > prev.x0 + 0.5 * body
                    # Indented like the line before, which stopped short: one short paragraph, then the next.
                    after_short = l.x0 > margin + 0.5 * body and prev.x1 < right - 1.5 * body
                    gap = l.base - prev_on_page.base > 1.5 * step and not runs_on(cur, text)
                    new = indented or after_short or gap
                if new or cur is None:
                    cur = {"text": text, "first": p, "last": p}
                    paras.append(cur)
                else:
                    cur["text"] = join(cur["text"], text, p, ch)
                    cur["last"] = p
                prev, prev_on_page = l, l
        for p_ in paras:
            p_["text"] = re.sub(r"\s+", " ", p_["text"]).strip()
        chars = sum(len(p_["text"]) for p_ in paras)
        pages_note = f"{first}–{last}" + (f" (of {c['first']}–{c['last']})" if (first, last) != (c["first"], c["last"]) else "")
        if drop is None:
            drop = a.drop_front_back
            why += "; dropped because --drop-front-back" if drop else "; kept (pass --drop-front-back to drop)"
        if not drop and not any_text:
            drop, why = True, "no text on its pages (a cover or a picture; or a scanned page)"
        elif not drop and chars < a.min_chars:
            drop, why = True, f"only {chars} characters of text (title card or blank page)"
        if drop:
            report.append(f"| {pages_note} | {title} | {kind} | dropped | {why} |")
            continue
        for k, v in ch.items():
            changes[k] += v
        two_column += ch_columns
        kept_pages.update(range(first, last + 1))
        parts = split_long(paras, a.max_chars)
        for pi, part in enumerate(parts):
            n += 1
            ptitle = title if len(parts) == 1 else f"{title}, part {pi + 1}"
            body_text = [p_["text"] for p_ in part]
            if a.spoken_headings:
                spoken = re.sub(r"\b([A-Z])([A-Z]+)\b", lambda m: m.group(1) + m.group(2).lower(), ptitle)
                spoken = re.sub(r"^(Chapter|Part|Book) (\w+) ", r"\1 \2. ", spoken)
                body_text.insert(0, spoken.rstrip(".") + ".")
            fname = f"{n:02d}-{slug(ptitle)}.txt"
            text = "\n\n".join(body_text) + "\n"
            (out / fname).write_text(text)
            results.append({"title": ptitle, "script": fname, "audio": None, "pages": [part[0]["first"], part[-1]["last"]], "chars": len(text), "kind": kind})
        note = why if len(parts) == 1 else f"{why}; {chars} characters split into {len(parts)} parts at paragraph ends (limit {a.max_chars})"
        report.append(f"| {pages_note} | {title} | {kind} | kept as {', '.join(r['script'] for r in results[-len(parts):])} | {note} |")

    textless = [p for p in range(lo, hi + 1) if not lines_by_page[p]]
    if len(textless) > 0.5 * (hi - lo + 1):
        doubts.append(f"{len(textless)} of {hi - lo + 1} pages have no text layer: the book looks scanned. Run `ocrmypdf BOOK.pdf OUT.pdf` and split OUT.pdf.")
    if two_column:
        doubts.append(f"Pages {', '.join(map(str, sorted(set(two_column))[:12]))} look like two columns; the reading order may jump between them. Try `marker` or `docling` on this book and compare.")
    if changes["keep"]:
        doubts.append(f"{len(changes['keep'])} words broken at a line end kept their hyphen (the book never spells them joined). Most are real compounds; see the list.")
    small_pages = {p for p, _ in changes["small"]}
    if len(small_pages) > 0.5 * max(1, len(kept_pages)):
        doubts.append(f"Small text was dropped on {len(small_pages)} pages: more than half. If the body itself is set small in places, run again with --keep-small-text.")

    (out / "chapters.json").write_text(json.dumps(results, indent=1))
    total = sum(r["chars"] for r in results)

    def listing(name, label, limit=12):
        items = changes[name]
        if not items:
            return f"- {label}: none\n"
        shown = "\n".join(f"  - page {p}: {t[:90]}" for p, t in items[:limit])
        more = f"\n  - … and {len(items) - limit} more" if len(items) > limit else ""
        return f"- {label}: {len(items)}\n{shown}{more}\n"

    (out / "report.md").write_text(
        f"# Chapter split report (PDF)\n\nBook: `{a.pdf}`, {n_pages} pages"
        + (f", pages {lo}–{hi} only" if a.pages else "") + ".\n\n"
        f"Chapters from {how}. Body text: {body} pt (the size most of the book's characters are set in).\n\n"
        f"Kept {len(results)} scripts, {total} characters (about {total / 850:.0f} minutes of speech at ~850 characters a minute).\n"
        f"Options: drop-front-back={a.drop_front_back}, spoken-headings={a.spoken_headings}, max-chars={a.max_chars}, keep-small-text={a.keep_small_text}.\n"
        "pages are 1-based (as a PDF viewer counts); Neolibrary's chapterIndex for a page is page - 1.\n\n"
        "| pages | title | kind | decision | why |\n|---|---|---|---|---|\n" + "\n".join(report) + "\n\n"
        "## Changes made to the text\n\n"
        + listing("heading", "Heading lines dropped (the title is the chapter's name; --spoken-headings says it)")
        + listing("header", "Running headers and footers dropped")
        + listing("number", "Page numbers dropped")
        + listing("small", "Small text dropped (footnotes, captions)")
        + listing("marker", "Footnote markers dropped")
        + listing("join", "Words broken at a line end, joined without the hyphen (the book spells them so elsewhere)")
        + listing("keep", "Words broken at a line end, kept with their hyphen")
        + "\n## Doubts\n\n" + ("\n".join(f"- {d}" for d in doubts) if doubts else "- none") + "\n"
    )
    print(f"{len(results)} scripts, {total} characters -> {out}")


if __name__ == "__main__":
    sys.exit(main())
