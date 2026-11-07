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
  it("fetches this chapter's redraws, shows them in place of the printed pictures, marks their holders, and switches back", async () => {
    const doc = page();
    const before = doc.body.querySelectorAll("*").length;
    const asked: string[] = [];
    // The reader fetches each redraw from its own page and hands the book's page a blob: address (WebKit sends no
    // sign-in cookie with a picture request from the book's page).
    const load = async (url: string) => {
      asked.push(url);
      return `blob:redraw-${asked.length - 1}`;
    };
    expect(placeRedraws(doc, "OEBPS/c1.xhtml", [fig(0), fig(1), fig(2), fig(0, "OEBPS/c2.xhtml")], "book", "https://lib.example", () => "redrawn", load)).toBe(3);
    expect(asked).toEqual([
      "https://lib.example/api/books/book/figures/00000000-0000-4000-8000-000000000000.svg",
      "https://lib.example/api/books/book/figures/00000000-0000-4000-8000-000000000001.svg",
      "https://lib.example/api/books/book/figures/00000000-0000-4000-8000-000000000002.svg",
    ]);
    const imgs = Array.from(doc.querySelectorAll("img"));
    await new Promise((r) => setTimeout(r, 0));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["blob:redraw-0", "blob:redraw-1", "blob:redraw-2"]);
    // A picture alone in its paragraph or <figure> gets the "Redrawn by AI" line; one inside a sentence does not.
    expect(Array.from(doc.querySelectorAll("[data-nl-redrawn]")).map((e) => e.tagName.toLowerCase())).toEqual(["p", "figure"]);
    expect(doc.body.querySelectorAll("*").length).toBe(before);

    showFigures(doc, "printed");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["blob:a", "blob:b", "blob:c"]);
    expect(doc.querySelectorAll("[data-nl-redrawn]")).toHaveLength(0);
  });

  it("leaves a chapter with no redraws alone, and the printed picture when a redraw cannot be fetched", async () => {
    const doc = page();
    const load = async () => "blob:x";
    expect(placeRedraws(doc, "OEBPS/c9.xhtml", [fig(0)], "book", "https://lib.example", () => "redrawn", load)).toBe(0);
    expect(placeRedraws(doc, undefined, [fig(0)], "book", "https://lib.example", () => "redrawn", load)).toBe(0);
    expect(placeRedraws(doc, "OEBPS/c1.xhtml", [fig(0)], "book", "https://lib.example", () => "redrawn", () => Promise.reject(new Error("401")))).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("blob:a");
    expect(doc.querySelectorAll("[data-nl-redrawn]")).toHaveLength(0);
  });

  it("shows a redraw as printed when Figures was switched while it was being fetched", async () => {
    const doc = page();
    let mode: "redrawn" | "printed" = "redrawn";
    let arrive: (u: string) => void = () => undefined;
    placeRedraws(doc, "OEBPS/c1.xhtml", [fig(0)], "book", "https://lib.example", () => mode, () => new Promise<string>((r) => (arrive = r)));
    mode = "printed";
    arrive("blob:late");
    await new Promise((r) => setTimeout(r, 0));
    expect(doc.querySelector("img")!.getAttribute("src")).toBe("blob:a");
  });

  it("names the model as a reader would", () => {
    expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(modelName("claude-sonnet-5-5-20261001")).toBe("Claude Sonnet 5.5");
  });
});
