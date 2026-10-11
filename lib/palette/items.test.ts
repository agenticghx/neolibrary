import { describe, expect, it } from "vitest";
import type { PaletteData } from "./data";
import { buildItems, results } from "./items";

const data: PaletteData = {
  books: [
    { id: "b1", title: "Frankenstein", author: "Mary Shelley", hasFile: true, openedAt: "2026-10-01T10:00:00.000Z" },
    { id: "b2", title: "The Time Machine", author: "H. G. Wells", hasFile: true, openedAt: "2026-10-05T10:00:00.000Z" },
    { id: "b3", title: "The Grid", author: "Gretchen Bakke", hasFile: false, openedAt: null },
  ],
  paths: [{ slug: "hidden-machinery", title: "Hidden Machinery", pillars: [{ slug: "energy", title: "Energy and the grid", anchor: "p-energy" }] }],
  notes: [{ id: "n1", bookId: "b2", cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)", text: "The Time Traveller smiled round at us.", kind: "highlight" }],
};

describe("buildItems", () => {
  it("lists admin pages for an admin only", () => {
    const labels = (admin: boolean) => buildItems(null, admin).map((i) => i.label);
    expect(labels(false)).not.toContain("Invite people");
    expect(labels(false)).not.toContain("Spending");
    expect(labels(true)).toEqual(expect.arrayContaining(["Invite people", "Spending", "Agent access", "Your data", "Reading stats"]));
  });

  it("links each kind to its place", () => {
    const byKey = new Map(buildItems(data, false).map((i) => [i.key, i]));
    expect(byKey.get("book:b3")?.href).toBe("/books/b3");
    expect(byKey.get("read:b2")?.href).toBe("/books/b2/read");
    // No file, nothing to open in the reader.
    expect(byKey.has("read:b3")).toBe(false);
    expect(byKey.get("path:hidden-machinery")?.href).toBe("/paths/hidden-machinery");
    expect(byKey.get("pillar:hidden-machinery:energy")?.href).toBe("/paths/hidden-machinery#p-energy");
    expect(byKey.get("note:n1")).toMatchObject({ href: `/books/b2/read?at=${encodeURIComponent("epubcfi(/6/4!/4/2,/1:0,/1:5)")}`, detail: "The Time Machine", tag: "Highlight" });
  });
});

describe("results", () => {
  const items = buildItems(data, false);

  it("with nothing typed: books read lately first (newest first), then pages, notes and Paths", () => {
    const list = results(items, data, " ");
    expect(list.slice(0, 2).map((i) => i.key)).toEqual(["read:b2", "read:b1"]);
    expect(list[2].label).toBe("Home");
    expect(list.map((i) => i.kind)).toContain("note");
    expect(list.at(-1)?.key).toBe("path:hidden-machinery");
    expect(list.some((i) => i.kind === "search")).toBe(false);
  });

  it("a book's own row comes before its Read row, and the search action is last", () => {
    const list = results(items, data, "time mach");
    expect(list[0].key).toBe("book:b2");
    expect(list[1].key).toBe("read:b2");
    expect(list.at(-1)).toMatchObject({ kind: "search", label: "Search the library for “time mach”", href: "/search?q=time%20mach" });
  });

  it("finds pages by other words, notes by their text, sections by title", () => {
    expect(results(items, data, "export")[0].label).toBe("Your data");
    expect(results(items, data, "traveller")[0].key).toBe("note:n1");
    expect(results(items, data, "energy")[0].key).toBe("pillar:hidden-machinery:energy");
    // Nothing matches: only the search action.
    expect(results(items, data, "zzqx").map((i) => i.kind)).toEqual(["search"]);
  });
});
