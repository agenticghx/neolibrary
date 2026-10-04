import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpendingCapReached, spending } from "@/lib/ai/generate";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { FakeImageGenerator } from "@/lib/images/generate";
import { MemoryStorage } from "@/lib/storage";
import { costReport } from "./costs";
import { fileOwner, importBook } from "./import";
import { makePicture, storedPicture } from "./pictures";

let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: file })).bookId;
});
afterEach(() => database.raw.close());

describe("generated pictures (M9)", () => {
  it("makes a picture once with provenance and cost, stores it under the owner, and re-serves it", async () => {
    const gen = new FakeImageGenerator();
    const first = await makePicture(database.db, storage, gen, ownerId, { bookId, subject: "  a Victorian  gas lamp " });
    expect(first.reused).toBe(false);
    expect(gen.calls).toHaveLength(1);
    expect(gen.calls[0]).toContain("a Victorian gas lamp");
    expect(gen.calls[0]).toContain("The Strange Case of Dr. Jekyll and Mr. Hyde by Robert Louis Stevenson");
    expect(gen.calls[0]).toContain("No text, labels");
    const g = first.generation;
    expect(g).toMatchObject({
      kind: "image",
      bookId,
      options: { subject: "a Victorian gas lamp" },
      provenance: { provider: "openai", model: "fake-image", promptName: "image", costUsd: 0.2 },
    });
    expect(g.output).toMatch(new RegExp(`^images/${ownerId}/${bookId}/[0-9a-f-]{36}\\.png$`));
    expect(fileOwner(g.output)).toBe(ownerId);
    expect((await storage.get(g.output))!.contentType).toBe("image/png");

    // The same subject (any case or spacing) is re-served, free.
    const again = await makePicture(database.db, storage, gen, ownerId, { bookId, subject: "A VICTORIAN GAS LAMP" });
    expect(again).toEqual({ generation: g, reused: true });
    expect(gen.calls).toHaveLength(1);
    expect((await storedPicture(database.db, ownerId, bookId, "a victorian gas lamp"))?.id).toBe(g.id);

    // Counted for OpenAI, on the cost page too.
    expect((await spending(database.db, "openai", bookId)).book).toBeCloseTo(0.2);
    const report = await costReport(database.db, ownerId, new Date(), {});
    expect(report.services.find((s) => s.provider === "openai")).toMatchObject({ spentUsd: 0.2, calls: 1, capUsd: 20 });
  });

  it("stops at the picture caps before calling, and refuses empty subjects and other books", async () => {
    const gen = new FakeImageGenerator();
    await expect(
      makePicture(database.db, storage, gen, ownerId, { bookId, subject: "fog" }, { caps: { perBookUsd: 0.1, perMonthUsd: 20 } }),
    ).rejects.toThrow(SpendingCapReached);
    await expect(
      makePicture(database.db, storage, gen, ownerId, { bookId, subject: "fog" }, { caps: { perBookUsd: 5, perMonthUsd: 0.1 } }),
    ).rejects.toThrow("IMAGE_CAP_PER_MONTH_USD");
    await expect(makePicture(database.db, storage, gen, ownerId, { bookId, subject: "   " })).rejects.toThrow("Say what");
    await expect(makePicture(database.db, storage, gen, ownerId, { bookId: "00000000-0000-0000-0000-000000000000", subject: "fog" })).rejects.toThrow(
      "Book not found",
    );
    expect(gen.calls).toHaveLength(0);
  });
});
