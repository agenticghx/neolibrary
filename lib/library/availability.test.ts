import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { books, readalongImports } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { SpeechNotConfigured } from "@/lib/speech/model";
import { FakeSpeech } from "@/lib/speech/fake";
import { audiobookBookIds, availabilityLabel, availabilityOf, narrationOn, NOT_YET } from "./availability";

describe("availabilityLabel", () => {
  it("names each of the four cases", () => {
    expect(availabilityLabel({ read: true, listen: true })).toBe("Read and listen");
    expect(availabilityLabel({ read: true, listen: false })).toBe("Read only");
    expect(availabilityLabel({ read: false, listen: true })).toBe("Listen only");
    expect(availabilityLabel(NOT_YET)).toBe("Not available yet");
  });
});

describe("availabilityOf", () => {
  const epub = { fileKey: "books/a.epub", fileType: "epub" as const };
  const pdf = { fileKey: "books/a.pdf", fileType: "pdf" as const };
  const titleOnly = { fileKey: null, fileType: null };

  it("counts narration as listening for an EPUB, only when narration is on", () => {
    expect(availabilityOf(epub, false, true)).toEqual({ read: true, listen: true });
    expect(availabilityOf(epub, false, false)).toEqual({ read: true, listen: false });
  });

  it("never counts narration for a PDF: only an uploaded audiobook makes it listenable", () => {
    expect(availabilityOf(pdf, false, true)).toEqual({ read: true, listen: false });
    expect(availabilityOf(pdf, true, false)).toEqual({ read: true, listen: true });
  });

  it("leaves a title-only book not available yet, narration or not", () => {
    expect(availabilityOf(titleOnly, false, true)).toEqual(NOT_YET);
    expect(availabilityOf(titleOnly, false, false)).toEqual(NOT_YET);
  });

  it("supports listen only: an audiobook without a book file", () => {
    expect(availabilityOf(titleOnly, true, true)).toEqual({ read: false, listen: true });
  });
});

describe("narrationOn", () => {
  it("is on when a voice model is available, off when the key is missing", () => {
    expect(narrationOn(() => new FakeSpeech())).toBe(true);
    expect(
      narrationOn(() => {
        throw new SpeechNotConfigured("no key");
      }),
    ).toBe(false);
  });

  it("does not hide other errors", () => {
    expect(() =>
      narrationOn(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});

describe("audiobookBookIds", () => {
  let database: Database;
  let ownerId: string;
  beforeEach(async () => {
    database = await testDatabase();
    ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  });
  afterEach(() => database.raw.close());

  const book = async (owner: string, title: string) =>
    (await database.db.insert(books).values({ ownerId: owner, title, author: "", fileKey: `books/${title}.epub`, fileType: "epub" }).returning())[0].id;
  const audiobook = (owner: string, bookId: string, status: "uploading" | "ready") =>
    database.db.insert(readalongImports).values({
      ownerId: owner,
      bookId,
      status,
      manifest: {},
      report: { chapters: [], paragraphs: 0 },
      audio: [],
    });

  it("counts a finished upload, not one still uploading, and never another reader's", async () => {
    const admin = { id: ownerId, email: "o@example.com", name: "O", role: "admin" as const };
    const { token } = await createInvite(database.db, admin);
    const other = await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" });
    const ready = await book(ownerId, "Ready");
    const uploading = await book(ownerId, "Uploading");
    const none = await book(ownerId, "None");
    const theirs = await book(other.id, "Theirs");
    await audiobook(ownerId, ready, "ready");
    await audiobook(ownerId, ready, "ready");
    await audiobook(ownerId, uploading, "uploading");
    await audiobook(other.id, theirs, "ready");

    const ids = await audiobookBookIds(database.db, ownerId, [ready, uploading, none, theirs]);
    expect([...ids]).toEqual([ready]);
    expect(await audiobookBookIds(database.db, ownerId, [])).toEqual(new Set());
  });
});
