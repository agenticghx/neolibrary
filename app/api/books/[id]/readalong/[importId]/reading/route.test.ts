import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite, type PublicUser } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { getSections } from "@/lib/library/sections-store";
import { buildPackage } from "@/lib/readalong/fixture";
import { startImport } from "@/lib/readalong/importer";
import { MemoryStorage } from "@/lib/storage";
import { GET } from "./route";

// The parts of an uploaded audiobook's paragraphs, as the Listen bar asks for them: from a place on (M13 (d)), or just
// before a place (M14: going back from where the reading began). These call the route's real handler; only who is
// signed in and the database (a fresh test one) come from the test.
const at = vi.hoisted(() => ({ user: null as PublicUser | null, database: null as Database | null }));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => at.user }));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: async () => at.database!.db }));

const JEKYLL = new Uint8Array(readFileSync(new URL("../../../../../../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));

let owner: PublicUser;
let reader: PublicUser;
let bookId: string;
let importId: string;
/** The book's paragraphs in reading order; the audiobook reads 5 to 9. */
let ps: { id: string; position: number }[];

beforeEach(async () => {
  at.database = await testDatabase();
  const db = at.database.db;
  const storage = new MemoryStorage();
  owner = await createFirstAdmin(db, { email: "o@example.com", name: "O", password: "long enough pw" });
  const { token } = await createInvite(db, owner);
  reader = await acceptInvite(db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
  bookId = (await importBook(db, storage, owner.id, { name: "jh.epub", bytes: JEKYLL })).bookId;
  const all = (await getSections(db, owner.id, bookId)).filter((s) => s.kind === "paragraph");
  ps = all;
  const { zip } = buildPackage({ bookBytes: JEKYLL, chapters: [{ title: "Five", paragraphs: all.slice(5, 10).map((p) => p.text), inBook: all.slice(5, 10).map((p) => p.chapterIndex) }] });
  const imp = await startImport(db, storage, owner.id, bookId, zip());
  expect(imp.status).toBe("ready");
  importId = imp.id;
});
afterEach(async () => {
  at.user = null;
  await at.database!.raw.close();
});

const get = (query: string) => GET(new Request(`http://localhost/api/books/${bookId}/readalong/${importId}/reading?${query}`), { params: Promise.resolve({ id: bookId, importId }) });
const ids = async (res: Response) => ((await res.json()).paragraphs as { sectionId: string }[]).map((p) => p.sectionId);

describe("GET …/readalong/[importId]/reading", () => {
  it("?before=<position> answers the part just before it, in reading order, and where the part before that ends", async () => {
    at.user = owner;
    const res = await get(`before=${ps[8].position}`);
    expect(res.status).toBe(200);
    const body = await res.clone().json();
    expect(await ids(res)).toEqual([5, 6, 7].map((i) => ps[i].id));
    expect(body.earlier).toBeNull();
    expect(body).not.toHaveProperty("more");
    // ?from=<position> is as before: from there on, and where the next part starts.
    const from = await get(`from=${ps[8].position}`);
    expect(from.status).toBe(200);
    expect((await from.clone().json()).more).toBeNull();
    expect(await ids(from)).toEqual([8, 9].map((i) => ps[i].id));
  });

  it("refuses both at once, and a place that is not a whole number from 0 (400)", async () => {
    at.user = owner;
    for (const q of [`from=0&before=${ps[8].position}`, "before=-1", "before=1.5", "before=x", "from=-1"]) {
      const res = await get(q);
      expect(res.status, q).toBe(400);
      expect((await res.json()).error, q).toBe("Say where to start: ?from=<position>, or where to end: ?before=<position>.");
    }
  });

  it("answers no one signed out (401), and nothing of another reader's audiobook (404)", async () => {
    expect((await get(`before=${ps[8].position}`)).status).toBe(401);
    at.user = reader;
    expect((await get(`before=${ps[8].position}`)).status).toBe(404);
    expect((await get(`from=${ps[5].position}`)).status).toBe(404);
  });
});
