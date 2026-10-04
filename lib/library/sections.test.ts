import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
// foliate-js's own CFI code: if it resolves our addresses to the same
// paragraphs, the reader and the section model agree.
import * as CFI from "foliate-js/epubcfi.js";
import { DOMParser } from "linkedom";
import { describe, expect, it } from "vitest";
import { parseEpub } from "./ebook";
import { extractSections } from "./sections";
import { readableEpub } from "./test-epub";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

describe("section model", () => {
  const bytes = fixture("stevenson-jekyll-and-hyde.epub");
  const info = parseEpub(bytes);
  const sections = extractSections(bytes, info.toc);

  it("splits a book into chapters and paragraphs, in reading order", () => {
    const chapters = sections.filter((s) => s.kind === "chapter");
    const labels = chapters.map((c) => c.label);
    expect(labels).toContain("Story of the Door");
    expect(labels).toContain("Search for Mr. Hyde");
    expect(labels.indexOf("Story of the Door")).toBeLessThan(labels.indexOf("Search for Mr. Hyde"));
    const paragraphs = sections.filter((s) => s.kind === "paragraph");
    expect(paragraphs.length).toBeGreaterThan(200);
    expect(paragraphs.some((p) => p.text.startsWith("Mr. Utterson the lawyer was a man of a rugged countenance"))).toBe(true);
    expect(sections.map((s) => s.position)).toEqual(sections.map((_, i) => i));
    for (const p of paragraphs) expect(sections.find((s) => s.id === p.parentId), p.id).toBeDefined();
  });

  it("gives the same ids when the same file is imported again", () => {
    const again = extractSections(fixture("stevenson-jekyll-and-hyde.epub"), info.toc);
    expect(again.map((s) => s.id)).toEqual(sections.map((s) => s.id));
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length);
  });

  it("gives every paragraph a CFI that foliate-js resolves back to that paragraph", () => {
    const files = unzipSync(bytes);
    const docs = new Map<string, Document>();
    const doc = (href: string) => {
      if (!docs.has(href)) docs.set(href, new DOMParser().parseFromString(strFromU8(files[href]), "text/xml") as unknown as Document);
      return docs.get(href)!;
    };
    const paragraphs = sections.filter((s) => s.kind === "paragraph");
    for (const p of paragraphs.filter((_, i) => i % 7 === 0)) {
      const parts = CFI.parse(p.cfi);
      parts.shift(); // the package part: which chapter file
      const el = CFI.toElement(doc(p.href), parts[0]) as Element;
      expect(el.textContent!.replace(/\s+/g, " ").trim(), p.cfi).toBe(p.text);
    }
  });

  it("works on a minimal EPUB and keeps headings as sections", () => {
    const tiny = readableEpub("Tiny", ["<h1>One</h1><p>First.</p><h2>Part</h2><p>Second.</p>", "<p>Third.</p>"]);
    const s = extractSections(tiny, []);
    expect(s.map((x) => [x.kind, x.label || x.text])).toEqual([
      ["chapter", "One"],
      ["paragraph", "First."],
      ["section", "Part"],
      ["paragraph", "Second."],
      ["chapter", "Part 2"],
      ["paragraph", "Third."],
    ]);
    expect(s[3].parentId).toBe(s[2].id);
  });
});
