// Replays the path of each finding still recorded in SKILL.md on the real code: lib/reader/note-sender.ts (what the
// reader page does) and lib/outbox.ts, in the pretend browser of lib/reader/outbox-test-kit.ts, whose requests go to
// the library's real note routes on the unit tests' database. Each test passes while its finding is there; when a
// fix lands, the test fails, and the finding's entry in SKILL.md and check.sh must change with it. The fixed
// findings (F1-F4, F6, F8, and F5's and F7's harmful parts) are tested in lib/reader/note-sender.test.ts, which
// `npm test` runs.
// Run: npx vitest run --config .claude/skills/verify-outbox/replay.config.mts
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const the = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/auth/session", () => ({ currentUser: async () => signedIn() }));
vi.mock("@/lib/db", () => ({ getDb: async () => the.db }));

import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { outboxFor } from "@/lib/outbox";
import { noteRequest, noteSender } from "@/lib/reader/note-sender";
import { browser, page, release, resetBrowser, signedIn, until } from "@/lib/reader/outbox-test-kit";
import { MemoryStorage } from "@/lib/storage";

let db: Database;
let A: string;
let B: string;
let bookId: string;

beforeEach(async () => {
  db = await testDatabase();
  the.db = db.db;
  A = (await createFirstAdmin(db.db, { email: "a@example.com", name: "A", password: "long enough pw" })).id;
  const { token } = await createInvite(db.db, { id: A, email: "a@example.com", name: "A", role: "admin" });
  B = (await acceptInvite(db.db, token, { email: "b@example.com", name: "B", password: "long enough pw" })).id;
  const bytes = new Uint8Array(readFileSync(new URL("../../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(db.db, new MemoryStorage(), A, { name: "j.epub", bytes })).bookId;
  resetBrowser();
  browser.who = { id: A };
});
afterEach(() => db.raw.close());

describe("verify-outbox findings still recorded, replayed on the real code", () => {
  it("F5 (OnlyYourSession): a page of A's left open sends A's note with B's sign-in; the library turns it away", async () => {
    const you = page(A, bookId);
    browser.offline = true;
    const a = await you.create({ kind: "note", body: "Written on the train." });
    browser.offline = false;
    browser.who = null; // A signs out in another tab (signOutAction): the open page is not told
    browser.who = { id: B }; // B signs in on the same browser
    await you.sync(); // A's page: flushOutbox(A) sends A's note with B's cookie
    expect(browser.sent.at(-1)).toMatchObject({ method: "POST", as: B, status: 401 }); // the rule: it left with B's sign-in
    expect((await outboxFor(A))[0]).toMatchObject({ id: a.id }); // the harm is gone: it waits, not refused
    expect((await outboxFor(A))[0].refused).toBeUndefined();
  });

  it("F7 (RefusedNotResent): two tabs pass the check before either sends; the second sends a change the first had refused", async () => {
    const you = page(A, bookId);
    const gone = await you.create({ kind: "note", body: "Gone." });
    browser.offline = true;
    await you.edit(gone, "Gone, edited offline.");
    browser.offline = false;
    await noteRequest(A, `/api/annotations/${gone.id}?changeId=${crypto.randomUUID()}`, "DELETE"); // removed on another device
    const [edit] = await outboxFor(A);
    browser.ways = ["slow"]; // the second tab's request is on its way, not yet at the library
    const secondTab = noteSender(A, bookId).flush(); // reads the edit again (not refused), sends it
    await until(() => browser.held.length === 1);
    await you.flush(); // the first tab sends it: refused (404) and kept
    expect((await outboxFor(A))[0]).toMatchObject({ id: edit.id, refused: { status: 404 } });
    release();
    await secondTab; // the library gets the refused change again (refused again; nothing changes)
    expect(browser.sent.filter((s) => s.path.includes(gone.id) && s.method === "PATCH")).toHaveLength(2);
  });
});
