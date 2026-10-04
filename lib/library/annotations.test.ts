import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, deleteAnnotation, history, listAnnotations, updateAnnotation } from "./annotations";
import { importBook } from "./import";
import { getSections } from "./sections-store";

let database: Database;
let ownerId: string;
let bookId: string;
let paras: { id: string; cfi: string; text: string }[];

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "j.epub", bytes })).bookId;
  paras = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
});
afterEach(() => database.raw.close());

/** A range CFI covering the first `n` characters of a paragraph's first text. */
const rangeIn = (p: { cfi: string }, from: number, to: number) => p.cfi.replace(/\)$/, `,/1:${from},/1:${to})`);

describe("annotations", () => {
  it("a highlight remembers its paragraph, CFI and quote with context", async () => {
    const p = paras.find((x) => x.text.startsWith("Mr. Utterson the lawyer"))!;
    const a = await createAnnotation(database.db, ownerId, {
      kind: "highlight",
      bookId,
      cfi: rangeIn(p, 4, 23),
      quote: { exact: "Utterson the lawyer", prefix: "Mr. ", suffix: " was a man of a rugged countenance" },
      color: "amber",
    });
    expect(a).toMatchObject({ kind: "highlight", sectionId: p.id, color: "amber", version: 1, targetType: "passage" });
    expect(a.quote).toEqual({ exact: "Utterson the lawyer", prefix: "Mr. ", suffix: " was a man of a rugged countenance" });
  });

  it("edits add versions and deletes only hide (ground rule 9)", async () => {
    const p = paras[40];
    const a = await createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi: rangeIn(p, 0, 5), quote: { exact: p.text.slice(0, 5) } });
    const t1 = new Date(Date.now() + 1000);
    const b = await updateAnnotation(database.db, ownerId, a.id, { body: "First thought", color: "rose" }, t1);
    expect(b).toMatchObject({ id: a.id, version: 2, body: "First thought", color: "rose", createdAt: a.createdAt });
    await updateAnnotation(database.db, ownerId, a.id, { body: "Second thought" });
    expect((await listAnnotations(database.db, ownerId, bookId))[0]).toMatchObject({ version: 3, body: "Second thought" });

    await deleteAnnotation(database.db, ownerId, a.id);
    expect(await listAnnotations(database.db, ownerId, bookId)).toEqual([]);
    const all = await history(database.db, ownerId, a.id);
    expect(all.map((v) => [v.version, v.body, v.deleted])).toEqual([
      [1, "", false],
      [2, "First thought", false],
      [3, "Second thought", false],
      [4, "Second thought", true],
    ]);
    await expect(updateAnnotation(database.db, ownerId, a.id, { body: "x" })).rejects.toThrow("not found");
  });

  it("lists book notes first, then passages in reading order", async () => {
    const later = await createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi: rangeIn(paras[90], 0, 4), quote: { exact: "x" } });
    const earlier = await createAnnotation(database.db, ownerId, { kind: "bookmark", bookId, cfi: paras[10].cfi, quote: { exact: paras[10].text.slice(0, 40) } });
    const note = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "Read this alongside Chip War." });
    expect((await listAnnotations(database.db, ownerId, bookId)).map((a) => a.id)).toEqual([note.id, earlier.id, later.id]);
    expect(note).toMatchObject({ targetType: "book", cfi: null });
  });

  it("refuses bad input and other people's books", async () => {
    await expect(createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi: "nope", quote: { exact: "x" } })).rejects.toThrow("not a place");
    await expect(createAnnotation(database.db, ownerId, { kind: "highlight", bookId, cfi: paras[0].cfi, quote: { exact: "" } })).rejects.toThrow("Select some text");
    await expect(createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "  " })).rejects.toThrow("Write something");
    await expect(createAnnotation(database.db, ownerId, { kind: "doodle", bookId })).rejects.toThrow("Unknown kind");

    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    await expect(createAnnotation(database.db, other.id, { kind: "note", bookId, body: "hi" })).rejects.toThrow("Book not found");
    const mine = await createAnnotation(database.db, ownerId, { kind: "note", bookId, body: "mine" });
    await expect(updateAnnotation(database.db, other.id, mine.id, { body: "theirs" })).rejects.toThrow("not found");
    await expect(deleteAnnotation(database.db, other.id, mine.id)).rejects.toThrow("not found");
    expect(await listAnnotations(database.db, other.id)).toEqual([]);
  });
});

describe("notes on paths and pillars", () => {
  it("attach to your own path or pillar, and are listed per target", async () => {
    const { seedPath, getPathView } = await import("./paths");
    const { hiddenMachinery } = await import("@/data/paths/hidden-machinery");
    const { notesForPath } = await import("./annotations");
    await seedPath(database.db, ownerId, hiddenMachinery);
    const view = (await getPathView(database.db, ownerId, "hidden-machinery"))!;
    const semis = view.pillars.find((p) => p.slug === "semiconductors")!;
    const onPillar = await createAnnotation(database.db, ownerId, { kind: "note", targetType: "pillar", targetId: semis.id, body: "Pair with a fab tour." });
    const onPath = await createAnnotation(database.db, ownerId, { kind: "note", targetType: "path", targetId: view.id, body: "One pillar a month." });
    expect(onPillar).toMatchObject({ targetType: "pillar", targetId: semis.id, bookId: null, cfi: null });
    const notes = await notesForPath(database.db, ownerId, view.id);
    expect(notes.get(semis.id)!.map((n) => n.body)).toEqual(["Pair with a fab tour."]);
    expect(notes.get(view.id)!.map((n) => n.body)).toEqual(["One pillar a month."]);
    await deleteAnnotation(database.db, ownerId, onPath.id);
    expect((await notesForPath(database.db, ownerId, view.id)).get(view.id)).toBeUndefined();

    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r2@example.com", name: "R", password: "long enough pw" });
    await expect(createAnnotation(database.db, other.id, { kind: "note", targetType: "pillar", targetId: semis.id, body: "x" })).rejects.toThrow("Not found");
  });
});
