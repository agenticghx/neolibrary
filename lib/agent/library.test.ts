import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { loadMigrations, migrateDown } from "@/lib/db/migrate";
import { testDatabase } from "@/lib/db/test-db";
import { fromW3C, toMarkdown, toW3C } from "@/lib/library/annotation-formats";
import { createAnnotation, deleteAnnotation, importAnnotations, listAnnotations } from "@/lib/library/annotations";
import { exportLibrary, importLibrary, wipeLibrary } from "@/lib/library/export";
import { importBook } from "@/lib/library/import";
import { MemoryStorage } from "@/lib/storage";
import { AgentError, agentAddNote, agentBooks, agentNotes, agentSearch, paragraphRange } from "./library";

let database: Database;
let ownerId: string;
let otherId: string;
let jekyll: string;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
  otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
  const load = (f: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${f}`, import.meta.url)));
  const storage = new MemoryStorage();
  jekyll = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: load("stevenson-jekyll-and-hyde.epub") })).bookId;
  await importBook(database.db, storage, ownerId, { name: "tm.epub", bytes: load("wells-the-time-machine.epub") });
});
afterEach(() => database.raw.close());

describe("what an agent can do (M11)", () => {
  it("lists the reader's own books with files, by title, and filters them", async () => {
    expect((await agentBooks(database.db, ownerId)).map((b) => b.title)).toEqual(["The Strange Case of Dr. Jekyll and Mr. Hyde", "The Time Machine"]);
    expect((await agentBooks(database.db, ownerId, "wells")).map((b) => b.title)).toEqual(["The Time Machine"]);
    expect(await agentBooks(database.db, otherId)).toEqual([]);
  });

  it("searches the text with the matches marked, only in the reader's books", async () => {
    const hits = await agentSearch(database.db, ownerId, "Utterson the lawyer", 3);
    expect(hits.length).toBe(3);
    expect(hits[0]).toMatchObject({ bookId: jekyll, bookTitle: "The Strange Case of Dr. Jekyll and Mr. Hyde" });
    expect(hits[0].text).toMatch(/\*\*Utterson\*\*/);
    expect(hits[0].sectionId).toBeTruthy();
    expect(await agentSearch(database.db, otherId, "Utterson")).toEqual([]);
    await expect(agentSearch(database.db, ownerId, "  ")).rejects.toThrow(AgentError);
  });

  it("adds a note on a paragraph from a search result, marked with the agent, and lists it with the reader's notes", async () => {
    const [hit] = await agentSearch(database.db, ownerId, "Utterson the lawyer", 1);
    const note = await agentAddNote(database.db, ownerId, "Claude on my laptop", { bookId: jekyll, text: "Utterson is introduced here.", sectionId: hit.sectionId });
    expect(note).toMatchObject({ kind: "highlight", color: "sky", note: "Utterson is introduced here.", addedByAgent: "Claude on my laptop", sectionId: hit.sectionId });
    expect(note.quote).toContain("Utterson");
    const own = await createAnnotation(database.db, ownerId, { kind: "note", bookId: jekyll, body: "My own note" });
    const book = await agentAddNote(database.db, ownerId, "Claude on my laptop", { bookId: jekyll, text: "A note on the whole book." });
    expect(book).toMatchObject({ kind: "note", quote: "", addedByAgent: "Claude on my laptop" });
    const listed = await agentNotes(database.db, ownerId, jekyll);
    expect(listed.map((n) => [n.note, n.addedByAgent])).toEqual(
      expect.arrayContaining([
        ["Utterson is introduced here.", "Claude on my laptop"],
        ["My own note", null],
        ["A note on the whole book.", "Claude on my laptop"],
      ]),
    );
    // The reader's own list shows the provenance too, and a deleted note is gone for the agent as well.
    expect((await listAnnotations(database.db, ownerId, jekyll)).find((a) => a.id === note.id)?.agent).toBe("Claude on my laptop");
    await deleteAnnotation(database.db, ownerId, own.id);
    expect((await agentNotes(database.db, ownerId, jekyll)).map((n) => n.note)).not.toContain("My own note");
  });

  it("refuses other readers' books, unknown paragraphs and empty notes", async () => {
    await expect(agentNotes(database.db, otherId, jekyll)).rejects.toMatchObject({ status: 404 });
    await expect(agentAddNote(database.db, otherId, "x", { bookId: jekyll, text: "hi" })).rejects.toMatchObject({ status: 404 });
    await expect(agentAddNote(database.db, ownerId, "x", { bookId: "nonsense", text: "hi" })).rejects.toMatchObject({ status: 404 });
    await expect(agentAddNote(database.db, ownerId, "x", { bookId: jekyll, text: "hi", sectionId: "no-such-section" })).rejects.toMatchObject({ status: 404 });
    await expect(agentAddNote(database.db, ownerId, "x", { bookId: jekyll, text: "   " })).rejects.toThrow("Write the note's text.");
    await expect(agentAddNote(database.db, ownerId, "x", { bookId: jekyll, text: "y".repeat(10_001) })).rejects.toThrow("at most");
  });

  it("keeps the agent's name through the library export, Markdown and W3C", async () => {
    const [hit] = await agentSearch(database.db, ownerId, "Utterson the lawyer", 1);
    const note = await agentAddNote(database.db, ownerId, "Claude", { bookId: jekyll, text: "Agent note.", sectionId: hit.sectionId });
    const items = await listAnnotations(database.db, ownerId, jekyll);
    const info = { id: jekyll, title: "Jekyll", author: "Stevenson" };
    expect(toMarkdown(info, items, () => "Chapter")).toContain("Agent note.\n\n(Added by agent: Claude)");
    const w3c = JSON.parse(JSON.stringify(toW3C(info, items)));
    expect(w3c.first.items[0].creator).toEqual({ type: "Software", name: "Claude" });
    expect(fromW3C(w3c)[0].agent).toBe("Claude");

    const before = await exportLibrary(database.db, ownerId);
    expect(before.annotations!.find((a) => a.annotationId === note.id)?.agent).toBe("Claude");
    await wipeLibrary(database.db, ownerId);
    await importLibrary(database.db, ownerId, JSON.parse(JSON.stringify(before)));
    expect((await listAnnotations(database.db, ownerId, jekyll))[0].agent).toBe("Claude");

    // W3C export, then import into a fresh copy: still marked.
    await wipeLibrary(database.db, ownerId);
    const again = (await importBook(database.db, new MemoryStorage(), ownerId, {
      name: "jh.epub",
      bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url))),
    })).bookId;
    await importAnnotations(database.db, ownerId, again, fromW3C(w3c));
    expect((await listAnnotations(database.db, ownerId, again))[0].agent).toBe("Claude");
  });

  it("going back past migration 0019 keeps the provenance in the note's text", async () => {
    await agentAddNote(database.db, ownerId, "Claude", { bookId: jekyll, text: "Agent note." });
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: jekyll, body: "Mine." });
    const ids = (await loadMigrations()).map((m) => m.id);
    await migrateDown(database.raw, ids.length - ids.indexOf("0019_annotation_agent"));
    const bodies = (await database.raw.query<{ body: string }>("SELECT body FROM annotations ORDER BY body")).map((r) => r.body);
    expect(bodies).toEqual(["(Added by agent: Claude) Agent note.", "Mine."]);
  });

  it("turns a paragraph's CFI into a range over the whole paragraph", () => {
    expect(paragraphRange("epubcfi(/6/20!/4/2[chapter-8]/178)")).toBe("epubcfi(/6/20!/4/2[chapter-8],/178/1:0,/179:0)");
    expect(paragraphRange("epubcfi(/6/8!/4/12[p7])")).toBe("epubcfi(/6/8!/4,/12[p7]/1:0,/13:0)");
    expect(paragraphRange("epubcfi(/6/8)")).toBe("epubcfi(/6/8)");
  });
});
