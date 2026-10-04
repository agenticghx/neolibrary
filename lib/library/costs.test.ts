import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeModel } from "@/lib/ai/fake";
import { acceptInvite, createFirstAdmin, createInvite } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { FakeSpeech } from "@/lib/speech/fake";
import { MemoryStorage } from "@/lib/storage";
import { speakPassage } from "./audio";
import { costReport } from "./costs";
import { importBook } from "./import";
import { rewriteParagraph } from "./rewrite";
import { getSections } from "./sections-store";

let database: Database;
let adminId: string;

beforeEach(async () => {
  database = await testDatabase();
  adminId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

const jekyll = () => new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));

describe("the cost counter (M7)", () => {
  it("adds up this month's text and voice spending per service and per book, naming only the admin's own books", async () => {
    const storage = new MemoryStorage();
    const mine = (await importBook(database.db, storage, adminId, { name: "jh.epub", bytes: jekyll() })).bookId;
    const { token } = await createInvite(database.db, { id: adminId, email: "o@example.com", name: "O", role: "admin" });
    const reader = (await acceptInvite(database.db, token, { email: "r@example.com", name: "R", password: "long enough pw" })).id;
    const theirs = (await importBook(database.db, storage, reader, { name: "jh.epub", bytes: jekyll() })).bookId;
    const para = async (owner: string, book: string) => (await getSections(database.db, owner, book)).find((s) => s.kind === "paragraph")!;

    const r1 = await rewriteParagraph(database.db, new FakeModel(), adminId, { bookId: mine, sectionId: (await para(adminId, mine)).id, level: "plain" });
    const t1 = await speakPassage(database.db, storage, new FakeSpeech(), adminId, { bookId: mine, sectionId: (await para(adminId, mine)).id, voice: "fake-ada" });
    const r2 = await rewriteParagraph(database.db, new FakeModel(), reader, { bookId: theirs, sectionId: (await para(reader, theirs)).id, level: "shorter" });

    const report = await costReport(database.db, adminId, new Date(), {});
    expect(report.services).toEqual([
      expect.objectContaining({ provider: "anthropic", calls: 2, capUsd: 20, perBookCapUsd: 5 }),
      expect.objectContaining({ provider: "elevenlabs", calls: 1, capUsd: 20, perBookCapUsd: 5 }),
    ]);
    expect(report.services[0].spentUsd).toBeCloseTo(r1.generation.provenance.costUsd + r2.generation.provenance.costUsd);
    expect(report.services[1].spentUsd).toBeCloseTo(t1.track.costUsd);
    expect(report.books).toEqual([{ bookId: mine, title: "The Strange Case of Dr. Jekyll and Mr. Hyde", ai: r1.generation.provenance.costUsd, voice: t1.track.costUsd }]);
    expect(report.others.ai).toBeCloseTo(r2.generation.provenance.costUsd);
    expect(report.others.voice).toBe(0);

    // Next month starts from nothing; caps follow the settings.
    const next = await costReport(database.db, adminId, new Date(Date.UTC(2099, 0, 15)), { AI_CAP_PER_MONTH_USD: "50", VOICE_CAP_PER_MONTH_USD: "7.5" });
    expect(next.services.map((s) => [s.spentUsd, s.calls, s.capUsd])).toEqual([
      [0, 0, 50],
      [0, 0, 7.5],
    ]);
    expect(next.books).toEqual([]);
  });
});
