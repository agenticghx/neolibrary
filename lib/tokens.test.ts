import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseColorTokens } from "./contrast";

// Every text colour must be readable on every surface it is used on, in both
// themes. 4.5:1 is the WCAG AA minimum for body text; 3:1 for large text and UI.
const css = readFileSync(new URL("../app/tokens.css", import.meta.url), "utf8");
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = parseColorTokens(css.slice(0, darkStart));
const dark = { ...light, ...parseColorTokens(css.slice(darkStart, css.indexOf("@media (prefers-reduced-motion"))) };
const themeBlock = (name: string) => {
  const start = css.indexOf(`.theme-${name} {`);
  return parseColorTokens(css.slice(start, css.indexOf("}", start)));
};
const themes = { paper: themeBlock("paper"), sepia: themeBlock("sepia"), night: themeBlock("night") };

const pairs: [fg: string, bg: string, min: number][] = [
  ["ink-900", "paper", 7],
  ["ink-900", "paper-raised", 7],
  ["ink-900", "paper-sunken", 7],
  ["ink-700", "paper", 4.5],
  ["ink-700", "paper-raised", 4.5],
  ["ink-500", "paper", 4.5],
  ["ink-500", "paper-raised", 4.5],
  ["accent", "paper", 4.5],
  ["on-accent", "accent", 4.5],
  ["ink-900", "highlight", 4.5],
  ["ink-900", "highlight-active", 4.5],
  ["machine-ink", "machine-bg", 4.5],
  ["cover-ink", "cover-navy", 4.5],
  ["cover-ink", "cover-green", 4.5],
  ["cover-empty-ink", "cover-empty", 4.5],
  ["focus-ring", "paper", 3],
  ["machine-rule", "machine-bg", 3],
  // The reading calendar's strongest shade (an hour or more) stands out from the page like any UI graphic.
  ["heat-4", "paper", 3],
  // The wash is the page behind the shelves, and the sidebar sits on its own sage. Text there
  // has to stay as readable as text on paper. Glass is paper-raised with a little transparency.
  ["ink-900", "wash-ivory", 7],
  ["ink-900", "wash-cream", 7],
  ["ink-900", "wash-sage", 7],
  ["ink-900", "wash-slate", 7],
  ["ink-900", "glass-side-solid", 7],
  ["ink-900", "glass", 7],
  ["ink-700", "wash-ivory", 4.5],
  ["ink-700", "wash-cream", 4.5],
  ["ink-700", "wash-sage", 4.5],
  ["ink-700", "wash-slate", 4.5],
  ["ink-700", "glass-side-solid", 4.5],
  ["ink-500", "wash-ivory", 4.5],
  ["ink-500", "wash-cream", 4.5],
  ["ink-500", "wash-sage", 4.5],
  ["ink-500", "wash-slate", 4.5],
  ["ink-500", "glass-side-solid", 4.5],
  ["accent", "wash-ivory", 4.5],
  ["accent", "wash-cream", 4.5],
  ["accent", "wash-sage", 4.5],
  ["accent", "wash-slate", 4.5],
  ["accent", "glass-side-solid", 4.5],
];

describe.each([
  ["light", light],
  ["dark", dark],
  ["sepia", themes.sepia],
])("%s theme colour tokens", (_name, tokens) => {
  it.each(pairs)("%s on %s reaches %s:1", (fg, bg, min) => {
    expect(tokens[fg], `missing --${fg}`).toBeDefined();
    expect(tokens[bg], `missing --${bg}`).toBeDefined();
    expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});

// M21: the reading calendar's shades go from no reading (--paper-sunken) to --heat-4, each step
// further from the page than the one before, and each one visibly different from its neighbour.
describe.each([
  ["light", light],
  ["dark", dark],
  ["sepia", themes.sepia],
])("%s reading calendar shades", (_name, tokens) => {
  const steps = ["paper-sunken", "heat-1", "heat-2", "heat-3", "heat-4"];
  it("each step stands further from the page than the one before", () => {
    const fromPaper = steps.map((s) => contrastRatio(tokens[s], tokens.paper));
    expect(fromPaper).toEqual([...fromPaper].sort((a, b) => a - b));
  });
  it.each(steps.slice(1).map((s, i) => [steps[i], s]))("%s and %s differ by 1.1:1 or more", (a, b) => {
    expect(contrastRatio(tokens[a], tokens[b])).toBeGreaterThanOrEqual(1.1);
  });
});

describe("prototype palette", () => {
  it("keeps the agreed core colours", () => {
    expect([light.paper, light["ink-900"], light.accent]).toEqual(["#f3ede1", "#243239", "#376963"]);
    expect([dark.paper, dark["ink-900"], dark.accent]).toEqual(["#1b282f", "#e7ddc9", "#6b9f95"]);
  });
});

describe("explicit reader themes", () => {
  // Highlight colours (--mark-*) are shared by every theme, so themes do not repeat them.
  const themed = (t: Record<string, string>) => Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith("mark-")));

  it("Paper and Night repeat the light and dark values exactly", () => {
    expect(themes.paper).toEqual(themed(light));
    expect(themes.night).toEqual(themed(dark));
  });

  it("Sepia defines every colour the other themes do", () => {
    expect(Object.keys(themes.sepia).sort()).toEqual(Object.keys(themed(light)).sort());
  });
});

describe("reading surfaces stay on solid paper", () => {
  const block = (css: string, selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };
  const reader = readFileSync(new URL("../app/(reader)/books/[id]/read/reader.module.css", import.meta.url), "utf8");

  it.each([".reader", ".rewritten", ".panel", ".listenBar"])("%s is opaque paper, not glass", (selector) => {
    const rule = block(reader, selector);
    expect(rule).toMatch(/background-color: var\(--paper/);
    expect(rule).not.toMatch(/background-color: var\(--glass/);
    expect(rule).not.toContain("backdrop-filter");
  });

  it("a note on the book page and on Home sits on solid paper", () => {
    const book = readFileSync(new URL("../app/(app)/books/[id]/page.module.css", import.meta.url), "utf8");
    const home = readFileSync(new URL("../components/home/Home.module.css", import.meta.url), "utf8");
    for (const rule of [block(book, ".note"), block(book, ".description"), block(home, ".note")]) {
      expect(rule).toContain("background-color: var(--paper);");
      expect(rule).not.toContain("backdrop-filter");
    }
  });
});
