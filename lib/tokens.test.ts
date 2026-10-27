import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blendOver, contrastRatio, parseColorTokens } from "./contrast";

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
const themes = {
  paper: themeBlock("paper"),
  sepia: themeBlock("sepia"),
  night: themeBlock("night"),
  north: themeBlock("north"),
  press: themeBlock("press"),
  calfskin: themeBlock("calfskin"),
};

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
];

describe.each([
  ["light", light],
  ["dark", dark],
  ["sepia", themes.sepia],
  ["north", themes.north],
  ["press", themes.press],
  ["calfskin", themes.calfskin],
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
  ["north", themes.north],
  ["press", themes.press],
  ["calfskin", themes.calfskin],
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

  it.each(["sepia", "north", "press", "calfskin"] as const)("%s defines every colour the other themes do", (name) => {
    expect(Object.keys(themes[name]).sort()).toEqual(Object.keys(themed(light)).sort());
  });

  it("North Window, Private Press and Calfskin are not recolours of Paper or Sepia", () => {
    for (const name of ["north", "press", "calfskin"] as const) {
      expect(themes[name].paper).not.toBe(themes.paper.paper);
      expect(themes[name].paper).not.toBe(themes.sepia.paper);
      expect(themes[name].accent).not.toBe(themes.paper.accent);
      expect(themes[name].accent).not.toBe(themes.sepia.accent);
    }
  });
});

// The room and its glass (M24; docs/glass-redo-plan.md, Step 1 rules). The room is one screen tall:
// only page headers sit on its dark band, so the band needs main ink only; everything below the
// band must carry every text colour. Glass colours carry an alpha: never pass one to contrastRatio
// directly (hexToRgb ignores alpha); blend it over what is behind it first, as the screen does.
describe.each([
  ["light", light],
  ["dark", dark],
  ["sepia", themes.sepia],
  ["north", themes.north],
  ["press", themes.press],
  ["calfskin", themes.calfskin],
])("%s room and glass", (_name, tokens) => {
  const band = ["room-1", "room-2"];
  const body = ["room-3", "room-base"];
  const shapes = ["room-sage", "room-glow"];
  const behind = [...band, ...body];
  // Everything below the band, including the soft shapes painted over it.
  const below = [...body.map((b) => tokens[b]), ...shapes.flatMap((s) => body.map((b) => blendOver(tokens[s], tokens[b])))];

  it.each(behind)("main ink is readable on %s", (stop) => {
    expect(contrastRatio(tokens["ink-900"], tokens[stop])).toBeGreaterThanOrEqual(4.5);
  });

  // The band's lighter half (from 15% of the first screen) holds intro text that wraps down from the header.
  it("secondary ink is readable from the band's lighter half down", () => {
    expect(contrastRatio(tokens["ink-700"], tokens["room-2"])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["ink-700", "ink-500", "accent"])("%s is readable everywhere below the band", (fg) => {
    for (const surface of below) expect(contrastRatio(tokens[fg], surface), surface).toBeGreaterThanOrEqual(4.5);
  });

  it.each(behind)("a card over %s reads like paper", (stop) => {
    const card = blendOver(tokens.panel, tokens[stop]);
    expect(contrastRatio(tokens["ink-900"], card)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(tokens["ink-700"], card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["ink-500"], card)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(behind)("the sidebar's glass over %s keeps its labels readable", (stop) => {
    const rail = blendOver(tokens.rail, tokens[stop]);
    const current = blendOver(tokens["nav-current"], rail);
    expect(contrastRatio(tokens["ink-900"], rail)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["ink-700"], rail)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["ink-900"], current)).toBeGreaterThanOrEqual(4.5);
    // Icons are graphics: 3:1.
    expect(contrastRatio(tokens.accent, current)).toBeGreaterThanOrEqual(3);
  });

  // Covers of every shade pass under the phone tab bar; check its two extremes.
  it.each(["#000000", "#ffffff"])("tab labels stay readable over %s", (under) => {
    const bar = blendOver(tokens.tabbar, under);
    expect(contrastRatio(tokens["ink-900"], bar)).toBeGreaterThanOrEqual(4.5);
  });

  it("the room has real range: its darkest and lightest areas are 1.4:1 apart or more", () => {
    expect(contrastRatio(tokens["room-1"], tokens["room-base"])).toBeGreaterThanOrEqual(1.4);
  });
});

// Ground rule (docs/design.md rule 5, M24): book text, notes, passages and search snippets never sit on glass.
// Pop-up windows, menus and the mini-player are glass too (M24), but they float over anything: a white cover,
// a dark one, a green button. Their quiet grey is --ink-700 there (CI run 38745060800: --ink-500 in the dark
// command palette fell to 4.1:1 over the green Import button), and it must hold over pure white and pure black.
describe.each([
  ["light", light],
  ["dark", dark],
])("%s floating glass", (_name, tokens) => {
  it.each(["#ffffff", "#000000", "accent"])("ink-700 and ink-900 stay readable over %s", (under) => {
    const surface = blendOver(tokens.panel, under === "accent" ? tokens.accent : under);
    expect(contrastRatio(tokens["ink-700"], surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tokens["ink-900"], surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["../components/palette/CommandPalette.module.css", ".panel"],
    ["../app/(app)/covers/page.module.css", ".chooser"],
    ["../components/shell/Shell.module.css", ".popover"],
    ["../components/shell/Shell.module.css", ".sheet"],
    ["../components/player/MiniPlayer.module.css", ".bar"],
    ["../components/player/MiniPlayer.module.css", ".menu"],
    ["../components/player/MiniPlayer.module.css", ".thinkPanel"],
  ])("%s %s turns its quiet grey a step darker", (path, selector) => {
    const css = readFileSync(new URL(path, import.meta.url), "utf8");
    const start = css.search(new RegExp(`(^|\\n)${selector.replace(".", "\\.")} \\{`));
    expect(start, selector).toBeGreaterThanOrEqual(0);
    expect(css.slice(start, css.indexOf("}", start))).toContain("--ink-500: var(--ink-700);");
  });
});

describe("reading surfaces stay on solid paper", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const block = (css: string, selector: string) => {
    const start = css.search(new RegExp(`(^|\\n)${selector.replace(".", "\\.")} \\{`));
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };
  const glass = /var\(--(panel|rail|tabbar)\)|backdrop-filter/;

  it("the reader has no glass at all", () => {
    expect(read("../app/(reader)/books/[id]/read/reader.module.css")).not.toMatch(glass);
  });

  it.each([
    ["../components/home/Home.module.css", ".note"],
    ["../app/(app)/review/page.module.css", ".card"],
    ["../components/PathView.module.css", ".master"],
    ["../app/(app)/search/page.module.css", ".snippet"],
    ["../components/player/MiniPlayer.module.css", ".sentence"],
    ["../components/player/MiniPlayer.module.css", ".thinkQuote"],
  ])("%s %s is paper, not glass", (path, selector) => {
    const rule = block(read(path), selector);
    expect(rule).not.toMatch(glass);
  });

  it("the note inside a Continue card sits on solid paper", () => {
    expect(block(read("../components/home/Home.module.css"), ".note")).toContain("background-color: var(--paper);");
  });

  // The mini-player is glass (M24), so the sentence it reads aloud, and the one a voice note quotes, need their own paper.
  it.each([".sentence", ".thinkQuote"])("the mini-player's %s sits on solid paper inside the glass bar", (selector) => {
    const css = read("../components/player/MiniPlayer.module.css");
    expect(block(css, ".bar")).toContain("background-color: var(--panel);");
    expect(block(css, selector)).toContain("background-color: var(--paper);");
  });
});
