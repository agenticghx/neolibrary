import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeBatchModel } from "@/lib/ai/batch";
import { acceptInvite, createFirstAdmin, createInvite, type PublicUser } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { forgetTextEditionsForTests, OWNER_ONLY } from "@/lib/library/text-edition";
import { MemoryStorage } from "@/lib/storage";
import { DELETE, GET, POST } from "./route";

// M25: a scanned PDF's text edition is for the library's owner only, for now (PROGRESS.md Open unknowns row 23).
// These call the route's real handlers; who is signed in, the database, the batch model (the FAKE: no key, no
// network) and the file store come from the test.
const at = vi.hoisted(() => ({
  user: null as PublicUser | null,
  database: null as Database | null,
  model: null as FakeBatchModel | null,
  storage: null as MemoryStorage | null,
}));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => at.user }));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: async () => at.database!.db }));
vi.mock("@/lib/ai", async (original) => ({ ...(await original<typeof import("@/lib/ai")>()), getBatchModel: () => at.model! }));
vi.mock("@/lib/storage", async (original) => ({ ...(await original<typeof import("@/lib/storage")>()), getStorage: async () => at.storage! }));

const SCAN = new Uint8Array(readFileSync(new URL("../../../../../fixtures/books/scanned-meditation.pdf", import.meta.url)));

let admin: PublicUser;
let reader: PublicUser;
let adminBook: string;
let readerBook: string;

beforeEach(async () => {
  at.database = await testDatabase();
  at.storage = new MemoryStorage();
  at.model = new FakeBatchModel({ pollsUntilEnded: 100 });
  const db = at.database.db;
  admin = await createFirstAdmin(db, { email: "o@example.com", name: "O", password: "long enough pw" });
  const { token } = await createInvite(db, admin);
  reader = await acceptInvite(db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
  adminBook = (await importBook(db, at.storage, admin.id, { name: "scan.pdf", bytes: SCAN })).bookId;
  readerBook = (await importBook(db, at.storage, reader.id, { name: "scan.pdf", bytes: SCAN })).bookId;
});
afterEach(async () => {
  at.user = null;
  forgetTextEditionsForTests();
  await at.database!.raw.close();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string) => `http://localhost/api/books/${id}/text-edition`;
const get = (id: string) => GET(new Request(url(id)), params(id));
const post = (id: string, body: unknown) =>
  POST(new Request(url(id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(id));
const stop = (id: string) => DELETE(new Request(url(id), { method: "DELETE" }), params(id));

describe("who may make a text edition", () => {
  it("needs a sign-in, and a real book id", async () => {
    expect((await get(adminBook)).status).toBe(401);
    at.user = admin;
    expect((await get("not-an-id")).status).toBe(404);
  });

  it("is the library's owner only: a reader gets 403 before any book is looked at, and nothing is sent", async () => {
    at.user = reader;
    for (const res of [await get(readerBook), await post(readerBook, { confirm: true }), await get(adminBook)]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: OWNER_ONLY });
    }
    // Stop is never refused (it only saves money): 204, without the figures.
    expect((await stop(readerBook)).status).toBe(204);
    expect(at.model!.batches.size).toBe(0);
  });

  it("finds the owner's own book only", async () => {
    at.user = admin;
    expect((await get(readerBook)).status).toBe(404);
  });
});

describe("starting and stopping", () => {
  it("says what it costs, refuses without the confirm box, starts once, and stops", async () => {
    at.user = admin;
    const before = await (await get(adminBook)).json();
    expect(before).toMatchObject({ pageCount: 2, done: 0, overLimit: null, job: null });

    const refused = await post(adminBook, { confirm: "yes" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/first confirm/);

    const started = await post(adminBook, { confirm: true });
    expect(started.status).toBe(202);
    expect((await started.json()).job).toMatchObject({ status: "preparing" });
    expect((await post(adminBook, { confirm: true })).status).toBe(200);

    const stopped = await stop(adminBook);
    expect(stopped.status).toBe(200);
    expect((await stopped.json()).job).toMatchObject({ stopRequested: true });
  });
});
