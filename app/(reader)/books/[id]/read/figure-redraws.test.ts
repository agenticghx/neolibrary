import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { modelName, placeRedraws, showFigures, type ReaderFigure } from "./figure-redraws";

// M41 R6: a redrawn figure replaces the printed one by its address only; nothing is added to the page.
const page = () =>
  parseHTML(
    '<html><body><p>Text.</p><p class="figure"><img src="blob:a" alt="Figure 1"/></p><p>Figure 1. A lamp.</p><p>Inline <img src="blob:b" alt="icon"/> picture.</p><figure><img src="blob:c" alt="Figure 2"/><figcaption>Figure 2.</figcaption></figure></body></html>',
  ).document;
const fig = (nth: number, chapter = "OEBPS/c1.xhtml"): ReaderFigure => ({ chapter, nth, id: `00000000-0000-4000-8000-00000000000${nth}`, model: "claude-opus-5-5", at: "2026-11-07T00:00:00Z" });

describe("redrawn figures in the page", () => {
  it("shows this chapter's redraws in place of the printed pictures, marks their holders, and switches back", () => {
    const doc = page();
    const before = doc.body.querySelectorAll("*").length;
    expect(placeRedraws(doc, "OEBPS/c1.xhtml", [fig(0), fig(1), fig(2), fig(0, "OEBPS/c2.xhtml")], "book", "https://lib.example", "redrawn")).toBe(3);
    const imgs = Array.from(doc.querySelectorAll("img"));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "https://lib.example/api/books/book/figures/00000000-0000-4000-8000-000000000000.svg",
      "https://lib.example/api/books/book/figures/00000000-0000-4000-8000-000000000001.svg",
      "https://lib.example/api/books/book/figures/00000000-0000-4000-8000-000000000002.svg",
    ]);
    // A picture alone in its paragraph or <figure> gets the "Redrawn by AI" line; one inside a sentence does not.
    expect(Array.from(doc.querySelectorAll("[data-nl-redrawn]")).map((e) => e.tagName.toLowerCase())).toEqual(["p", "figure"]);
    expect(doc.body.querySelectorAll("*").length).toBe(before);

    showFigures(doc, "printed");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["blob:a", "blob:b", "blob:c"]);
    expect(doc.querySelectorAll("[data-nl-redrawn]")).toHaveLength(0);
  });

  it("leaves a chapter with no redraws alone", () => {
    const doc = page();
    expect(placeRedraws(doc, "OEBPS/c9.xhtml", [fig(0)], "book", "https://lib.example", "redrawn")).toBe(0);
    expect(placeRedraws(doc, undefined, [fig(0)], "book", "https://lib.example", "redrawn")).toBe(0);
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("blob:a");
  });

  it("names the model as a reader would", () => {
    expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelName("claude-sonnet-5-5-20261001")).toBe("Claude Sonnet 5.5");
  });
});
