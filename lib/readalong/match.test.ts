import { readFileSync } from "node:fs";
import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { extractSections } from "@/lib/library/sections";
import { buildPackage } from "./fixture";
import { type Paragraph, matchToParagraphs } from "./match";
import { parsePackage } from "./package";

/**
 * M13 (b): the package's timed words land on the right words of the book's
 * own paragraphs, past the differences seen in the Kuhn audiobook: spoken
 * headings that are not printed, long front matter, a footnote that was not
 * read, a phrase the narrator skipped, and a word broken across a PDF line.
 */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const para = (id: string, text: string, position: number, chapterIndex = 1): Paragraph => ({ id, text, position, chapterIndex });

describe("matching a package to the book's paragraphs", () => {
  const filler = Array.from({ length: 2000 }, (_, i) => `front${i}`).join(" ");
  const book: Paragraph[] = [
    para("front", filler, 0, 0),
    para("p1", "It was on a dreary night of November, that I beheld the accomplishment of my toils.", 1),
    para("note", "1 See the author's introduction to the edition of 1831, page iv.", 2),
    para("p2", "By the glimmer of the half- extinguished light, I saw the dull yellow eye of the creature open.", 3),
    para("p3", "“Like one who, on a lonely road, doth walk in fear and dread.”", 4),
  ];
  const pkg = parsePackage(
    buildPackage({
      bookBytes: strToU8("book"),
      chapters: [
        {
          title: "Chapter V",
          paragraphs: [
            "Chapter Five.",
            "It was on a dreary night of November, that I beheld the accomplishment of my toils.",
            "By the glimmer of the half-extinguished light, I saw the dull yellow eye of the creature open.",
            "“Like one who, on a lonely road, doth walk in fear and dread.”",
          ],
          notSpoken: [35, 36, 37], // “Like one who,
        },
      ],
    }).files,
  );
  const report = matchToParagraphs(pkg, book);
  const byId = Object.fromEntries(report.paragraphs.map((p) => [p.sectionId, p]));
  const spokenTimes = new Map(pkg.chapters[0].words.filter((w) => w.start !== null).map((w) => [Math.round(w.start! * 1000), w.w]));

  it("times every word of the paragraphs that were read, with the times from the package", () => {
    expect(byId.p1.coverage).toBe(1);
    for (const [start, , from, to] of byId.p1.words) {
      expect(norm(book[1].text.slice(from, to))).toBe(norm(spokenTimes.get(start)!));
    }
    expect(byId.p1.words.map((w) => w[0])).toEqual([...byId.p1.words.map((w) => w[0])].sort((a, b) => a - b));
    expect(byId.p1.audio).toBe("audio/01.wav");
    expect(byId.p1.startMs).toBe(byId.p1.words[0][0]);
  });

  it("finds the chapter after long front matter, and gives no time to the front matter, a spoken heading or an unread footnote", () => {
    expect(byId.front).toBeUndefined();
    expect(byId.note).toBeUndefined();
    expect(report.chapters).toEqual([{ n: 1, title: "Chapter V", spokenWords: 45, matchedWords: 43 }]); // 2 heading words unmatched
  });

  it("joins a word broken across a PDF line and highlights both halves as one word", () => {
    const text = book[3].text;
    const half = byId.p2.words.find(([, , from]) => text.slice(from).startsWith("half-"))!;
    expect(text.slice(half[2], half[3])).toBe("half- extinguished");
    expect(byId.p2.coverage).toBe(1);
  });

  it("leaves the words the narrator skipped without a time", () => {
    const text = book[4].text;
    const timedWords = byId.p3.words.map(([, , f, t]) => text.slice(f, t));
    expect(timedWords).not.toContain("“Like");
    expect(timedWords).not.toContain("who,");
    expect(timedWords[0]).toBe("on");
    expect(byId.p3.coverage).toBeCloseTo(10 / 13, 3);
  });

  it("works on a real EPUB as the app splits it (Frankenstein, chapter V)", () => {
    const sections = extractSections(new Uint8Array(readFileSync("fixtures/books/shelley-frankenstein.epub")));
    const paragraphs = sections.filter((s) => s.kind === "paragraph");
    const start = paragraphs.findIndex((p) => p.text.startsWith("It was on a dreary night of November"));
    const read = paragraphs.slice(start, start + 3);
    const real = parsePackage(
      buildPackage({
        bookBytes: strToU8("book"),
        chapters: [{ title: "Chapter V", paragraphs: ["Chapter Five.", ...read.map((p) => p.text)], inBook: [null, ...read.map((p) => p.chapterIndex)] }],
      }).files,
    );
    const r = matchToParagraphs(real, paragraphs);
    expect(r.paragraphs.map((p) => p.sectionId)).toEqual(read.map((p) => p.id));
    expect(r.paragraphs.every((p) => p.coverage === 1)).toBe(true);
    // Without the book map's chapter, the introduction's quotation of this
    // passage would be taken for it.
    expect(paragraphs.slice(0, start).some((p) => p.text.includes("dreary night of November"))).toBe(true);
    // Times run on from one paragraph to the next.
    const starts = r.paragraphs.map((p) => p.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
