import { strToU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { FakePapers } from "@/lib/papers/fake";
import { MemoryStorage } from "@/lib/storage";
import { createAnnotation, listAnnotations } from "./annotations";
import { exportLibrary, importLibrary, wipeLibrary } from "./export";
import { importBook } from "./import";
import { setPaper } from "./papers";
import { readerMayFetch, setPaperSharing } from "./shared-papers";
import { listShelf } from "./shelf";

// Ground rule 7 (export round trip) for M34's open-shelf switch and M41's papers. Invented paper text.
let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let paperId: string;
let ann: string;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "Sam Owner", password: "long enough pw" })).id;
  paperId = (await importBook(database.db, storage, ownerId, { name: "lamplight.md", bytes: strToU8("# Results\n\nSmall print is read faster under a warm lamp.\n") })).bookId;
  const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "Sam Owner", role: "admin" });
  ann = (await acceptInvite(database.db, token, { email: "ann@example.com", name: "ann", password: "long enough pw" })).id;
  await setPaper(database.db, new FakePapers(), ownerId, paperId, "10.5555/12345678");
});
afterEach(() => database.raw.close());

const strip = (e: Awaited<ReturnType<typeof exportLibrary>>) => ({ ...e, exportedAt: "" });
const papersOf = async (who: string) => (await listShelf(database.db, who, { show: "papers" })).map((b) => b.title);
const copyOf = async () => (await database.db.select().from(books).where(and(eq(books.ownerId, ann), eq(books.sharedFrom, paperId))))[0];

describe("library export: papers and the open shelf", () => {
  it("a paper's details, its sharing switch and the open-shelf switch come back", async () => {
    await database.db.update(books).set({ onShelf: false, sharePapers: false }).where(eq(books.id, paperId));
    const [before] = await database.db.select().from(books).where(eq(books.id, paperId));
    expect(before.kind).toBe("paper");
    const file = await exportLibrary(database.db, ownerId);
    await wipeLibrary(database.db, ownerId);
    await importLibrary(database.db, ownerId, JSON.parse(JSON.stringify(file)));
    const [after] = await database.db.select().from(books).where(eq(books.id, paperId));
    const kept = (b: typeof before) => [b.kind, b.authors, b.journal, b.year, b.doi, b.pmid, b.onShelf, b.sharePapers];
    expect(kept(after)).toEqual(kept(before));
    expect(after.onShelf).toBe(false);
    expect(strip(await exportLibrary(database.db, ownerId))).toEqual(strip(file));
  });

  it("an export from before papers still imports: a book, on the shelf", async () => {
    const file = JSON.parse(JSON.stringify(await exportLibrary(database.db, ownerId)));
    for (const b of file.books) for (const k of ["onShelf", "kind", "authors", "journal", "year", "doi", "pmid", "sharePapers"]) delete b[k];
    await wipeLibrary(database.db, ownerId);
    await importLibrary(database.db, ownerId, file);
    const [after] = await database.db.select().from(books).where(eq(books.id, paperId));
    expect([after.kind, after.onShelf, after.authors]).toEqual(["book", true, []]);
  });

  it("an invited reader's export comes back with the shared paper and the notes on it", async () => {
    const copy = await copyOf();
    await createAnnotation(database.db, ann, { kind: "note", bookId: copy.id, body: "Try this at my desk." });
    const file = JSON.parse(JSON.stringify(await exportLibrary(database.db, ann)));
    await wipeLibrary(database.db, ann);
    await importLibrary(database.db, ann, file);
    expect(await papersOf(ann)).toHaveLength(1);
    expect((await listAnnotations(database.db, ann, copy.id)).map((a) => a.body)).toEqual(["Try this at my desk."]);
    expect(await readerMayFetch(database.db, ann, copy.fileKey!, false)).toBe(true);
  });

  it("a copy of a paper no longer shared comes back hidden, and a copy naming another file is refused", async () => {
    const copy = await copyOf();
    const file = JSON.parse(JSON.stringify(await exportLibrary(database.db, ann)));
    // A file that names the shared paper but another of the owner's files: refused whole.
    const other = (await importBook(database.db, storage, ownerId, { name: "private.md", bytes: strToU8("# Private\n\nNot shared.\n") })).bookId;
    const [secret] = await database.db.select().from(books).where(eq(books.id, other));
    const forged = JSON.parse(JSON.stringify(file));
    forged.books[0].file.key = secret.fileKey;
    await wipeLibrary(database.db, ann);
    await expect(importLibrary(database.db, ann, forged)).rejects.toThrow("Nothing was imported.");
    expect(await database.db.select().from(books).where(eq(books.ownerId, ann))).toEqual([]);
    // Sharing off, then the honest file: the copy is there (for its notes) but hidden, and opens no file.
    await setPaperSharing(database.db, ownerId, paperId, false);
    await importLibrary(database.db, ann, file);
    expect(await papersOf(ann)).toEqual([]);
    expect((await copyOf()).deletedAt).not.toBeNull();
    expect(await readerMayFetch(database.db, ann, copy.fileKey!, false)).toBe(false);
  });
});
