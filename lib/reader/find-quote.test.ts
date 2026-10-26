import { DOMParser } from "linkedom";
import { describe, expect, it } from "vitest";
import { findLetters, lettersOf, positionsForQuote } from "./find-quote";

const docOf = (body: string) => new DOMParser().parseFromString(`<html><body>${body}</body></html>`, "text/html") as unknown as Document;

/** The text between two positions found by positionsForQuote, across text nodes. */
function textOf(root: Element, at: { start: [Node, number]; end: [Node, number] } | null) {
  if (!at) return null;
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  let out = "";
  let on = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    const from = node === at.start[0] ? at.start[1] : 0;
    if (node === at.start[0]) on = true;
    if (!on) continue;
    if (node === at.end[0]) return out + text.slice(from, at.end[1]);
    out += text.slice(from);
  }
  return out;
}

const mark = (n: number) => `<span epub:type="pagebreak" role="doc-pagebreak" id="page-${n}" aria-label="${n}"></span>`;

describe("a note's words found again in the other version of the book (Open unknowns row 23 (1))", () => {
  it("compares letters and digits only, and picks the place its words before match", () => {
    expect(lettersOf("“Mr. Hyde,” he said—twice!")).toBe("mrhydehesaidtwice");
    const text = lettersOf("He said yes. Then she said yes. Then they said yes.");
    const yes = lettersOf("said yes");
    expect(findLetters(text, yes)).toEqual([text.indexOf(yes), text.indexOf(yes) + yes.length]);
    const theirs = text.indexOf(lettersOf("they said yes")) + "they".length;
    expect(findLetters(text, yes, lettersOf("Then they"))).toEqual([theirs, theirs + yes.length]);
  });

  it("finds a long quote read differently by its ends; a short one only whole", () => {
    const quote = lettersOf("Several years have now elapsed since I first became aware");
    // A word read differently in the middle: both ends are there.
    const middle = lettersOf("Several years have now elapsod since I first became aware of it.");
    expect(findLetters(middle, quote)).toEqual([0, quote.length]);
    // In its first letters: the last ones, and the quote's length back from them.
    const first = lettersOf("Sevcral years have now elapsed since I first became aware");
    expect(findLetters(first, quote)).toEqual([0, quote.length]);
    expect(findLetters(lettersOf("the cat sab"), lettersOf("the cat sat"))).toBeNull();
  });

  it("in a text edition, looks between the page's break and the next one, and a little past it", () => {
    const doc = docOf(
      `<p>Page one: the cat sat.</p><p>It goes on ${mark(2)}and on, and the cat sat again.</p><p>More of page two.${mark(3)} Page three: the cat sat.</p>`,
    );
    expect(textOf(doc.body, positionsForQuote(doc.body, { exact: "the cat sat" }, 2))).toBe("the cat sat");
    // The page-two one, not page one's or three's.
    const two = positionsForQuote(doc.body, { exact: "the cat sat" }, 2)!;
    expect(two.start[0].nodeValue).toBe("and on, and the cat sat again.");
    expect(positionsForQuote(doc.body, { exact: "the cat sat" }, 3)!.start[0].nodeValue).toBe(" Page three: the cat sat.");
    // A quote that runs on past its page's end.
    expect(textOf(doc.body, positionsForQuote(doc.body, { exact: "page two. Page three" }, 2))).toBe("page two. Page three");
    // Not on its page: not found, even though the words are on another page.
    expect(positionsForQuote(doc.body, { exact: "Page one" }, 2)).toBeNull();
  });

  it("on a scan's page, finds the words of a note made in the text edition in the page's own text", () => {
    const doc = docOf(`<div class="textLayer"><span>Tbe quick brown fox</span><span> jumps over the</span><br><span>lazy dog, said he.</span></div>`);
    const layer = doc.querySelector(".textLayer")!;
    expect(textOf(layer, positionsForQuote(layer, { exact: "The quick brown fox jumps over the lazy dog" }))).toBe("Tbe quick brown fox jumps over thelazy dog");
    expect(textOf(layer, positionsForQuote(layer, { exact: "lazy dog" }))).toBe("lazy dog");
  });
});
