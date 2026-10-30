"""Find where each script paragraph is in the book (PDF page or EPUB chapter).

    python map_to_book.py BOOK.(pdf|epub) OUT.json SCRIPT1.txt [SCRIPT2.txt ...] [--app-text PARAGRAPHS.json]

For a PDF, pass --app-text with the paragraphs as Neolibrary itself reads the PDF
(in the Neolibrary repo: node scripts/pdf-paragraphs.mjs BOOK.pdf PARAGRAPHS.json).
The app matches an uploaded package against that text, not against pdftotext's
reading, so this check then counts what the app will find; each found paragraph
also gets "section", the id of the app's paragraph it starts in.

Scripts are the narrator's text, which differs from the printed page in small
ways (headings added for listening, "normalscientific" broken across a line in
the PDF, page headers and footnotes in between). So both sides are reduced to
letters and digits only, and each paragraph is searched for by a few
40-letter samples, in book order (a paragraph is looked for after the previous
one). Paragraphs that are not in the book at all, like a spoken "Chapter Two.",
are reported as not found; that is expected and fine.

Output, per script file, per paragraph (split on blank lines):
  {"script": file, "paragraph": n, "from": char offset in script,
   "found": bool, "page": PDF page (1-based) or null, "chapter": EPUB spine
   index or null, "quote": the first words as printed in the book,
   "section": the app's paragraph id (with --app-text) or null}
"""
import hashlib
import html
import json
import re
import subprocess
import sys
import zipfile
from collections import Counter
from pathlib import PurePosixPath

SAMPLE = 40  # letters per search sample


def letters(s):
    """Lower-case letters and digits, with the position of each in `s`."""
    out, pos = [], []
    for i, c in enumerate(s):
        if c.isalnum():
            out.append(c.lower())
            pos.append(i)
    return "".join(out), pos


def book_units(path, app_text=None):
    """(label, kind, text, section) for each page (PDF; with app_text, each of the app's
    paragraphs) or spine document (EPUB), in reading order."""
    if path.lower().endswith(".pdf"):
        n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", path], capture_output=True, text=True).stdout).group(1))
        if app_text:
            # One "line" per app paragraph, so the header rule below works on them too.
            by_page = {}
            for para in app_text["paragraphs"]:
                by_page.setdefault(para["page"], []).append(para)
            pages = ["\n".join(q["text"] for q in by_page.get(p, [])) for p in range(1, n + 1)]
            ids = [[q["id"] for q in by_page.get(p, [])] for p in range(1, n + 1)]
        else:
            pages = [subprocess.run(["pdftotext", "-f", str(p), "-l", str(p), path, "-"], capture_output=True, text=True).stdout
                     for p in range(1, n + 1)]
        # Strip running headers and footers (the book title on every page, "Vol. II, No. 2",
        # page numbers) so they do not end up inside a paragraph's quote. A line counts as a
        # running header if, after lower-casing and dropping digits and spaces, the same line
        # appears on at least 20% of pages and on at least 5 pages. Lines that are only a page
        # number (digits or roman numerals) are dropped too.
        def key(line):
            return re.sub(r"[\d\s]+", "", line.lower())
        counts = Counter(k for t in pages for k in {key(l) for l in t.splitlines()} if k)
        repeated = {k for k, c in counts.items() if c >= max(5, 0.2 * n)}
        number = re.compile(r"^\s*(\d+|[ivxlc]+)\s*$", re.I)
        # pdftotext sometimes glues a header onto the end or start of a body line
        # ("...justificaVol. II, No. 2"), so also cut a repeated header (8+ characters) off a line's ends.
        heads = {l.strip() for t in pages for l in t.splitlines() if key(l) in repeated and len(l.strip()) >= 8}
        def unglue(line):
            for h in heads:
                if line.rstrip().endswith(h):
                    line = line.rstrip()[: -len(h)]
                if line.lstrip().startswith(h):
                    line = line.lstrip()[len(h):]
            return line
        for page, t in enumerate(pages, 1):
            if app_text:
                for line, sid in zip(t.splitlines(), ids[page - 1]):
                    if not number.match(line) and key(line) not in repeated:
                        yield page, "page", unglue(line), sid
                continue
            kept = [unglue(l) for l in t.splitlines() if not number.match(l) and key(l) not in repeated]
            yield page, "page", "\n".join(kept), None
    else:
        z = zipfile.ZipFile(path)
        container = z.read("META-INF/container.xml").decode()
        opf_path = re.search(r'full-path="([^"]+)"', container).group(1)
        opf = z.read(opf_path).decode()
        base = PurePosixPath(opf_path).parent
        items = dict(re.findall(r'<item\b[^>]*?id="([^"]+)"[^>]*?href="([^"]+)"', opf))
        items.update({i: h for h, i in re.findall(r'<item\b[^>]*?href="([^"]+)"[^>]*?id="([^"]+)"', opf)})
        for n, idref in enumerate(re.findall(r'<itemref\b[^>]*?idref="([^"]+)"', opf)):
            doc = z.read(str(base / items[idref])).decode(errors="replace")
            doc = re.sub(r"<(script|style)\b.*?</\1>", " ", doc, flags=re.S)
            yield n, "chapter", html.unescape(re.sub(r"<[^>]+>", " ", doc)), None


def main():
    args = sys.argv[1:]
    app_text = None
    if "--app-text" in args:
        i = args.index("--app-text")
        app_text = json.load(open(args[i + 1], encoding="utf-8"))
        del args[i : i + 2]
        with open(args[0], "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        if app_text["book"]["sha256"] != digest:
            sys.exit(f"--app-text was made from another file ({app_text['book']['file']}); run pdf-paragraphs.mjs on {args[0]}")
    book, out, *scripts = args
    units = list(book_units(book, app_text))
    text = ""
    starts = []  # (offset in `text`, label, kind, section)
    for label, kind, t, sid in units:
        starts.append((len(text), label, kind, sid))
        text += t + "\n"
    flat, pos = letters(text)

    def where(i):  # letter index in `flat` -> (label, kind, char offset in `text`, section)
        at = pos[i]
        label, kind, section = None, None, None
        for off, lab, k, sid in starts:
            if off > at:
                break
            label, kind, section = lab, k, sid
        return label, kind, at, section

    results, cursor = [], 0
    for path in scripts:
        script = open(path, encoding="utf-8").read()
        for n, m in enumerate(re.finditer(r"[^\n](?:.|\n(?!\s*\n))*", script)):
            para = m.group()
            p_flat, _ = letters(para)
            hit = None
            # Try samples from the start of the paragraph, then further in, so a
            # spoken-only first sentence does not stop it being found.
            for k in range(0, max(1, len(p_flat) - SAMPLE + 1), SAMPLE):
                sample = p_flat[k : k + SAMPLE]
                if len(sample) < min(SAMPLE, len(p_flat)) or len(sample) < 15:
                    break
                j = flat.find(sample, cursor)
                if j >= 0:
                    hit = max(0, j - k) if k else j
                    break
            entry = {"script": path.split("/")[-1], "paragraph": n, "from": m.start(), "found": hit is not None, "page": None, "chapter": None, "quote": None, "section": None}
            if hit is not None:
                label, kind, at, section = where(hit)
                entry["page" if kind == "page" else "chapter"] = label
                entry["section"] = section
                entry["quote"] = re.sub(r"\s+", " ", text[at : at + 120]).strip()[:80]
                cursor = hit + 1
            results.append(entry)
    json.dump({"book": book, "paragraphs": results}, open(out, "w"), indent=1)
    found = sum(r["found"] for r in results)
    against = " (the app's own text)" if app_text else ""
    print(f"{found} of {len(results)} script paragraphs found in the book{against}; wrote {out}")
    for r in results:
        if not r["found"]:
            print(f"  not found: {r['script']} paragraph {r['paragraph']}")


if __name__ == "__main__":
    main()
