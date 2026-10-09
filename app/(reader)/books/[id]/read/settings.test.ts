import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

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
});
