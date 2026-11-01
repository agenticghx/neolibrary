import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { MemoryStorage } from "@/lib/storage";
import { AgentError, agentBook, agentBookFile, agentXray } from "./library";

// M40 S4: what checks run with the owner's token can read (Samuel 2026-11-01: sessions take over the gates).
let database: Database;
let ownerId: string;
let otherId: string;
let jekyll: string;
let scan: string;
let textPdf: string;

const load = (f: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${f}`, import.meta.url)));
const notFound = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AgentError);
  expect((e as AgentError).status).toBe(404);
};

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const { token } = await createInvite(database.db, { id: ownerId, email: "o@example.com", name: "O", role: "admin" });
  otherId = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
  const storage = new MemoryStorage();
  jekyll = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: load("stevenson-jekyll-and-hyde.epub") })).bookId;
  scan = (await importBook(database.db, storage, ownerId, { name: "scanned-meditation.pdf", bytes: load("scanned-meditation.pdf") })).bookId;
  textPdf = (await importBook(database.db, storage, ownerId, { name: "descartes.pdf", bytes: load("descartes-meditation-one.pdf") })).bookId;
});
afterEach(() => database.raw.close());

describe("a book in detail, for the owner's token (M40 S4)", () => {
  it("says what kind of file each book has, and tells a scan from a PDF with text of its own", async () => {
    expect(await agentBook(database.db, ownerId, jekyll)).toMatchObject({ id: jekyll, kind: "epub", scan: false, textEdition: null, editionOf: null });
    expect(await agentBook(database.db, ownerId, scan)).toMatchObject({ kind: "pdf", scan: true, textEdition: null });
    expect(await agentBook(database.db, ownerId, textPdf)).toMatchObject({ kind: "pdf", scan: false });
    const one = await agentBook(database.db, ownerId, jekyll);
    expect(one.cover).toEqual(expect.objectContaining({ has: expect.any(Boolean) }));
    expect(one.pages === null || typeof one.pages === "number").toBe(true);
  });

  it("links a scan and its text edition both ways, and finds the edition though the shelf hides it", async () => {
    const [edition] = await database.db
      .insert(books)
      .values({ ownerId, title: "Scanned (text edition)", fileKey: "k/edition.epub", fileType: "epub", editionOf: scan })
      .returning({ id: books.id });
    expect((await agentBook(database.db, ownerId, scan)).textEdition).toBe(edition.id);
    expect(await agentBook(database.db, ownerId, edition.id)).toMatchObject({ editionOf: scan, scan: false, kind: "epub" });
  });

  it("never shows another reader's book, a malformed id, or a title with no file yet", async () => {
    await notFound(agentBook(database.db, otherId, jekyll));
    await notFound(agentBook(database.db, ownerId, "not-an-id"));
    await notFound(agentBookFile(database.db, otherId, scan));
    const [wanted] = await database.db.insert(books).values({ ownerId, title: "Wanted, no file" }).returning({ id: books.id });
    await notFound(agentBookFile(database.db, ownerId, wanted.id));
    expect(await agentBook(database.db, ownerId, wanted.id)).toMatchObject({ kind: null, scan: false });
  });

  it("gives the owner's token a book's file: its stored key and kind", async () => {
    const file = await agentBookFile(database.db, ownerId, scan);
    expect(file.type).toBe("pdf");
    expect(file.key).toBeTruthy();
    expect(file.name).toMatch(/\.pdf$/);
  });

  it("lists a book's whole X-ray, most mentioned first, only for its owner", async () => {
    const entries = await agentXray(database.db, ownerId, jekyll);
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.map((e) => e.name)).toContain("Mr. Utterson");
    for (let i = 1; i < entries.length; i++) expect(entries[i - 1].mentions).toBeGreaterThanOrEqual(entries[i].mentions);
    expect(entries[0]).toEqual(expect.objectContaining({ kind: expect.any(String), aliases: expect.any(Array), facts: expect.any(Array) }));
    await notFound(agentXray(database.db, otherId, jekyll));
  });
});
