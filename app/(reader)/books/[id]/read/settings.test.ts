import { afterEach, describe, expect, it } from "vitest";
import { bookCss, DEFAULT_SETTINGS, loadSettings, saveSettings, WIDTH_SIZE, withWidth } from "./settings";

/** A stand-in for the browser's localStorage (this test runs in Node). */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("reading settings on this device", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("opens on one page when nothing is saved", () => {
    globalThis.localStorage = memoryStorage();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings().pages).toBe("one");
  });

  it("keeps two pages for the next book, and ignores a value it does not know", () => {
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    saveSettings({ ...DEFAULT_SETTINGS, pages: "two", size: 120 });
    expect(loadSettings().pages).toBe("two");
    expect(loadSettings().size).toBe(120);
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ pages: "spread", flow: "nope" }));
    expect(loadSettings().pages).toBe("one");
    expect(loadSettings().flow).toBe("paginated");
  });

  it("dims PDF pages at night unless turned off, including for settings saved before the switch existed (M19)", () => {
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    expect(DEFAULT_SETTINGS.dimPdf).toBe(true);
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ pages: "two", theme: "night" }));
    expect(loadSettings().dimPdf).toBe(true);
    saveSettings({ ...DEFAULT_SETTINGS, dimPdf: false });
    expect(loadSettings().dimPdf).toBe(false);
    saveSettings({ ...DEFAULT_SETTINGS, dimPdf: true });
    expect(loadSettings().dimPdf).toBe(true);
  });

  it("opens with Focus off, including for settings saved before Focus existed, and keeps a choice (M21)", () => {
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    expect(DEFAULT_SETTINGS.focus).toBe("off");
    // Saved by an earlier version of the reader: every other choice is kept, Focus is off.
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ flow: "scrolled", pages: "two", size: 120, theme: "sepia", dimPdf: false }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, flow: "scrolled", pages: "two", size: 120, theme: "sepia", dimPdf: false, focus: "off" });
    for (const focus of ["ruler", "paragraph", "off"] as const) {
      saveSettings({ ...DEFAULT_SETTINGS, focus });
      expect(loadSettings().focus).toBe(focus);
    }
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ focus: "spotlight" }));
    expect(loadSettings().focus).toBe("off");
  });

  it("keeps North Window, Private Press and Calfskin, and ignores a theme it does not know", () => {
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    for (const theme of ["north", "press", "calfskin"] as const) {
      storage.setItem("neolibrary.reader.v1", JSON.stringify({ theme }));
      expect(loadSettings().theme).toBe(theme);
    }
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ theme: "velvet" }));
    expect(loadSettings().theme).toBe("auto");
  });

  it("keeps a table inside the reading column, clipped (not scrolled, so it can run across pages), so it never covers the text beside it", () => {
    const css = bookCss(DEFAULT_SETTINGS, { paper: "#fff", ink: "#000", accent: "#00f", highlight: "#ff0", spoken: "#0f0", scheme: "light" }, "https://example.org");
    expect(css).toContain("table { display: block; width: max-content; max-width: 100%; overflow-x: clip; }");
    // M41: a row is never split across pages, a caption keeps to its table, and a clipped table says so.
    expect(css).toContain("tr { break-inside: avoid; }");
    expect(css).toContain("p:has(+ table) { break-after: avoid; }");
    expect(css).toMatch(/table\[data-nl-wide\]::before \{\s*content: "Wider than the page \\2014  tap to see the whole table";/);
  });

  it("sets formulas in the bundled math font whatever the reading face, so brackets stretch (M41)", () => {
    for (const face of ["serif", "sans", "book"] as const) {
      const css = bookCss({ ...DEFAULT_SETTINGS, face }, { paper: "#fff", ink: "#000", accent: "#00f", highlight: "#ff0", spoken: "#0f0", scheme: "light" }, "https://example.org");
      expect(css).toContain('@font-face { font-family: "NL Math"; src: url("https://example.org/fonts/stix-two-math.woff2") format("woff2");');
      expect(css).toContain('math { font-family: "NL Math", math !important; }');
    }
  });

  it("styles a book page for Focus: dimmed text in the theme's own ink, and no added hyphens while it is on (M21)", () => {
    const colors = { paper: "#f3ede1", ink: "#243239", accent: "#376963", highlight: "#cfe0d8", spoken: "#9cc4b6", scheme: "light" };
    const off = bookCss(DEFAULT_SETTINGS, colors, "https://example.org");
    const ruler = bookCss({ ...DEFAULT_SETTINGS, focus: "ruler" }, colors, "https://example.org");
    expect(off).toContain("hyphens: auto;");
    expect(off).not.toContain("hyphens: manual");
    expect(ruler).toContain("hyphens: manual !important");
    for (const css of [off, ruler]) {
      expect(css).toContain("::highlight(nl-dim) { color: color-mix(in srgb, #243239 45%, #f3ede1); }");
      // The ruler's band is the reader's (Reader.module.css), drawn over the book: none is put in the page.
      expect(css).not.toContain("data-nl-ruler");
    }
  });
});

describe("Width and Justify (M27 Q3)", () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("makes the text bigger on a wider width, keeps each width's size, and brings it back", () => {
    const mine = { ...DEFAULT_SETTINGS, size: 110 };
    const full = withWidth(mine, "full");
    expect(full).toMatchObject({ width: "full", size: WIDTH_SIZE.full });
    // Made smaller in Full, then back to Comfortable and to Full again: each width's own size returns.
    const back = withWidth({ ...full, size: 120 }, "comfortable");
    expect(back.size).toBe(110);
    expect(withWidth(back, "full").size).toBe(120);
    expect(withWidth(back, "wide").size).toBe(WIDTH_SIZE.wide);
    expect(withWidth(back, "comfortable")).toBe(back);
  });

  it("starts Comfortable and unjustified, including for settings saved before Width existed, and keeps a choice", () => {
    const storage = memoryStorage();
    globalThis.localStorage = storage;
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ size: 120 }));
    expect(loadSettings()).toMatchObject({ width: "comfortable", sizes: {}, justify: false, size: 120 });
    saveSettings({ ...withWidth({ ...DEFAULT_SETTINGS, size: 110 }, "wide"), justify: true });
    expect(loadSettings()).toMatchObject({ width: "wide", size: WIDTH_SIZE.wide, sizes: { comfortable: 110 }, justify: true });
    storage.setItem("neolibrary.reader.v1", JSON.stringify({ width: "huge", sizes: { wide: 999, full: 150 } }));
    expect(loadSettings()).toMatchObject({ width: "comfortable", sizes: { full: 150 } });
  });

  it("justifies paragraphs only when asked", () => {
    const colors = { paper: "#fff", ink: "#000", accent: "#00f", highlight: "#ff0", spoken: "#0f0", scheme: "light" };
    expect(bookCss(DEFAULT_SETTINGS, colors, "https://x.example")).not.toContain("text-align: justify");
    expect(bookCss({ ...DEFAULT_SETTINGS, justify: true }, colors, "https://x.example")).toContain("p, li, dd, blockquote { text-align: justify; }");
  });
});
