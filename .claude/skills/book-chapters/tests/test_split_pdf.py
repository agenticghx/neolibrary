"""Tests for split_pdf.py (and readalong-audio's map_to_book.py --app-text).

    python3 -m pytest .claude/skills/book-chapters/tests -q

A made-up 10-page PDF holds each case the splitter must handle: an outline, a
title page and an index (dropped), a running header and page numbers, a chapter
heading, a footnote and its raised marker, a subscript (CO2), a word broken at
a line end that the book spells joined elsewhere ("frag-ment") and one it does
not ("well-appointed"), a paragraph that runs on to the next page, a one-line
paragraph, a line that comes out of the PDF in pieces, and a gap between
paragraphs with no indent. Nothing here is copyrighted.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import fitz
import pytest

HERE = Path(__file__).resolve().parent
SPLIT = HERE.parent / "scripts" / "split_pdf.py"
MAP = HERE.parent.parent / "readalong-audio" / "scripts" / "map_to_book.py"
BODY = 11
LEAD = 14  # baseline to baseline

FILLER = [
    "The second chapter goes on in plain sentences, one after another, so that the",
    "page has a body of ordinary text, set at the body size, with nothing to catch",
    "the splitter out. A fragment of an old map hangs on the wall of the room. It",
    "is enough text to count, and every line of it is meant to be read aloud by the",
    "voice, page after page, until the chapter ends on the last of its pages here.",
]

CH1 = [
    "This first paragraph speaks of a fragment of the",
    "story, and then a frag-",
    "ment again, in a well-",
    "appointed room.",
]


def line(page, y, text, x=72, size=BODY):
    page.insert_text((x, y), text, fontsize=size, fontname="tiro")


def make_book(path, outline=True):
    doc = fitz.open()
    for _ in range(10):
        doc.new_page(width=612, height=792)
    pages = [doc[i] for i in range(10)]  # a page object from new_page() goes stale once another page is added
    line(pages[0], 300, "A Test Book", x=200, size=24)
    line(pages[1], 100, "Contents", size=16)
    line(pages[1], 130, "Chapter 1 ........ 3")
    for n in range(2, 10):  # pages 3 to 10: running header and page number
        line(pages[n], 40, "A TEST BOOK", x=260, size=9)
        line(pages[n], 760, str(n + 1), x=300, size=9)

    p3 = pages[2]
    line(p3, 100, "CHAPTER 1", x=270)
    line(p3, 120, "The Test", x=260, size=16)
    y = 160
    for t in CH1:
        line(p3, y, t)
        y += LEAD
    # A footnote marker after "appointed room.": small, and raised 4 pt above that line's baseline.
    line(p3, y - LEAD - 4, "1", x=72 + fitz.get_text_length("appointed room.", "tiro", BODY) + 1, size=7)
    # Paragraph 2: indented, with CO2's 2 set small and lower; it runs on to page 4.
    line(p3, y, "The air held CO", x=86)
    sub_x = 86 + fitz.get_text_length("The air held CO", "tiro", BODY)
    line(p3, y + 2, "2", x=sub_x, size=7)
    line(p3, y, " and nothing else of", x=sub_x + fitz.get_text_length("2", "tiro", 7))
    line(p3, y + LEAD, "note on this page, which ends in the middle of a")
    line(p3, 700, "1 A footnote that is not read aloud.", size=8)

    p4 = pages[3]
    line(p4, 80, "sentence that goes on here.")
    line(p4, 80 + LEAD, "A one-line paragraph.", x=86)
    line(p4, 80 + 2 * LEAD, "Another paragraph follows the short one, and it", x=86)
    line(p4, 80 + 3 * LEAD, "is long enough to reach the right margin of the page.")

    p5 = pages[4]
    line(p5, 100, "Chapter 2", x=270, size=16)
    line(p5, 124, "Second Things", x=250, size=16)
    y = 170
    for t in FILLER:
        line(p5, y, t)
        y += LEAD
    for n in range(5, 9):  # pages 6 to 9
        p = pages[n]
        y = 80
        line(p, y, "A new paragraph, indented, opens the page and runs on to", x=86)
        y += LEAD
        for t in FILLER:
            line(p, y, t)
            y += LEAD
        if n == 5:  # page 6: a line that comes out in pieces (wide word spaces), then a gap
            line(p, y, "wide")
            line(p, y, "spacing", x=72 + 40)
            line(p, y, "here.", x=72 + 100)
            y += 3 * LEAD
            line(p, y, "After a gap, with no indent, a paragraph of its own starts.")
    line(pages[9], 100, "Index", size=16)
    line(pages[9], 130, "fragment, 3, 6")
    if outline:
        doc.set_toc([[1, "Title Page", 1], [1, "Contents", 2], [1, "CHAPTER 1 The Test", 3], [1, "Chapter 2 Second Things", 5], [1, "Index", 10]])
    doc.save(path)
    return path


def run(*args):
    r = subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    return r.stdout


def paragraphs(path):
    return [p.strip() for p in Path(path).read_text().split("\n\n") if p.strip()]


@pytest.fixture(scope="module")
def book(tmp_path_factory):
    return make_book(tmp_path_factory.mktemp("book") / "test-book.pdf")


@pytest.fixture(scope="module")
def split(book, tmp_path_factory):
    out = tmp_path_factory.mktemp("out")
    run(SPLIT, book, out)
    return out


def test_chapters_from_the_outline(split):
    chapters = json.loads((split / "chapters.json").read_text())
    assert [(c["title"], c["pages"], c["kind"]) for c in chapters] == [
        ("CHAPTER 1 The Test", [3, 4], "chapter"),
        ("Chapter 2 Second Things", [5, 9], "chapter"),
    ]
    report = (split / "report.md").read_text()
    assert "| 1–1 | Title Page | front | dropped |" in report
    assert "| 10–10 | Index | back | dropped |" in report


def test_chapter_one_reads_as_printed_without_what_is_not_read(split):
    assert paragraphs(split / "01-chapter-1-the-test.txt") == [
        "This first paragraph speaks of a fragment of the story, and then a fragment again, in a well-appointed room.",
        "The air held CO2 and nothing else of note on this page, which ends in the middle of a sentence that goes on here.",
        "A one-line paragraph.",
        "Another paragraph follows the short one, and it is long enough to reach the right margin of the page.",
    ]


def test_pieces_are_one_line_and_a_gap_starts_a_paragraph(split):
    ps = paragraphs(split / "02-chapter-2-second-things.txt")
    assert any(p.endswith("on the last of its pages here. wide spacing here.") for p in ps)
    assert "After a gap, with no indent, a paragraph of its own starts." in ps
    assert not any("A TEST BOOK" in p for p in ps)
    assert len(ps) == 6  # the chapter's first paragraph, one per page 6-9, and the one after the gap


def test_the_report_lists_every_change(split):
    report = (split / "report.md").read_text()
    for expected in [
        "Heading lines dropped",
        "page 3: CHAPTER 1",
        "page 3: The Test",
        "Running headers and footers dropped: 7",  # pages 3-9 (page 10, the index, is dropped)
        "Page numbers dropped: 7",
        "page 3: 1 A footnote that is not read aloud.",
        "Footnote markers dropped: 1",
        "page 3: frag-ment → fragment",
        "page 3: well-appointed",
        "## Doubts",
    ]:
        assert expected in report, expected


def test_spoken_headings_and_a_page_range(book, tmp_path):
    run(SPLIT, book, tmp_path / "a", "--spoken-headings")
    assert paragraphs(tmp_path / "a" / "01-chapter-1-the-test.txt")[0] == "Chapter 1. The Test."
    run(SPLIT, book, tmp_path / "b", "--pages", "5-9")
    assert [c["title"] for c in json.loads((tmp_path / "b" / "chapters.json").read_text())] == ["Chapter 2 Second Things"]


def test_without_an_outline_chapters_come_from_heading_lines(tmp_path):
    book = make_book(tmp_path / "no-outline.pdf", outline=False)
    run(SPLIT, book, tmp_path / "out")
    chapters = json.loads((tmp_path / "out" / "chapters.json").read_text())
    titles = [c["title"] for c in chapters]
    assert "The Test" in titles and "Chapter 2 Second Things" in titles
    test = next(c for c in chapters if c["title"] == "The Test")
    first = paragraphs(tmp_path / "out" / test["script"])[0]
    assert first.startswith("This first paragraph")  # "CHAPTER 1" above the large title is not read
    assert "no outline" in (tmp_path / "out" / "report.md").read_text()


def app_text(book):
    """What Neolibrary's scripts/pdf-paragraphs.mjs writes, made here: one paragraph per page."""
    doc = fitz.open(book)
    paras = []
    for i, page in enumerate(doc):
        t = " ".join(page.get_text().split())
        if t:
            paras.append({"id": f"p-page-{i + 1}-1", "page": i + 1, "text": t})
    sha = hashlib.sha256(Path(book).read_bytes()).hexdigest()
    return {"format": "neolibrary-pdf-paragraphs/1", "book": {"file": Path(book).name, "sha256": sha}, "paragraphs": paras}


def test_map_to_book_with_the_apps_text(book, split, tmp_path):
    (tmp_path / "app.json").write_text(json.dumps(app_text(book)))
    out = run(MAP, book, tmp_path / "map.json", *sorted(split.glob("*.txt")), "--app-text", tmp_path / "app.json")
    assert "10 of 10 script paragraphs found in the book (the app's own text)" in out
    found = json.loads((tmp_path / "map.json").read_text())["paragraphs"]
    assert [(p["page"], p["section"]) for p in found[:3]] == [(3, "p-page-3-1"), (3, "p-page-3-1"), (4, "p-page-4-1")]


def test_map_to_book_refuses_another_books_text(book, split, tmp_path):
    other = app_text(book)
    other["book"]["sha256"] = "0" * 64
    (tmp_path / "app.json").write_text(json.dumps(other))
    r = subprocess.run([sys.executable, MAP, book, tmp_path / "map.json", *sorted(split.glob("*.txt")), "--app-text", tmp_path / "app.json"], capture_output=True, text=True)
    assert r.returncode != 0 and "made from another file" in r.stderr
