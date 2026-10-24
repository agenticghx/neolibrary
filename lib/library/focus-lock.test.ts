import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, focusSessions } from "@/lib/db/schema";
import { FINISHED_AT } from "@/lib/reader/focus-session";
import { testDatabase } from "@/lib/db/test-db";
import { MemoryStorage } from "@/lib/storage";
import {
  answerProblem,
  bookFinished,
  bookIdsOf,
  cancelWait,
  endFocus,
  FocusError,
  focusJson,
  focusRedirect,
  focusedBookIds,
  focusView,
  lockedOut,
  lockedOutOfFile,
  openFocus,
  redirectInfo,
  runningFocus,
  startFocus,
  startWait,
} from "./focus-lock";
import { createAnnotation } from "./annotations";
import { importBook } from "./import";
import { dueCount, NEW_PER_DAY, reviewQueue } from "./review";

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

describe("whole-book focus (M26 R5)", () => {
  const LONG_150 = Array.from({ length: 150 }, (_, i) => `word${i}`).join(" ");
  const SHORT_149 = Array.from({ length: 149 }, (_, i) => `word${i}`).join(" ");
  const startBook = (bookId: string, now: string, days: unknown = 14) =>
    startFocus(database.db, ownerId, { bookId, question: "What is the book's argument about time?", kind: "book", days }, at(now));
  const setProgress = (bookId: string, progress: number) => database.db.update(books).set({ progress }).where(eq(books.id, bookId));

  it("lasts whole days (kept as minutes), up to 30, and is still one session at a time", async () => {
    const s = await startBook(tm, "2026-10-24T09:00:00Z");
    expect(s).toMatchObject({ kind: "book", minutes: 14 * 1440, endsAt: at("2026-11-07T09:00:00Z") });
    await expect(start(jekyll, "2026-10-24T10:00:00Z")).rejects.toMatchObject({ status: 409 });
    await endFocus(database.db, ownerId, s.id, { answered: true }, at("2026-10-24T09:30:00Z"));
    for (const days of [0, 31, "x", undefined]) {
      await expect(startFocus(database.db, ownerId, { bookId: tm, question: "Why?", kind: "book", days }), String(days)).rejects.toThrow("Set between 1 and 30 days");
    }
    expect(await openFocus(database.db, ownerId)).toBeNull();
  });

  it("leaving early takes 150 words or a 24-hour wait", async () => {
    const s = await startBook(tm, "2026-10-24T09:00:00Z");
    expect(answerProblem(s, SHORT_149, at("2026-10-25T09:00:00Z"))).toMatch(/at least 150 words \(this has 149\)/);
    expect(answerProblem(s, LONG_150, at("2026-10-25T09:00:00Z"))).toBeNull();
    await expect(endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-25T09:00:00Z"))).rejects.toMatchObject({ status: 409 });
    const waiting = await startWait(database.db, ownerId, s.id, at("2026-10-25T09:00:00Z"));
    expect(waiting!.waitEndsAt).toEqual(at("2026-10-26T09:00:00Z"));
    expect(focusJson(waiting!, at("2026-10-25T09:00:00Z")).waitMs).toBe(24 * 3_600_000);
    expect(await runningFocus(database.db, ownerId, at("2026-10-26T08:59:00Z"))).not.toBeNull();
    expect(await runningFocus(database.db, ownerId, at("2026-10-26T09:00:01Z"))).toBeNull();
    expect((await endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-26T09:00:01Z")))!.endedHow).toBe("waited");
  });

  it("reaching the last page ends it as finished, judged from the place saved, on either edition", async () => {
    // Jekyll stands in for The Time Machine's text edition here: the reader moves between the two.
    await database.db.update(books).set({ editionOf: tm }).where(eq(books.id, jekyll));
    const s = await startBook(tm, "2026-10-24T09:00:00Z");
    expect(await bookFinished(database.db, ownerId, s)).toBe(false);
    await setProgress(jekyll, FINISHED_AT - 0.01);
    expect(await bookFinished(database.db, ownerId, s)).toBe(false);
    await expect(endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-25T09:00:00Z"))).rejects.toMatchObject({ status: 409 });
    await setProgress(jekyll, FINISHED_AT);
    expect(await bookFinished(database.db, ownerId, s)).toBe(true);
    // At the end any answer will do, and no answer too.
    expect(answerProblem(s, "Short.", at("2026-10-25T09:00:00Z"), true)).toBeNull();
    expect((await endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-25T09:00:00Z")))!.endedHow).toBe("finished");
  });

  it("once the last page is reached, other books open at once, before the question is answered, and a new session can start", async () => {
    const s = await startBook(tm, "2026-10-24T09:00:00Z");
    expect(await runningFocus(database.db, ownerId, at("2026-10-24T10:00:00Z"))).not.toBeNull();
    expect((await lockedOut(database.db, ownerId, jekyll))?.status).toBe(423);
    await setProgress(tm, 1);
    // Still open (the reader will ask the question), but no longer locking anything.
    expect((await openFocus(database.db, ownerId))?.id).toBe(s.id);
    expect(await runningFocus(database.db, ownerId, at("2026-10-24T10:00:00Z"))).toBeNull();
    expect(await lockedOut(database.db, ownerId, jekyll)).toBeNull();
    // The tab was closed without an answer: the next session closes it as finished.
    await start(jekyll, "2026-10-25T09:00:00Z");
    const [old] = await database.db.select().from(focusSessions).where(eq(focusSessions.id, s.id));
    expect(old).toMatchObject({ endedAt: at("2026-10-25T09:00:00Z"), endedHow: "finished" });
  });

  it("a sitting never ends as finished, however far the reader has read", async () => {
    await setProgress(tm, 1);
    const s = await start(tm, "2026-10-24T09:00:00Z");
    expect(await bookFinished(database.db, ownerId, s)).toBe(false);
    await expect(endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-24T09:01:00Z"))).rejects.toMatchObject({ status: 409 });
  });

  it("when the days run out it ends on time, and other pages open again", async () => {
    const s = await startBook(tm, "2026-10-24T09:00:00Z", 1);
    expect(await runningFocus(database.db, ownerId, at("2026-10-25T08:59:00Z"))).not.toBeNull();
    expect(await runningFocus(database.db, ownerId, at("2026-10-25T09:00:00Z"))).toBeNull();
    expect((await endFocus(database.db, ownerId, s.id, { answered: false }, at("2026-10-25T09:00:00Z")))!.endedHow).toBe("time");
  });

  it("knows every id the book goes by, and its own page is the scan's", async () => {
    await database.db.update(books).set({ editionOf: tm }).where(eq(books.id, jekyll));
    expect((await bookIdsOf(database.db, ownerId, jekyll)).sort()).toEqual([jekyll, tm].sort());
    const s = await startBook(jekyll, "2026-10-24T09:00:00Z");
    expect(await redirectInfo(database.db, ownerId, s)).toMatchObject({ bookId: jekyll, kind: "book", homeId: tm });
    expect(await focusView(database.db, ownerId, s, at("2026-10-24T09:00:00Z"))).toMatchObject({ kind: "book", homeId: tm, finished: false });
    // Both editions open; the files of either are not locked.
    expect(await lockedOut(database.db, ownerId, tm)).toBeNull();
  });

  it("locks the pages that list other books, and other books, and nothing else", () => {
    const running = { bookId: "text", kind: "book", bookIds: ["text", "scan"], homeId: "scan" };
    for (const page of ["/", "/library", "/library/all", "/search", "/shelf", "/shelf/x", "/covers", "/books/other", "/books/other/read"]) {
      expect(focusRedirect(running, page), page).toBe("/books/scan");
    }
    for (const page of ["/books/scan", "/books/scan/read", "/books/text/read", "/review", "/stats", "/paths", "/paths/a-path", "/import", "/account", "/data", "/help"]) {
      expect(focusRedirect(running, page), page).toBeNull();
    }
    // Without the ids (an older answer), the book itself.
    expect(focusRedirect({ bookId: "b1", kind: "book" }, "/library")).toBe("/books/b1");
    expect(focusRedirect({ bookId: "b1", kind: "book" }, "/books/b1/read")).toBeNull();
  });
});

describe("Daily review during a whole-book focus (M26 R5)", () => {
  it("holds only the focused book's cards (either edition); the others come back when it ends", async () => {
    await database.db.update(books).set({ editionOf: tm }).where(eq(books.id, jekyll));
    const third = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "fr.epub", bytes: new Uint8Array(readFileSync(new URL("../../fixtures/books/shelley-frankenstein.epub", import.meta.url))) })).bookId;
    const now = new Date();
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: tm, body: "On the scan" }, new Date(now.getTime() - 3_600_000));
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: jekyll, body: "On the text edition" }, new Date(now.getTime() - 3_600_000));
    await createAnnotation(database.db, ownerId, { kind: "note", bookId: third, body: "On another book" }, new Date(now.getTime() - 3_600_000));
    const bodies = async () => (await reviewQueue(database.db, ownerId, now, NEW_PER_DAY, 0, await focusedBookIds(database.db, ownerId, now))).cards.map((c) => c.note).sort();
    expect(await bodies()).toEqual(["On another book", "On the scan", "On the text edition"]);
    expect(await focusedBookIds(database.db, ownerId, now)).toBeNull();
    // A sitting does not narrow the review (it locks every other page anyway).
    const sitting = await startFocus(database.db, ownerId, { bookId: tm, question: "Why?", minutes: 5 }, now);
    expect(await focusedBookIds(database.db, ownerId, now)).toBeNull();
    await database.db.update(focusSessions).set({ endedAt: now, endedHow: "answered" }).where(eq(focusSessions.id, sitting.id));
    const f = await startFocus(database.db, ownerId, { bookId: tm, question: "Where is mankind going?", kind: "book", days: 3 }, now);
    expect(await bodies()).toEqual(["On the scan", "On the text edition"]);
    expect(await dueCount(database.db, ownerId, now, await focusedBookIds(database.db, ownerId, now))).toBe(2);
    await database.db.update(focusSessions).set({ endedAt: now, endedHow: "answered" }).where(eq(focusSessions.id, f.id));
    expect(await bodies()).toEqual(["On another book", "On the scan", "On the text edition"]);
  });
});
