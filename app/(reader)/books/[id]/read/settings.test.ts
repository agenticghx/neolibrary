import { afterEach, describe, expect, it } from "vitest";
import { bookCss, DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

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

  it("keeps a table inside the reading column, scrolling sideways, so it never covers the text beside it", () => {
    const css = bookCss(DEFAULT_SETTINGS, { paper: "#fff", ink: "#000", accent: "#00f", highlight: "#ff0", spoken: "#0f0", scheme: "light" }, "https://example.org");
    expect(css).toContain("table { display: block; width: max-content; max-width: 100%; overflow-x: auto; }");
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
      expect(css).toMatch(/\[data-nl-ruler\] \{[^}]*pointer-events: none/);
      expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \[data-nl-ruler\] \{ transition: none !important; \}/);
    }
  });
});
