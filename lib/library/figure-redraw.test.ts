import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { checkSvg, compareInk, figuresOf, FigureError, inkPieces, onlyWord, splitSvg, svgTexts, thin, wordDiff, type Box } from "./figure-redraw";

// M41 R6: a figure redrawn cleanly is accepted only as plain drawing that lies over the figure, with its very words.
const svg = (inner: string, root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"') => `<svg ${root}>${inner}</svg>`;
const PLAIN = svg('<rect x="0" y="0" width="100" height="50" fill="#fff"/><defs><marker id="ah" orient="auto"><polygon points="0,0 4,2 0,4"/></marker></defs><line x1="5" y1="5" x2="90" y2="5" stroke="black" marker-end="url(#ah)"/><text x="10" y="30" font-family="Helvetica">E<tspan dy="3" font-size="6">max</tspan> = 100</text>');

describe("checkSvg", () => {
  it("accepts plain drawing and returns it unchanged", () => {
    expect(checkSvg(`  ${PLAIN}\n`)).toBe(PLAIN);
  });

  it.each([
    ["a script", svg("<script>alert(1)</script>")],
    ["foreign content", svg("<foreignObject><div>hi</div></foreignObject>")],
    ["a picture", svg('<image href="x.png"/>')],
    ["a link", svg('<a href="https://example.org"><text>x</text></a>')],
    ["an event", svg('<rect onload="alert(1)"/>')],
    ["a style attribute", svg('<rect style="fill:url(https://example.org/x)"/>')],
    ["an outside address", svg('<line marker-end="url(https://example.org/m.svg#a)"/>')],
    ["a style element", svg("<style>rect{fill:red}</style>")],
    ["a document type", `<!DOCTYPE svg [<!ENTITY x "y">]>${PLAIN}`],
    ["no SVG namespace", svg("<rect/>", 'viewBox="0 0 10 10"')],
    ["no viewBox", svg("<rect/>", 'xmlns="http://www.w3.org/2000/svg"')],
    ["two drawings", `${PLAIN}${PLAIN}`.replace("</svg><svg", "</svg>\n<p>x</p><svg")],
  ])("refuses %s", (_, bad) => {
    expect(() => checkSvg(bad)).toThrow(FigureError);
  });
});

describe("words", () => {
  it("reads each line of words, its raised and lowered parts joined", () => {
    expect(svgTexts(PLAIN)).toEqual(["Emax = 100"]);
  });

  it("agrees whatever the layout of a formula, and not when a word or a capital differs", () => {
    expect(wordDiff(["Emax [D/Dm]^m", "1.0"], ["Emax", "D", "Dm", "m", "1.0"]).same).toBe(true);
    expect(wordDiff(["Interaction parameters", "if not"], ["interaction parameters", "If not"])).toEqual({ missing: ["Interaction", "if"], extra: ["interaction", "If"], same: false });
    expect(wordDiff(["0.5"], ["0.6"]).same).toBe(false);
  });

  it("splits a drawing into its words alone and its lines alone, and one line of words at a time", () => {
    const { words, lines } = splitSvg(PLAIN);
    expect(svgTexts(words)).toEqual(["Emax = 100"]);
    expect(words).not.toContain("<line");
    expect(svgTexts(lines)).toEqual([]);
    expect(lines).toContain("<line");
    expect(svgTexts(onlyWord(svg("<text>a</text><text>b</text>"), 1))).toEqual(["b"]);
  });
});

/** A blank w × h mask with ink where `on(x, y)`. */
const mask = (w: number, h: number, on: (x: number, y: number) => boolean) => Uint8Array.from({ length: w * h }, (_, i) => (on(i % w, Math.floor(i / w)) ? 1 : 0));
const W = 200;
const H = 120;
const none = mask(W, H, () => false);
// An axis with a tick, and a curve: the figure.
const axis = (x: number, y: number) => y >= 99 && y <= 101 && x >= 20 && x <= 180;
const tick = (x: number, y: number) => x >= 99 && x <= 101 && y >= 92 && y <= 100;
const curve = (dy: number) => (x: number, y: number) => x >= 20 && x <= 180 && Math.abs(y - (20 + dy + 0.3 * (x - 20))) <= 1;
const check = (lines: Uint8Array, figure = mask(W, H, (x, y) => axis(x, y) || tick(x, y) || curve(0)(x, y)), wordBoxes: Box[] = []) =>
  compareInk({ figure, lines, words: none, wordBoxes, w: W, h: H });

describe("compareInk", () => {
  it("passes a redraw that lies over the figure, though its lines are thinner", () => {
    const r = check(mask(W, H, (x, y) => (y === 100 && x >= 20 && x <= 180) || (x === 100 && y >= 92 && y <= 100) || (x >= 20 && x <= 180 && Math.abs(y - (20 + 0.3 * (x - 20))) < 0.6)));
    expect(r.reasons).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it("fails a curve moved by more than the tolerance, and says where", () => {
    const r = check(mask(W, H, (x, y) => axis(x, y) || tick(x, y) || curve(10)(x, y)));
    expect(r.pass).toBe(false);
    expect(r.extra).toBeGreaterThan(0.3);
    expect(r.reasons.join(" ")).toMatch(/not in the figure, near \(\d+, \d+\)/);
  });

  it("fails a missing tick mark, however small a share of the figure it is", () => {
    const r = check(mask(W, H, (x, y) => axis(x, y) || curve(0)(x, y)));
    expect(r.missed).toBeLessThan(0.04);
    expect(r.missedPieces).toHaveLength(1);
    expect(r.pass).toBe(false);
  });

  it("does not count a speck of dust in the scan, nor lettering a little wider than the redraw's", () => {
    const speck = (x: number, y: number) => x >= 150 && x <= 151 && y >= 50 && y <= 51;
    const word = (x: number, y: number) => y >= 5 && y <= 12 && x >= 30 && x <= 75 && x % 6 < 4;
    const figure = mask(W, H, (x, y) => axis(x, y) || tick(x, y) || curve(0)(x, y) || speck(x, y) || word(x, y));
    const lines = mask(W, H, (x, y) => axis(x, y) || tick(x, y) || curve(0)(x, y));
    // The redraw's word covers x 30 to 60 only: the figure's runs on to 75.
    expect(check(lines, figure, [{ x0: 30, y0: 5, x1: 60, y1: 12 }]).pass).toBe(true);
  });

  it("thins a heavy line to one pixel and finds its pieces", () => {
    const thick = mask(40, 20, (x, y) => x >= 5 && x <= 34 && y >= 8 && y <= 12);
    expect(Array.from(thin(thick, 40, 20)).filter(Boolean).length).toBeLessThan(40);
    const p = inkPieces(mask(40, 20, (x, y) => (y === 3 && x < 10) || (y === 15 && x > 30)), 40, 20);
    expect(p.size).toEqual([10, 9]);
  });
});

describe("figuresOf", () => {
  it("lists a book's pictures in reading order, with each chapter and place", () => {
    const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="text/b.xhtml" media-type="application/xhtml+xml"/><item id="p" href="images/p1.png" media-type="image/png"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>`;
    const page = (body: string) => `<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;
    const epub = zipSync({
      "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
      "OEBPS/content.opf": strToU8(opf),
      "OEBPS/a.xhtml": strToU8(page('<p><img src="images/p1.png" alt="Figure 1"/></p><img src="https://example.org/x.png"/>')),
      "OEBPS/text/b.xhtml": strToU8(page('<p>Again</p><p><img src="../images/p1.png" alt="Figure 1"/></p><img src="missing.png"/>')),
      "OEBPS/images/p1.png": Uint8Array.from([1, 2, 3]),
    });
    expect(figuresOf(epub).map(({ bytes, ...f }) => ({ ...f, bytes: bytes.length }))).toEqual([
      { key: "p1", src: "OEBPS/images/p1.png", alt: "Figure 1", spots: [{ chapter: "OEBPS/a.xhtml", nth: 0 }, { chapter: "OEBPS/text/b.xhtml", nth: 0 }], bytes: 3 },
    ]);
  });
});
