import { DOMParser } from "linkedom";
import { describe, expect, it } from "vitest";
import { positionsForOffsets } from "./text-range";

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

describe("word offsets to a range on the page (M7)", () => {
  it("finds every word of a paragraph with inline markup and odd whitespace", () => {
    const html = `<html><body><p id="p">
      That evening, <i>Mr.  Utterson</i>
      came&#160;home to his <b>bach</b>elor house.</p></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html") as unknown as Document;
    const el = doc.getElementById("p")!;
    const text = clean(el.textContent!);
    // Reads the text between two positions, across text nodes (what a Range would hold).
    const between = (a: [Node, number], b: [Node, number]) => {
      const walker = doc.createTreeWalker(el, 4);
      let out = "";
      let on = false;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const v = n.nodeValue ?? "";
        const s = n === a[0] ? a[1] : 0;
        if (n === a[0]) on = true;
        if (!on) continue;
        if (n === b[0]) return out + v.slice(s, b[1]);
        out += v.slice(s);
      }
      return out;
    };
    const words = [...text.matchAll(/\S+/g)];
    expect(words.map((m) => m[0])).toEqual(["That", "evening,", "Mr.", "Utterson", "came", "home", "to", "his", "bachelor", "house."]);
    for (const m of words) {
      const at = positionsForOffsets(el, m.index!, m.index! + m[0].length);
      expect(at, m[0]).not.toBeNull();
      expect(between(at!.start, at!.end)).toBe(m[0]);
    }
    expect(positionsForOffsets(el, 500, 505)).toBeNull();
  });
});
