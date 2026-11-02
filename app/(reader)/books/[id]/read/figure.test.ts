import { describe, expect, it } from "vitest";
import { figureAt, MIN_FIGURE_PX } from "./figure";

/** Just enough of a page's elements for figureAt (its pages come from another window, so it duck-types them). */
type Fake = {
  nodeName: string;
  parent: Fake | null;
  next: Fake | null;
  children: Fake[];
  text: string;
  cls?: string;
  img?: { src: string; alt: string; w: number; h: number };
};
function el(nodeName: string, opts: Partial<Fake> = {}): Fake {
  return { nodeName, parent: null, next: null, children: [], text: "", ...opts };
}
function child(parent: Fake, c: Fake) {
  c.parent = parent;
  const last = parent.children.at(-1);
  if (last) last.next = c;
  parent.children.push(c);
  return c;
}
function matches(f: Fake, sel: string) {
  return sel.split(",").some((s) => s.trim().toLowerCase() === f.nodeName.toLowerCase());
}
function wrap(f: Fake | null): unknown {
  if (!f) return null;
  const textOf = (n: Fake): string => n.text + n.children.map(textOf).join("");
  const find = (n: Fake, sel: string): Fake | null => {
    for (const c of n.children) {
      if (matches(c, sel)) return c;
      const d = find(c, sel);
      if (d) return d;
    }
    return null;
  };
  return {
    nodeName: f.nodeName,
    get textContent() {
      return textOf(f);
    },
    get nextElementSibling() {
      return wrap(f.next);
    },
    closest(sel: string) {
      for (let n: Fake | null = f; n; n = n.parent) if (matches(n, sel)) return wrap(n);
      return null;
    },
    querySelector: (sel: string) => wrap(find(f, sel)),
    currentSrc: f.img?.src ?? "",
    src: f.img?.src ?? "",
    alt: f.img?.alt ?? "",
    getBoundingClientRect: () => ({ width: f.img?.w ?? 0, height: f.img?.h ?? 0 }),
  };
}

function paper(legend: string, size = 300) {
  const body = el("BODY");
  const p = child(body, el("P"));
  const img = child(p, el("IMG", { img: { src: "blob:fig-1", alt: "Figure 1", w: size, h: size } }));
  child(body, el("P", { text: legend }));
  return img;
}

describe("tap a figure to see it full screen (M41)", () => {
  it("offers a paper's figure with the legend in the paragraph after it", () => {
    expect(figureAt(wrap(paper("Figure 1.  Effect against\n dose.")))).toEqual({ src: "blob:fig-1", alt: "Figure 1", legend: "Figure 1. Effect against dose." });
    expect(figureAt(wrap(paper("Fig. 12 The isobologram.")))?.legend).toBe("Fig. 12 The isobologram.");
  });

  it("leaves out a next paragraph that is not a legend", () => {
    expect(figureAt(wrap(paper("The effect falls as the dose rises.")))?.legend).toBe("");
  });

  it("takes a <figure>'s caption", () => {
    const fig = el("FIGURE");
    const img = child(fig, el("IMG", { img: { src: "blob:p", alt: "", w: 200, h: 100 } }));
    child(fig, el("FIGCAPTION", { text: " A plate of lamps " }));
    expect(figureAt(wrap(img))?.legend).toBe("A plate of lamps");
  });

  it("offers nothing for a picture in a link, a tiny one, or text", () => {
    const a = el("A");
    const linked = child(a, el("IMG", { img: { src: "blob:l", alt: "", w: 300, h: 300 } }));
    expect(figureAt(wrap(linked))).toBeNull();
    expect(figureAt(wrap(paper("Figure 1.", MIN_FIGURE_PX - 1)))).toBeNull();
    expect(figureAt(wrap(el("P", { text: "words" })))).toBeNull();
    expect(figureAt(null)).toBeNull();
    expect(figureAt({})).toBeNull();
  });
});

describe("tap an equation to have it explained (M41 R4b)", () => {
  const math = (alttext: string | null, display = "block") => {
    const p = el("P");
    const m = child(p, el("MATH"));
    const mi = child(m, el("MI", { text: "E" }));
    const w = wrap(mi) as { closest(s: string): unknown };
    const closest = w.closest.bind(w);
    // The fake's closest() knows tag names only; teach it the attribute selector the code uses.
    w.closest = (sel: string) =>
      sel === 'math[display="block"]'
        ? display === "block"
          ? Object.assign(wrap(m) as object, { getAttribute: (n: string) => (n === "alttext" ? alttext : null), closest: (s: string) => (s === "a" ? null : wrap(p)) })
          : null
        : closest(sel);
    return w;
  };
  it("finds the LaTeX and the equation's number", async () => {
    const { equationAt } = await import("./figure");
    expect(equationAt(math("E = \\frac{a}{b} \\tag{3}"))).toMatchObject({ latex: "E = \\frac{a}{b} \\tag{3}", number: "3" });
    expect(equationAt(math("x^2"))).toMatchObject({ latex: "x^2", number: null });
  });
  it("offers nothing without LaTeX, for an inline formula, or for text", async () => {
    const { equationAt } = await import("./figure");
    expect(equationAt(math(null))).toBeNull();
    expect(equationAt(math("x", "inline"))).toBeNull();
    expect(equationAt(wrap(el("P", { text: "words" })))).toBeNull();
  });
});
