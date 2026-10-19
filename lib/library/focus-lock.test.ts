import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { focusSessions } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import { answerProblem, cancelWait, endFocus, FocusError, focusJson, focusRedirect, lockedOut, lockedOutOfFile, openFocus, runningFocus, startFocus, startWait } from "./focus-lock";
import { importBook } from "./import";

let database: Database;
let ownerId: string;
let owner: Awaited<ReturnType<typeof createFirstAdmin>>;
let tm: string;
let jekyll: string;
let tmKey: string;
let jekyllKey: string;

beforeEach(async () => {
  database = await testDatabase();
  owner = await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" });
  ownerId = owner.id;
  const load = (f: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/books/${f}`, import.meta.url)));
  const storage = new MemoryStorage();
  const a = await importBook(database.db, storage, ownerId, { name: "tm.epub", bytes: load("wells-the-time-machine.epub") });
  const b = await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: load("stevenson-jekyll-and-hyde.epub") });
  tm = a.bookId;
  jekyll = b.bookId;
  tmKey = `books/${ownerId}/${tm}.epub`;
  jekyllKey = `books/${ownerId}/${jekyll}.epub`;
});
afterEach(() => database.raw.close());

const at = (iso: string) => new Date(iso);
const start = (bookId: string, now: string, minutes = 2) => startFocus(database.db, ownerId, { bookId, question: "Why forward, and not back?", minutes }, at(now));

describe("one focus session at a time (M26 R4a)", () => {
  it("refuses a second session while one runs, on the same book or another", async () => {
    const first = await start(tm, "2026-10-18T09:00:00Z");
    expect(first).toMatchObject({ bookId: tm, kind: "sitting", minutes: 2, endsAt: at("2026-10-18T09:02:00Z"), endedAt: null });
    await expect(start(jekyll, "2026-10-18T09:01:00Z")).rejects.toMatchObject({ status: 409 });
    await expect(start(tm, "2026-10-18T09:01:59Z")).rejects.toBeInstanceOf(FocusError);
    expect((await database.db.select().from(focusSessions)).length).toBe(1);
  });

  it("the database itself keeps the rule: a second open row is refused even when the code's check is skipped", async () => {
    await start(tm, "2026-10-18T09:00:00Z");
    const row = { ownerId, bookId: jekyll, question: "Another?", minutes: 5, startedAt: at("2026-10-18T09:00:30Z"), endsAt: at("2026-10-18T09:05:30Z") };
    await expect(database.db.insert(focusSessions).values({ ...row, id: crypto.randomUUID(), noteId: crypto.randomUUID() })).rejects.toThrow();
    // Once the first has ended (here with an answer), a second row goes in.
    const open = await openFocus(database.db, ownerId);
    await endFocus(database.db, ownerId, open!.id, { answered: true }, at("2026-10-18T09:00:20Z"));
    await database.db.insert(focusSessions).values({ ...row, id: crypto.randomUUID(), noteId: crypto.randomUUID() });
  });

  it("once the time is up, a new session starts, and the old one is closed as ended on time", async () => {
    const first = await start(tm, "2026-10-18T09:00:00Z");
    const second = await start(jekyll, "2026-10-18T09:02:00Z");
    expect(second.bookId).toBe(jekyll);
    const [old] = await database.db.select().from(focusSessions).where(eq(focusSessions.id, first.id));
    expect(old).toMatchObject({ endedAt: at("2026-10-18T09:02:00Z"), endedHow: "time" });
  });

  it("another reader's session is theirs: it neither blocks nor shows", async () => {
    const link = await createInvite(database.db, owner, "for Fola");
    const fola = await acceptInvite(database.db, link.token, { email: "f@example.com", name: "Fola", password: "long enough pw" });
    await start(tm, "2026-10-18T09:00:00Z");
    expect(await openFocus(database.db, fola.id)).toBeNull();
    // Fola cannot start a session on the owner's book.
    await expect(startFocus(database.db, fola.id, { bookId: tm, question: "Mine?", minutes: 5 }, at("2026-10-18T09:00:10Z"))).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a blank question, minutes out of range, and a book that is not the reader's", async () => {
    await expect(startFocus(database.db, ownerId, { bookId: tm, question: "  ", minutes: 5 })).rejects.toThrow("Write the question");
    await expect(startFocus(database.db, ownerId, { bookId: tm, question: "Why?", minutes: 0 })).rejects.toThrow("Set between");
    await expect(startFocus(database.db, ownerId, { bookId: tm, question: "Why?", minutes: 181 })).rejects.toThrow("Set between");
    await expect(startFocus(database.db, ownerId, { bookId: crypto.randomUUID(), question: "Why?", minutes: 5 })).rejects.toMatchObject({ status: 404 });
  });

  it("is running until its time is up or it is ended; how it ended is recorded once", async () => {
    const s = await start(tm, "2026-10-18T09:00:00Z");
    expect(await runningFocus(database.db, ownerId, at("2026-10-18T09:01:59Z"))).toMatchObject({ id: s.id });
    expect(await runningFocus(database.db, ownerId, at("2026-10-18T09:02:00Z"))).toBeNull();
    // Still open (the reader has not answered yet), but no longer running.
    expect(await openFocus(database.db, ownerId)).toMatchObject({ id: s.id });
    expect(focusJson(s, at("2026-10-18T09:00:30Z"))).toMatchObject({ remainingMs: 90_000, running: true });
    expect(focusJson(s, at("2026-10-18T09:05:00Z"))).toMatchObject({ remainingMs: 0, running: false });

    // M26 R4b: without an answer, before the time is up, it does not end.
    await expect(endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-18T09:00:40Z"))).rejects.toMatchObject({ status: 409 });
    const ended = await endFocus(database.db, ownerId, s.id, { answered: true }, at("2026-10-18T09:00:40Z"));
    expect(ended).toMatchObject({ endedHow: "answered", endedAt: at("2026-10-18T09:00:40Z") });
    // Ending it again (a retry, another device) changes nothing.
    const again = await endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-18T09:03:00Z"));
    expect(again).toMatchObject({ endedHow: "answered", endedAt: at("2026-10-18T09:00:40Z") });
    expect(await openFocus(database.db, ownerId)).toBeNull();
  });

  it("says how it ended: on time (a few seconds' grace for a clock ahead) or answered early", async () => {
    const onTime = await start(tm, "2026-10-18T09:00:00Z");
    expect((await endFocus(database.db, ownerId, onTime.id, { answered: true }, at("2026-10-18T09:01:57Z")))!.endedHow).toBe("time");
    const answered = await start(tm, "2026-10-18T10:00:00Z");
    expect((await endFocus(database.db, ownerId, answered.id, { answered: true }, at("2026-10-18T10:01:00Z")))!.endedHow).toBe("answered");
    expect(await endFocus(database.db, ownerId, "not an id", { answered: false })).toBeNull();
  });
});

describe("the lock while a session runs (M26 R4a)", () => {
  it("sends every page but the focused book and Account to the focused book", () => {
    const running = { bookId: "b1" };
    for (const page of ["/", "/library", "/search", "/search?q=x", "/paths", "/paths/hidden-machinery", "/review", "/stats", "/books/b1", "/books/b2/read", "/import", "/data"]) {
      expect(focusRedirect(running, page.split("?")[0]), page).toBe("/books/b1/read");
    }
    for (const page of ["/books/b1/read", "/books/b1/read/", "/account", "/account/"]) expect(focusRedirect(running, page), page).toBeNull();
    // No session running: every page opens.
    expect(focusRedirect(null, "/library")).toBeNull();
  });

  it("refuses another book's file and audio (423 Locked) while a session runs, and nothing once it is over", async () => {
    const s = await start(tm, new Date().toISOString(), 5);
    expect(await lockedOut(database.db, ownerId, tm)).toBeNull();
    const refused = await lockedOut(database.db, ownerId, jekyll);
    expect(refused?.status).toBe(423);
    expect(await refused!.json()).toMatchObject({ focusBookId: tm });
    expect((await lockedOutOfFile(database.db, ownerId, jekyllKey))?.status).toBe(423);
    expect(await lockedOutOfFile(database.db, ownerId, tmKey)).toBeNull();
    // Covers are not locked.
    expect(await lockedOutOfFile(database.db, ownerId, `covers/${ownerId}/${jekyll}.png`)).toBeNull();
    await endFocus(database.db, ownerId, s.id, { answered: true });
    expect(await lockedOut(database.db, ownerId, jekyll)).toBeNull();
    expect(await lockedOutOfFile(database.db, ownerId, jekyllKey)).toBeNull();
  });
});

describe("the ways out before the time is up (M26 R4b)", () => {
  const WAIT = 10 * 60_000;
  const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const SHORT = Array.from({ length: 39 }, (_, i) => `word${i}`).join(" ");

  it("an early answer needs 40 words; once the time is up, any answer will do", async () => {
    const s = await start(tm, "2026-10-18T09:00:00Z", 30);
    expect(answerProblem(s, SHORT, at("2026-10-18T09:10:00Z"))).toMatch(/at least 40 words \(this has 39\)/);
    expect(answerProblem(s, LONG, at("2026-10-18T09:10:00Z"))).toBeNull();
    expect(answerProblem(s, "Short.", at("2026-10-18T09:30:00Z"))).toBeNull();
    // No session (a sitting from before R4a) is not this rule's business.
    expect(answerProblem(null, "Short.")).toBeNull();
  });

  it("the wait: it lets the reader go when it runs out, and the session ends as waited", async () => {
    const s = await start(tm, "2026-10-18T09:00:00Z", 30);
    const waiting = await startWait(database.db, ownerId, s.id, at("2026-10-18T09:05:00Z"), WAIT);
    expect(waiting).toMatchObject({ waitEndsAt: at("2026-10-18T09:15:00Z"), endedAt: null });
    expect(focusJson(waiting!, at("2026-10-18T09:06:00Z"))).toMatchObject({ waitRemainingMs: 9 * 60_000, running: true });
    // While it runs, the session still locks, and still cannot be ended without an answer.
    expect(await runningFocus(database.db, ownerId, at("2026-10-18T09:14:00Z"))).toMatchObject({ id: s.id });
    await expect(endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-18T09:14:00Z"))).rejects.toMatchObject({ status: 409 });
    // Asking again keeps the first wait: it never moves.
    expect((await startWait(database.db, ownerId, s.id, at("2026-10-18T09:10:00Z"), WAIT))!.waitEndsAt).toEqual(at("2026-10-18T09:15:00Z"));
    // Once it runs out, nothing is locked, a short answer will do, and the session ends as "waited".
    expect(await runningFocus(database.db, ownerId, at("2026-10-18T09:15:00Z"))).toBeNull();
    expect(answerProblem(waiting, "Short.", at("2026-10-18T09:15:00Z"))).toBeNull();
    const ended = await endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-18T09:15:30Z"));
    expect(ended).toMatchObject({ endedHow: "waited", endedAt: at("2026-10-18T09:15:30Z") });
  });

  it("an answer saved after the wait ran out still ends it as waited (that was the way out)", async () => {
    const s = await start(tm, "2026-10-18T09:00:00Z", 30);
    await startWait(database.db, ownerId, s.id, at("2026-10-18T09:05:00Z"), WAIT);
    expect((await endFocus(database.db, ownerId, s.id, { answered: true }, at("2026-10-18T09:16:00Z")))!.endedHow).toBe("waited");
  });

  it("Keep reading cancels the wait; a wait that has run out cannot be cancelled", async () => {
    const s = await start(tm, "2026-10-18T09:00:00Z", 30);
    await startWait(database.db, ownerId, s.id, at("2026-10-18T09:05:00Z"), WAIT);
    const kept = await cancelWait(database.db, ownerId, s.id, at("2026-10-18T09:06:00Z"));
    expect(kept).toMatchObject({ waitEndsAt: null });
    expect(focusJson(kept!, at("2026-10-18T09:06:00Z")).waitRemainingMs).toBeNull();
    expect(await runningFocus(database.db, ownerId, at("2026-10-18T09:20:00Z"))).toMatchObject({ id: s.id });
    // A new wait starts from now, not from the first one.
    expect((await startWait(database.db, ownerId, s.id, at("2026-10-18T09:20:00Z"), WAIT))!.waitEndsAt).toEqual(at("2026-10-18T09:30:00Z"));
    expect((await cancelWait(database.db, ownerId, s.id, at("2026-10-18T09:30:00Z")))!.waitEndsAt).toEqual(at("2026-10-18T09:30:00Z"));
  });

  it("a wait that ran out with no device open is closed as waited when the next session starts", async () => {
    const s = await start(tm, "2026-10-18T09:00:00Z", 60);
    await startWait(database.db, ownerId, s.id, at("2026-10-18T09:05:00Z"), WAIT);
    const next = await start(jekyll, "2026-10-18T09:20:00Z");
    expect(next.bookId).toBe(jekyll);
    const [old] = await database.db.select().from(focusSessions).where(eq(focusSessions.id, s.id));
    expect(old).toMatchObject({ endedAt: at("2026-10-18T09:15:00Z"), endedHow: "waited" });
  });

  it("only the reader's own session: a bad id or someone else's is not found", async () => {
    await start(tm, "2026-10-18T09:00:00Z", 30);
    expect(await startWait(database.db, ownerId, "not an id")).toBeNull();
    expect(await cancelWait(database.db, ownerId, crypto.randomUUID())).toBeNull();
  });
});
