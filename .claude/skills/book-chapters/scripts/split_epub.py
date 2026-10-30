#!/usr/bin/env python3
"""Split an EPUB into chapter scripts ready for narration (readalong-audio).

    python3 split_epub.py BOOK.epub OUTDIR [--drop-front-back] [--spoken-headings] [--max-chars 38000]

Writes OUTDIR/NN-slug.txt (paragraphs separated by blank lines), OUTDIR/chapters.json
(a list of {"title","script","audio": null,"spine_index","chars","kind"}) and
OUTDIR/report.md (every decision: kept, dropped, split, and why).
Standard library only. Never asks questions: it decides and writes down why.

spine_index is the 0-based position in the OPF spine, the same number Neolibrary
stores as a section's chapterIndex, so packages line up with the book.
"""
import argparse
import html
import json
import re
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import PurePosixPath

# Never narrated (always dropped): no reader wants these read aloud.
ALWAYS_DROP = {"copyright", "toc", "colophon", "imprint", "endnotes", "uncopyright", "index",
               "titlepage", "halftitlepage", "loi", "lot", "footnotes", "rearnotes", "bibliography"}
# Kept by default even with --drop-front-back (they are part of the reading).
KEEP_FRONT = {"preface", "introduction", "foreword", "prologue", "epilogue", "afterword"}
# Front/back matter dropped only with --drop-front-back.
FRONT = {"dedication", "epigraph", "acknowledgments", "acknowledgements", "frontmatter", "halftitle"}
BACK = {"appendix", "glossary", "backmatter", "acknowledgments", "loi"}

BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dt", "dd", "blockquote", "div", "td", "pre", "header", "section", "article", "figcaption", "tr", "br"}
SKIP_TYPES = {"noteref", "pagebreak", "page-list", "footnote", "endnote", "rearnote"}


class Text(HTMLParser):
    """Collect paragraphs; drop footnote markers, page-break markers and <sup> numbers."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paras, self.cur, self.skip, self.stack = [], [], 0, []
        self.types, self.heading = set(), None
        self._in_h, self._h = False, []

    def flush(self):
        t = re.sub(r"\s+", " ", "".join(self.cur)).strip()
        if t:
            self.paras.append(t)
        self.cur = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        et = set((a.get("epub:type") or "").split()) | set((a.get("role") or "").replace("doc-", "").split())
        if tag in ("section", "body", "nav"):
            self.types |= et
        void = tag in ("br", "img", "hr", "meta", "link")
        hide = tag in ("script", "style", "sup", "title") or (et & SKIP_TYPES) or "hidden" in a
        if tag in BLOCK:
            self.flush()
        if tag in ("h1", "h2", "h3") and self.heading is None:
            self._in_h, self._h = True, []
        if not void:
            self.stack.append((tag, bool(hide)))
            if hide:
                self.skip += 1

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.cur.append(" ")
        elif tag in BLOCK:
            self.flush()

    def handle_endtag(self, tag):
        while self.stack:
            t, hid = self.stack.pop()
            if hid:
                self.skip -= 1
            if t == tag:
                break
        if tag in BLOCK:
            self.flush()
        if tag in ("h1", "h2", "h3") and self._in_h:
            self._in_h = False
            self.heading = re.sub(r"\s+", " ", "".join(self._h)).strip() or None

    def handle_data(self, data):
        if self.skip:
            return
        self.cur.append(data)
        if self._in_h:
            self._h.append(data + " ")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "part"


def nav_labels(z, opf, base, items):
    """href (no fragment) -> label, from the EPUB3 nav or the EPUB2 NCX."""
    labels = {}
    nav = re.search(r'<item\b[^>]*properties="[^"]*\bnav\b[^"]*"[^>]*>', opf)
    if nav:
        href = re.search(r'href="([^"]+)"', nav.group(0)).group(1)
        p = base / href
        doc = z.read(str(p)).decode(errors="replace")
        toc = re.search(r'<nav\b[^>]*epub:type="toc".*?</nav>', doc, re.S)
        for h, lab in re.findall(r'<a\b[^>]*href="([^"#]+)[^"]*"[^>]*>(.*?)</a>', toc.group(0) if toc else doc, re.S):
            key = str(PurePosixPath(p.parent / h))
            labels.setdefault(norm(key), clean(lab))
    ncx_id = re.search(r'<spine\b[^>]*toc="([^"]+)"', opf)
    if ncx_id and ncx_id.group(1) in items:
        p = base / items[ncx_id.group(1)]
        doc = z.read(str(p)).decode(errors="replace")
        for lab, h in re.findall(r'<navLabel>\s*<text>(.*?)</text>.*?<content\s+src="([^"#]+)', doc, re.S):
            labels.setdefault(norm(str(p.parent / h)), clean(lab))
    return labels


def norm(p):
    parts = []
    for s in p.split("/"):
        if s == "..":
            parts and parts.pop()
        elif s not in ("", "."):
            parts.append(s)
    return "/".join(parts)


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def classify(name, types, title):
    """Return (kind, reason, drop_by_default)."""
    words = {slug(name).replace("-", "")} | set(slug(name).split("-")) | {t.lower() for t in types} | set(slug(title or "").split("-"))
    t = (title or "").lower()
    hit = words & ALWAYS_DROP
    if hit or t in ("contents", "table of contents", "index", "copyright", "colophon", "imprint", "notes", "endnotes", "footnotes"):
        return ("front" if hit & {"toc", "titlepage", "halftitlepage", "copyright", "imprint"} else "back"), f"never narrated ({', '.join(sorted(hit)) or t})", True
    hit = words & KEEP_FRONT
    if hit:
        return "front" if hit & {"preface", "introduction", "foreword", "prologue"} else "back", f"kept: {', '.join(sorted(hit))} is part of the reading", False
    if words & FRONT:
        return "front", f"front matter ({', '.join(sorted(words & FRONT))})", None
    if words & BACK:
        return "back", f"back matter ({', '.join(sorted(words & BACK))})", None
    return "chapter", "body text", False


def split_long(paras, limit):
    parts, cur, n = [], [], 0
    for p in paras:
        if cur and n + len(p) > limit:
            parts.append(cur)
            cur, n = [], 0
        cur.append(p)
        n += len(p) + 2
    if cur:
        parts.append(cur)
    return parts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("epub")
    ap.add_argument("out")
    ap.add_argument("--drop-front-back", action="store_true", help="also drop dedication/epigraph/appendix-type matter (prefaces and introductions are still kept)")
    ap.add_argument("--spoken-headings", action="store_true", help='start each script with its title as a spoken line, e.g. "Chapter Five."')
    ap.add_argument("--max-chars", type=int, default=38000, help="split chapters longer than this (about 45 min of speech) at paragraph ends")
    ap.add_argument("--min-chars", type=int, default=200, help="drop spine items with less text than this (title cards, blank pages)")
    a = ap.parse_args()

    from pathlib import Path
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    z = zipfile.ZipFile(a.epub)
    opf_path = re.search(r'full-path="([^"]+)"', z.read("META-INF/container.xml").decode()).group(1)
    opf = z.read(opf_path).decode(errors="replace")
    base = PurePosixPath(opf_path).parent
    items = {}
    for tag in re.findall(r"<item\b[^>]*>", opf):
        i, h = re.search(r'\bid="([^"]+)"', tag), re.search(r'\bhref="([^"]+)"', tag)
        if i and h:
            items[i.group(1)] = html.unescape(h.group(1))
    labels = nav_labels(z, opf, base, items)
    spine = re.findall(r'<itemref\b[^>]*?idref="([^"]+)"', opf)

    chapters, report, n = [], [], 0
    for si, idref in enumerate(spine):
        href = norm(str(base / items[idref]))
        name = PurePosixPath(href).stem
        t = Text()
        t.feed(z.read(href).decode(errors="replace"))
        t.flush()
        paras = [p for p in t.paras if not re.fullmatch(r"[\divxlcIVXLC.\s]{1,8}", p)]  # bare page numbers
        title = labels.get(href) or t.heading or name.replace("-", " ").title()
        # Drop a leading paragraph that just repeats the heading (it becomes the spoken heading instead).
        while paras and t.heading and paras[0].lower().rstrip(".") in (title.lower(), (t.heading or "").lower()):
            paras.pop(0)
        chars = sum(len(p) for p in paras)
        kind, why, drop = classify(name, t.types, title)
        if drop is None:
            drop = a.drop_front_back
            why += "; dropped because --drop-front-back" if drop else "; kept (pass --drop-front-back to drop)"
        if not drop and chars < a.min_chars:
            drop, why = True, f"only {chars} characters of text (title card or blank page)"
        if drop:
            report.append(f"| {si} | {title} | {kind} | dropped | {why} |")
            continue
        parts = split_long(paras, a.max_chars)
        for pi, part in enumerate(parts):
            n += 1
            ptitle = title if len(parts) == 1 else f"{title}, part {pi + 1}"
            body = list(part)
            if a.spoken_headings:
                body.insert(0, ptitle.rstrip(".") + ".")
            fname = f"{n:02d}-{slug(ptitle)}.txt"
            text = "\n\n".join(body) + "\n"
            (out / fname).write_text(text)
            chapters.append({"title": ptitle, "script": fname, "audio": None, "spine_index": si, "chars": len(text), "kind": kind})
        note = why if len(parts) == 1 else f"{why}; {chars} characters split into {len(parts)} parts at paragraph ends (limit {a.max_chars})"
        report.append(f"| {si} | {title} | {kind} | kept as {', '.join(c['script'] for c in chapters[-len(parts):])} | {note} |")

    (out / "chapters.json").write_text(json.dumps(chapters, indent=1))
    total = sum(c["chars"] for c in chapters)
    (out / "report.md").write_text(
        f"# Chapter split report\n\nBook: `{a.epub}`\n\n"
        f"Kept {len(chapters)} scripts, {total} characters (about {total / 850:.0f} minutes of speech at ~850 characters a minute).\n"
        f"Options: drop-front-back={a.drop_front_back}, spoken-headings={a.spoken_headings}, max-chars={a.max_chars}.\n"
        "spine_index is the 0-based spine position (Neolibrary's chapterIndex).\n\n"
        "| spine | title | kind | decision | why |\n|---|---|---|---|---|\n" + "\n".join(report) + "\n")
    print(f"{len(chapters)} scripts, {total} characters -> {out}")


if __name__ == "__main__":
    sys.exit(main())
