import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite, type PublicUser } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { forgetNarrationsForTests, OWNER_ONLY, runningNarrations } from "@/lib/library/narration";
import { readableEpub } from "@/lib/library/test-epub";
import { FakeSpeech } from "@/lib/speech/fake";
import { MemoryStorage } from "@/lib/storage";
import { DELETE, GET, POST } from "./route";

// Whole-book narration is for the library's owner only, for now (2026-10-07; PROGRESS.md Open unknowns row 13).
// These call the route's real handlers. Only who is signed in, the database, the voice and the file store come from
// the test: a fresh test database, the FAKE voice (Samuel's rule: no paid voice narrates a whole book until he says
// so), and files kept in memory.
const at = vi.hoisted(() => ({
  user: null as PublicUser | null,
  database: null as Database | null,
  voice: null as FakeSpeech | null,
  storage: null as MemoryStorage | null,
}));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => at.user }));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: async () => at.database!.db }));
vi.mock("@/lib/speech", async (original) => ({ ...(await original<typeof import("@/lib/speech")>()), getSpeechModel: () => at.voice! }));
vi.mock("@/lib/storage", async (original) => ({ ...(await original<typeof import("@/lib/storage")>()), getStorage: async () => at.storage! }));

/** A small EPUB of eight different paragraphs. Invented text. */
const SMALL = readableEpub(
  "Eight Lamps",
  [`<h1>The lamps</h1>${Array.from({ length: 8 }, (_, i) => `<p>Lamp ${i + 1} is lit at dusk by the keeper, who walks the length of the quay.</p>`).join("")}`],
  "Iris Wick",
);
const NOT_CONFIRMED = "Nothing was started: first confirm that this makes narration for the entire book, paid up front.";

let admin: PublicUser;
let reader: PublicUser;
let adminBook: string;
let readerBook: string;

beforeEach(async () => {
  at.database = await testDatabase();
  at.storage = new MemoryStorage();
  at.voice = new FakeSpeech();
  const db = at.database.db;
  admin = await createFirstAdmin(db, { email: "o@example.com", name: "O", password: "long enough pw" });
  const { token } = await createInvite(db, admin);
  reader = await acceptInvite(db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
  expect([admin.role, reader.role]).toEqual(["admin", "reader"]);
  // Each has the same EPUB in their own library.
  adminBook = (await importBook(db, at.storage, admin.id, { name: "eight-lamps.epub", bytes: SMALL })).bookId;
  readerBook = (await importBook(db, at.storage, reader.id, { name: "eight-lamps.epub", bytes: SMALL })).bookId;
});
afterEach(async () => {
  at.user = null;
  forgetNarrationsForTests();
  await at.database!.raw.close();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string, voice?: string) => `http://localhost/api/books/${id}/narration${voice ? `?voice=${voice}` : ""}`;
const post = (id: string, body: unknown) =>
  POST(new Request(url(id), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(id));
const get = (id: string, voice?: string) => GET(new Request(url(id, voice)), params(id));
const stop = (id: string, voice: string) => DELETE(new Request(url(id, voice), { method: "DELETE" }), params(id));

describe("POST /api/books/[id]/narration: only the library's owner can start whole-book narration, for now", () => {
  it("refuses a reader you invited (403, with the plain reason), even on her own EPUB with confirm: true; nothing is made", async () => {
    at.user = reader;
    // Her own EPUB, and the owner's: the same answer for every book (nothing about the book is looked at).
    for (const id of [readerBook, adminBook]) {
      const res = await post(id, { voice: "fake-ada", confirm: true });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: OWNER_ONLY });
    }
    expect(OWNER_ONLY).toBe("Whole-book narration is for the library's owner, for now.");
    // GET is refused too: what a run would cost, and what everyone has spent this month, are for deciding to start one.
    const looked = await get(readerBook, "fake-ada");
    expect(looked.status).toBe(403);
    expect(await looked.json()).toEqual({ error: OWNER_ONLY });
    // Stop is never refused to a book's owner (it can only save money); it answers without the figures. Another
    // reader's book is still "not found".
    expect((await stop(readerBook, "fake-ada")).status).toBe(204);
    expect((await stop(adminBook, "fake-ada")).status).toBe(404);
    // Nothing started, and the voice was never asked to speak.
    expect(runningNarrations(reader.id)).toEqual([]);
    expect(at.voice!.calls).toHaveLength(0);
  });

  it("accepts the library's owner (the admin) once confirmed: confirm is still required, and another reader's book is still not found", async () => {
    at.user = admin;
    for (const body of [{ voice: "fake-ada" }, { voice: "fake-ada", confirm: "yes" }, { voice: "fake-ada", confirm: false }]) {
      const res = await post(adminBook, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: NOT_CONFIRMED });
    }
    expect(runningNarrations(admin.id)).toEqual([]);
    expect(at.voice!.calls).toHaveLength(0);
    // The owner-only rule for a book stays: a reader's book is "not found", also for the library's owner.
    for (const res of [await post(readerBook, { voice: "fake-ada", confirm: true }), await get(readerBook, "fake-ada"), await stop(readerBook, "fake-ada")]) {
      expect(res.status).toBe(404);
    }
    // What it involves, before anything is made.
    const before = await get(adminBook, "fake-ada");
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ voice: "fake-ada", paragraphs: 8, saved: 0, running: false });

    // Confirmed: started (202), and it runs to the end with the fake voice.
    const started = await post(adminBook, { voice: "fake-ada", confirm: true });
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ book: { id: adminBook, title: "Eight Lamps" }, voice: "fake-ada", paragraphs: 8 });
    await vi.waitFor(() => expect(runningNarrations(admin.id)).toEqual([]), { timeout: 10_000 });
    const after = await get(adminBook, "fake-ada");
    expect(await after.json()).toMatchObject({ saved: 8, running: false, stoppedBecause: { kind: "finished" } });
    expect(at.voice!.calls).toHaveLength(8);
    // Stop gives the library's owner the figures back (the Import page shows them).
    const stopped = await stop(adminBook, "fake-ada");
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({ saved: 8, running: false });
  });

  it("signed out: 401 for all three, and nothing is made", async () => {
    for (const res of [await post(adminBook, { voice: "fake-ada", confirm: true }), await get(adminBook, "fake-ada"), await stop(adminBook, "fake-ada")]) {
      expect(res.status).toBe(401);
    }
    expect(at.voice!.calls).toHaveLength(0);
  });
});
