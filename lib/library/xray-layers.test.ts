import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { resetSpendHoldsForTests } from "@/lib/ai/generate";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { setStyle } from "./ai-style";
import { importBook } from "./import";
import { getSections } from "./sections-store";
import { listXray } from "./xray";
import { askWorld, entryOf, libraryLinks, storedWorld } from "./xray-layers";

let database: Database;
let ownerId: string;
let jekyll: string;
let frankenstein: string;

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));

beforeEach(async () => {
  database = await testDatabase();
  resetSpendHoldsForTests();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const storage = new MemoryStorage();
  jekyll = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: fixture("stevenson-jekyll-and-hyde.epub") })).bookId;
  frankenstein = (await importBook(database.db, storage, ownerId, { name: "f.epub", bytes: fixture("shelley-frankenstein.epub") })).bookId;
  await setStyle(database.db, ownerId, jekyll, { scope: "all", style: "plain" });
});
afterEach(() => database.raw.close());

describe("a name's outer layers (M32 X4)", () => {
  it("finds the same name in the reader's other books, with a link to where it first appears there", async () => {
    const list = await listXray(database.db, ownerId, jekyll, null);
    const london = list.entries.find((e) => e.aliases.includes("London"))!;
    const links = await libraryLinks(database.db, ownerId, jekyll, london);
    expect(links.length).toBe(1);
    expect(links[0]).toMatchObject({ bookId: frankenstein, title: "Frankenstein", name: "London" });
    expect(links[0].mentions).toBeGreaterThan(0);
    const sections = await getSections(database.db, ownerId, frankenstein);
    expect(sections.find((s) => s.cfi === links[0].cfi)?.kind).toBe("paragraph");
    // A name only this book has links nowhere; another reader's books never show.
    const utterson = list.entries.find((e) => e.aliases.includes("Utterson"))!;
    expect(await libraryLinks(database.db, ownerId, jekyll, utterson)).toEqual([]);
    const other = (await createFirstAdmin(database.db, { email: "p@example.com", name: "P", password: "long enough pw" }).catch(() => null))?.id;
    if (other) await expect(entryOf(database.db, other, jekyll, london.id)).rejects.toThrow("That name was not found.");
    await expect(entryOf(database.db, ownerId, jekyll, "x-000000000000")).rejects.toThrow("That name was not found.");
  });

  it("asks once what the world knows of a name, stores it with provenance, re-serves it, and keeps it per style", async () => {
    const model = new FakeModel();
    const list = await listXray(database.db, ownerId, jekyll, null);
    const soho = list.entries.find((e) => e.aliases.includes("Soho"))!;
    expect(await storedWorld(database.db, ownerId, jekyll, soho)).toBeNull();
    const first = await askWorld(database.db, model, ownerId, jekyll, soho);
    expect(first.reused).toBe(false);
    expect(first.world.text).toContain("The test AI's general knowledge of Soho");
    expect(first.world.provenance.model).toBe("fake");
    expect(model.calls[0].prompt).toContain("Task: From the world");
    expect(model.calls[0].prompt).toContain("Name: Soho (not yet classified)");
    expect(model.calls[0].system).toContain("Never say how the book's story goes");
    expect(model.calls[0].system).toContain("plain, precise English");
    const again = await askWorld(database.db, model, ownerId, jekyll, soho);
    expect(again.reused).toBe(true);
    expect(model.calls.length).toBe(1);
    expect((await storedWorld(database.db, ownerId, jekyll, soho))?.text).toBe(first.world.text);
    // Another style is another note; switching back finds the first.
    await setStyle(database.db, ownerId, jekyll, { scope: "all", style: "ste-standard" });
    expect(await storedWorld(database.db, ownerId, jekyll, soho)).toBeNull();
    await askWorld(database.db, model, ownerId, jekyll, soho);
    expect(model.calls.length).toBe(2);
    await setStyle(database.db, ownerId, jekyll, { scope: "all", style: "plain" });
    expect((await storedWorld(database.db, ownerId, jekyll, soho))?.text).toBe(first.world.text);
  });
});
