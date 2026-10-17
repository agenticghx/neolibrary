import { strFromU8, unzipSync } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { importBook } from "./import";
import { getSections } from "./sections-store";
import { assembleEdition, buildTextEdition, type EditionMeta, type EditionPage } from "./text-epub";

// M25 S5: the pages Claude read, joined into one flowing book. Invented text throughout.

const read = (page: number, markdown: string): EditionPage => ({ page, kind: "read", markdown });
const META: EditionMeta = { bookId: "b-1", title: "The Lighthouse & Its Keeper", author: "Iris Wick", language: "en", model: "claude-sonnet-5-5", madeAt: new Date("2026-10-15T18:00:00Z"), toCheck: [3] };

const PAGES: EditionPage[] = [
  read(1, "# The Lighthouse\n\n## A keeper's year"),
  { page: 2, kind: "blank" },
  read(3, "# 1. Dusk\n\nThe keeper climbs the stair at dusk and lights the lamp.[^1] He trims the wick and winds the clock that turns the"),
  read(4, "lens, then writes in the log. The harbour is quiet tonight, and the eco-\n\n[^1]: The lamp burns paraffin."),
  read(5, "nomy of the town depends on the boats.\n\n## The log\n\n| Hour | Boats |\n|---|---|\n| 8 pm | 3 |\n| 9 pm | 5 < 6 |\n\n[Figure: The lamp room]"),
  { page: 6, kind: "unread" },
  read(7, "# 2. Dawn\n\nAt dawn he puts the lamp out.[^1]\n\n[^1]: The first note of chapter 2, also numbered 1."),
];

describe("joining the pages", () => {
  const chapters = assembleEdition(PAGES);

  it("starts a chapter at each level-1 heading", () => {
    expect(chapters.map((c) => c.title)).toEqual(["The Lighthouse", "1. Dusk", "2. Dawn"]);
    expect(chapters.map((c) => c.pages)).toEqual([[1, 2], [3, 4, 5, 6], [7]]);
  });

  it("makes one chapter of a title over two lines, and none of the book's title printed again (The Pay Off)", () => {
    const front = assembleEdition(
      [
        read(1, "'Admirably lucid'\n\n# THE LIGHTHOUSE & ITS KEEPER\n\nIRIS WICK"),
        read(2, "'A quiet triumph.'"),
        read(3, "# The Lighthouse & Its Keeper"), // the half title
        read(4, "# THE LIGHTHOUSE & ITS KEEPER\n\n## A keeper's year\n\nHarbour Press"), // the title page
        read(5, "# PART I\n\n# NIGHT"),
        read(6, "# 1. Dusk\n\nThe keeper climbs the stair."),
        read(7, "# Notes\n\nOn dusk."),
        read(8, "# PART II\n\n# DAY"),
        read(9, "# Notes\n\nOn dawn."), // the same name again, but not the book's title: a chapter of its own
      ],
      META.title,
    );
    expect(front.map((c) => c.title)).toEqual(["Opening pages", "THE LIGHTHOUSE & ITS KEEPER", "PART I: NIGHT", "1. Dusk", "Notes", "PART II: DAY", "Notes"]);
    expect(front.map((c) => c.pages)).toEqual([[1], [2, 3, 4], [5], [6], [7], [8], [9]]); // page 1 opens with the quote, before the title
    expect(front[1].html).toContain("<h1>The Lighthouse &amp; Its Keeper</h1>"); // still shown where it was printed
    expect(front[2].html).toMatch(/<h1>PART I<\/h1>\s*<h1>NIGHT<\/h1>/);
  });

  it("keeps a heading at its neighbours' level when one page gives it a level too high (The Pay Off's Sources)", () => {
    const sources = assembleEdition([
      read(1, "# Sources\n\n## Chapter 1\n\nOn lamps, see the keepers' handbook."),
      read(2, "## Chapter 2\n\nOn tides, see the almanac."),
      read(3, "# Chapter 3\n\nOn boats, see the harbour log."),
      read(4, "## Chapter 4\n\nOn fog, see the weather book."),
      read(5, "# Index\n\n## A\n\nalmanac, 2"),
    ]);
    expect(sources.map((c) => c.title)).toEqual(["Sources", "Index"]);
    expect(sources[0].html).toContain("<h2>Chapter 3</h2>");
  });

  it("never carries a paragraph across a blank page, so the page markers stay in order (The Pay Off's cover)", () => {
    const [c] = assembleEdition([read(1, "IRIS WICK"), { page: 2, kind: "blank" }, read(3, "'A quiet triumph.'")]);
    expect(c.html).toMatch(/<p>IRIS WICK<\/p>\s*<span[^>]*id="page-2"[^>]*><\/span>\s*<span[^>]*id="page-3"[^>]*><\/span>\s*<p>'A quiet triumph.'<\/p>/);
  });

  it("carries a sentence cut by a table at the foot of a page on overleaf, before the table, as in print (The Pay Off pp. 165-166)", () => {
    const [c] = assembleEdition([
      read(1, "The log shows how busy the harbour was, and these alone represent a thousand boats per\n\n| Hour | Boats |\n|---|---|\n| 8 pm | 3 |"),
      read(2, "year, most of them small.\n\nThe next paragraph."),
    ]);
    expect(c.html).toMatch(/a thousand boats per <span[^>]*id="page-2"[^>]*><\/span>year, most of them small\.<\/p>\s*<table>/);
    expect(c.html).not.toContain("<p>year,");
    // With the table's title and source lines around it, as The Pay Off prints them.
    const [d] = assembleEdition([
      read(1, "These alone represent a thousand boats per\n\nTable 2. Boats by hour.\n\n| Hour | Boats |\n|---|---|\n| 8 pm | 3 |\n\nSource: the harbour log."),
      read(2, "year, most of them small."),
    ]);
    expect(d.html).toMatch(/a thousand boats per <span[^>]*id="page-2"[^>]*><\/span>year, most of them small\.<\/p>\s*<p>Table 2\. Boats by hour\.<\/p>/);
  });

  it("carries on a page that opens mid-sentence past a page ending on ';', a figure on top, or a whole page of table, markers in order", () => {
    const [c] = assembleEdition([
      read(1, "Most cash in circulation doesn't actually circulate;"),
      read(2, "it sits in drawers. The lamp room holds the"),
      read(3, "Table 1. Boats by hour.\n\n| Hour | Boats |\n|---|---|\n| 8 pm | 3 |\n\nAdapted from the harbour log (2016)."),
      read(4, "[Figure: Figure 2. The lamp.]\n\nspare wicks and the log. Night falls."),
    ]);
    expect(c.html).toContain("circulate; <span");
    expect(c.html).toMatch(/holds the<span[^>]*id="page-3"[^>]*><\/span> <span[^>]*id="page-4"[^>]*><\/span>spare wicks and the log\. Night falls\.<\/p>/);
    const order = [...c.html.matchAll(/id="page-(\d+)"/g)].map((m) => Number(m[1]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(c.html.indexOf("<table>")).toBeGreaterThan(c.html.indexOf("Night falls."));
  });

  it("ends a footnote carried over to the next page ([^0]) with its last words, and keeps them out of the text", () => {
    const [c] = assembleEdition([
      read(1, "The gang broke in.[^4] The keeper slept.\n\n[^4]: Hackers have also broken"),
      read(2, "The tide turned.\n\n[^0]: directly into the lamp room using a stolen key."),
    ]);
    expect(c.html).toContain("Hackers have also broken directly into the lamp room using a stolen key.");
    expect(c.html).not.toContain("<p>directly");
  });

  it("carries a paragraph across a page break, with the page marker inside it", () => {
    expect(chapters[1].html).toContain(
      'winds the clock that turns the <span epub:type="pagebreak" role="doc-pagebreak" id="page-4" aria-label="4"></span>lens, then writes in the log.',
    );
  });

  it("joins a word broken across a page break", () => {
    expect(chapters[1].html).toContain('and the eco<span epub:type="pagebreak" role="doc-pagebreak" id="page-5" aria-label="5"></span>nomy of the town');
  });

  it("does not join a finished paragraph to the next page", () => {
    expect(chapters[2].html.indexOf('id="page-7"')).toBeLessThan(chapters[2].html.indexOf("<h1>2. Dawn</h1>"));
  });

  it("gathers footnotes at the end of their chapter, linked both ways, even when two chapters number them alike", () => {
    expect(chapters[1].html).toContain('<a epub:type="noteref" role="doc-noteref" id="ref-3-1" href="#note-3-1"><sup>1</sup></a>');
    expect(chapters[1].html).toMatch(/<section epub:type="footnotes"[^>]*><h2>Notes<\/h2><aside epub:type="footnote" role="doc-footnote" id="note-3-1"><p><a href="#ref-3-1" role="doc-backlink">1\.<\/a> The lamp burns paraffin\.<\/p><\/aside><\/section>$/);
    expect(chapters[2].html).toContain('id="note-7-1"');
    expect(chapters[1].html).not.toContain("note-7-1");
  });

  it("keeps a table, a figure, and escapes what is not Markdown", () => {
    expect(chapters[1].html).toContain("<table><thead><tr><th>Hour</th><th>Boats</th></tr></thead><tbody><tr><td>8 pm</td><td>3</td></tr><tr><td>9 pm</td><td>5 &lt; 6</td></tr></tbody></table>");
    expect(chapters[1].html).toContain('<p class="figure">[Figure: The lamp room]</p>');
    expect(chapters[1].html).toContain("<h2>The log</h2>");
  });

  it("says where a page was not read, and leaves only a marker for a blank page", () => {
    expect(chapters[1].html).toContain('<span epub:type="pagebreak" role="doc-pagebreak" id="page-6" aria-label="6"></span>\n<p class="unread">Page 6 was not read. See it in the scan.</p>');
    expect(chapters[0].html).toMatch(/id="page-2" aria-label="2"><\/span>$/);
  });

  it("turns emphasis into italics and bold, and never passes HTML through", () => {
    const [c] = assembleEdition([read(1, "A *quiet* and **bright** night <script>alert(1)</script>.")]);
    expect(c.html).toContain("A <em>quiet</em> and <strong>bright</strong> night &lt;script&gt;alert(1)&lt;/script&gt;.");
  });
});

describe("the EPUB file", () => {
  const epub = buildTextEdition(PAGES, META);
  const files = unzipSync(epub);

  it("starts with an uncompressed mimetype, as EPUB requires", () => {
    expect(strFromU8(epub.subarray(30, 38))).toBe("mimetype");
    expect(new DataView(epub.buffer, epub.byteOffset).getUint16(8, true)).toBe(0); // compression method: stored
    expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
  });

  it("is well-formed XML throughout", () => {
    for (const [name, data] of Object.entries(files)) {
      if (!/\.(xhtml|opf|xml)$/.test(name)) continue;
      expect(XMLValidator.validate(strFromU8(data)), name).toBe(true);
    }
  });

  it("opens with an About page that names the model and date, and links the pages to check", () => {
    const about = strFromU8(files["OEBPS/about.xhtml"]);
    expect(about).toContain("by claude-sonnet-5-5 on 2026-10-15, page by page (5 of 7 pages; blank pages left out)");
    expect(about).toContain('<a href="c2.xhtml#page-3">3</a>');
    expect(strFromU8(files["OEBPS/content.opf"])).toContain("<dc:title>The Lighthouse &amp; Its Keeper</dc:title>");
  });

  it("lists every page in the navigation's page list, so Go to page works", () => {
    const nav = strFromU8(files["OEBPS/nav.xhtml"]);
    expect([...nav.matchAll(/#page-(\d+)">(\d+)</g)].map((m) => Number(m[1]))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  describe("read by the app's own importer", () => {
    let database: Database;
    beforeEach(async () => {
      database = await testDatabase();
    });
    afterEach(() => database.raw.close());

    it("imports as an EPUB with the joined paragraphs", async () => {
      const storage = new MemoryStorage();
      const owner = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
      const { bookId } = await importBook(database.db, storage, owner, { name: "edition.epub", bytes: epub });
      const paragraphs = (await getSections(database.db, owner, bookId)).filter((s) => s.kind === "paragraph").map((s) => s.text);
      // One paragraph across pages 3 to 5 (the footnote's number stays as "1" after "lamp.").
      expect(paragraphs).toContain(
        "The keeper climbs the stair at dusk and lights the lamp.1 He trims the wick and winds the clock that turns the lens, then writes in the log. The harbour is quiet tonight, and the economy of the town depends on the boats.",
      );
    });
  });
});
