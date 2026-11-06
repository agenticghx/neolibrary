import { beforeAll, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import * as CFI from "foliate-js/epubcfi.js";
import { cfiOfRange, citeFilter, wrapCitations, type ReaderCitations } from "./citations";
import { citationCss } from "./settings";

/**
 * M41 R5: the reader wraps a paper's citations in spans; every saved place (a note, a highlight, the reading place)
 * must have the same address with the spans as without them, or notes made before would land on the wrong words.
 */
const TEXT = "Synergy is old (Waud and Parker, 1971), as Bell (1980) said, and it <i>still</i> is.";
/** The paragraph's words, as its stored text holds them (offsets count these). */
const WORDS = TEXT.replace(/<\/?i>/g, "");
/** linkedom has no Range: foliate's toRange gets one that records its ends, and says the text between them. */
function fakeRange(doc: Document) {
  const r = { sc: null as Node | null, so: 0, ec: null as Node | null, eo: 0 };
  return {
    setStart: (n: Node, o: number) => Object.assign(r, { sc: n, so: o }),
    setEnd: (n: Node, o: number) => Object.assign(r, { ec: n, eo: o }),
    toString() {
      const texts: Text[] = [];
      const walk = (n: Node) => n.childNodes.forEach((c) => (c.nodeType === 3 ? texts.push(c as Text) : walk(c)));
      walk(doc.documentElement);
      let out = "";
      let on = false;
      for (const t of texts) {
        const from = t === r.sc ? r.so : 0;
        if (t === r.sc) on = true;
        if (!on) continue;
        if (t === r.ec) return out + t.data.slice(from, r.eo);
        out += t.data.slice(from);
      }
      throw new Error("the range's end was not found");
    },
  };
}
const page = () => {
  const doc = parseHTML(`<html><body><p>Intro.</p><p id="x">${TEXT}</p><p>After.</p></body></html>`).document as unknown as Document;
  (doc as unknown as { createRange: () => unknown }).createRange = () => fakeRange(doc);
  return doc;
};

beforeAll(() => {
  // linkedom has no NodeFilter; foliate's epubcfi.js reads its constants.
  (globalThis as Record<string, unknown>).NodeFilter ??= { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
});

const para = (doc: Document) => doc.getElementById("x")!;
const DATA: ReaderCitations = {
  cites: [
    { cfi: "x", chapterIndex: 0, start: WORDS.indexOf("(Waud"), end: WORDS.indexOf("),") + 1, label: "[12]", title: "12. Waud" },
    { cfi: "x", chapterIndex: 0, start: WORDS.indexOf("(1980)"), end: WORDS.indexOf("(1980)") + 6, label: "[3]", title: "3. Bell" },
  ],
  refs: [{ cfi: "x", chapterIndex: 0, n: 7 }],
  unmatched: 0,
};
const wrapped = () => {
  const doc = page();
  expect(wrapCitations(doc, 0, DATA, () => para(doc))).toBe(2);
  return doc;
};

/** A range over the paragraph's text from one character offset to another, wherever the text nodes are. */
function range(doc: Document, from: number, to: number) {
  const nodes: Text[] = [];
  const walk = (n: Node) => n.childNodes.forEach((c) => (c.nodeType === 3 ? nodes.push(c as Text) : walk(c)));
  walk(para(doc));
  const at = (k: number): [Node, number] => {
    for (const n of nodes) {
      if (k <= n.data.length) return [n, k];
      k -= n.data.length;
    }
    throw new Error("past the end");
  };
  const [sc, so] = at(from);
  const [ec, eo] = at(to);
  return { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo, collapsed: false };
}

describe("citation spans", () => {
  it("wrap the words, keep the text, and number the entry", () => {
    const doc = wrapped();
    expect(para(doc).textContent).toBe(WORDS);
    const cites = [...para(doc).querySelectorAll('[data-nl-cite="cite"]')];
    expect(cites.map((c) => [c.getAttribute("data-n"), c.textContent, c.hasAttribute("data-space")])).toEqual([
      ["[12]", " (Waud and Parker, 1971)", true],
      ["[3]", " (1980)", true],
    ]);
    expect(para(doc).getAttribute("data-nl-ref")).toBe("7");
  });

  it("hold a whole element inside a citation: (Greco <i>et al.</i>, 1990)", () => {
    const doc = page();
    const start = WORDS.indexOf("it still");
    expect(wrapCitations(doc, 0, { ...DATA, cites: [{ ...DATA.cites[0], start, end: start + 11 }] }, () => para(doc))).toBe(1);
    expect(para(doc).querySelector('[data-nl-cite="text"]')!.innerHTML).toBe(" it <i>still</i> is");
    expect(para(doc).textContent).toBe(WORDS);
  });

  it("leave a citation that crosses an element's edge as written", () => {
    const doc = page();
    // From "it" into the middle of the italic "still": one end outside <i>, one inside.
    const start = WORDS.indexOf("it still");
    const n = wrapCitations(doc, 0, { ...DATA, cites: [{ ...DATA.cites[0], start, end: start + 6 }] }, () => para(doc));
    expect(n).toBe(0);
    expect(para(doc).innerHTML).toBe(TEXT);
  });

  // Ranges before, around, after and inside a citation, and one that ends inside a citation and one inside <i>.
  const spots: [string, number, number][] = [
    ["before", 0, 7],
    ["across the first citation", 8, WORDS.indexOf(" as Bell")],
    ["after both", WORDS.indexOf("said"), WORDS.indexOf("said") + 4],
    ["inside a citation", WORDS.indexOf("Parker"), WORDS.indexOf("Parker") + 6],
    ["ending inside a citation", 0, WORDS.indexOf("1971")],
    ["in the italic word", WORDS.indexOf("still"), WORDS.indexOf("still") + 5],
  ];
  for (const [name, from, to] of spots) {
    it(`give a range ${name} the same CFI as the page without them, and find it again`, () => {
      const plainDoc = page();
      const plain = CFI.fromRange(range(plainDoc, from, to) as unknown as Range);
      const doc = wrapped();
      expect(cfiOfRange(range(doc, from, to))).toBe(plain);
      const back = CFI.toRange(doc, CFI.parse(plain), citeFilter);
      expect(back.toString()).toBe(WORDS.slice(from, to));
    });
  }

  it("need the filter: without it an address after a citation moves", () => {
    const from = WORDS.indexOf("said");
    const plain = CFI.fromRange(range(page(), from, from + 4) as unknown as Range);
    expect(CFI.fromRange(range(wrapped(), from, from + 4) as unknown as Range)).not.toBe(plain);
  });
});

describe("citation CSS", () => {
  const colors = { accent: "teal" };
  it("adds nothing as written, so the page is laid out as before", () => {
    expect(citationCss("as-written", colors)).toBe("");
  });
  it("hides the words and draws the number when numbered, and draws neither when hidden", () => {
    expect(citationCss("numbered", colors)).toContain('[data-nl-cite="text"] { display: none !important; }');
    expect(citationCss("numbered", colors)).toContain("content: attr(data-n)");
    expect(citationCss("numbered", colors)).toContain("[data-nl-ref]::before");
    expect(citationCss("hidden", colors)).toContain('[data-nl-cite="cite"] { display: none !important; }');
    expect(citationCss("hidden", colors)).not.toContain("attr(data-n)");
  });
});
