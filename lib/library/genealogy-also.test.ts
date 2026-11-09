import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { parseEpub } from "./ebook";
import { genealogyElsewhere } from "./genealogy-also";
import { genealogyPromptHash, saveGenealogy, type SentLink } from "./genealogy-store";
import { importBook } from "./import";
import { extractSections } from "./sections";

let database: Database;
let ownerId: string;
const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${name}`, import.meta.url)));
const paragraphOf = (bytes: Uint8Array) => extractSections(bytes, parseEpub(bytes).toc as { label: string; href: string }[]).find((s) => s.kind === "paragraph" && s.text.length > 200)!;
const link = (p: { id: string; text: string }, from: string, fromKind: "person" | "organisation", relation: string, to: string, toKind: "person" | "organisation"): SentLink => ({
  from,
  from_kind: fromKind,
  to,
  to_kind: toKind,
  relation,
  paragraph: p.id,
  quote: p.text.split(" ").slice(0, 8).join(" "),
  check: "holds",
});
async function book(name: string, links: (p: { id: string; text: string }) => SentLink[], owner = ownerId) {
  const bytes = file(name);
  const { bookId } = await importBook(database.db, new MemoryStorage(), owner, { name, bytes });
  await saveGenealogy(database.db, owner, bookId, { model: "claude-sonnet-5-5", promptHash: await genealogyPromptHash(), links: links(paragraphOf(bytes)), lives: {} });
  return bookId;
}

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

describe('"Also in <book>" (M43)', () => {
  it("finds the name in the reader's other books, under what each calls it, most linked first; not in the book itself, nor in removed links", async () => {
    const jekyll = await book("stevenson-jekyll-and-hyde.epub", (p) => [link(p, "Robert Noyce", "person", "founded", "Intel", "organisation")]);
    const machine = await book("wells-the-time-machine.epub", (p) => [
      link(p, "Noyce", "person", "led", "Intel Corporation", "organisation"),
      link(p, "Gordon Moore", "person", "led", "Intel Corporation", "organisation"),
      { ...link(p, "Andy Grove", "person", "led", "Fairchild Semiconductor", "organisation"), removed: true },
    ]);
    const frankenstein = await book("shelley-frankenstein.epub", (p) => [link(p, "Robert Noyce", "person", "worked_at", "Fairchild Semiconductor", "organisation")]);
    expect(await genealogyElsewhere(database.db, ownerId, jekyll, "Robert Noyce", "person")).toEqual([
      expect.objectContaining({ bookId: machine, name: "Noyce", links: 1 }),
      expect.objectContaining({ bookId: frankenstein, name: "Robert Noyce", links: 1 }),
    ]);
    const intel = await genealogyElsewhere(database.db, ownerId, jekyll, "Intel", "organisation");
    expect(intel).toEqual([expect.objectContaining({ bookId: machine, name: "Intel Corporation", links: 2, kind: "organisation", tree: false })]);
    expect(await genealogyElsewhere(database.db, ownerId, machine, "Andy Grove", "person")).toEqual([]); // removed by the second reading
    expect(await genealogyElsewhere(database.db, ownerId, jekyll, "Robert", "person")).toEqual([]); // a first name alone
  });

  it("looks only in the reader's own books", async () => {
    const jekyll = await book("stevenson-jekyll-and-hyde.epub", (p) => [link(p, "Robert Noyce", "person", "founded", "Intel", "organisation")]);
    const owner = { id: ownerId, role: "admin" } as Parameters<typeof createInvite>[1];
    const { token } = await createInvite(database.db, owner);
    const other = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    await book("wells-the-time-machine.epub", (p) => [link(p, "Robert Noyce", "person", "led", "Intel", "organisation")], other);
    expect(await genealogyElsewhere(database.db, ownerId, jekyll, "Robert Noyce", "person")).toEqual([]);
  });
});
