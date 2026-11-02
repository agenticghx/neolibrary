import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { rewriteParagraph } from "@/lib/library/rewrite";
import { getSections } from "@/lib/library/sections-store";
import { OWN_KEY_HEADERS, OWN_KEY_NEEDED } from "@/lib/own-key-names";
import { speechModelFor, transcriberFor } from "@/lib/speech";
import { SpeechNotConfigured } from "@/lib/speech/model";
import { MemoryStorage } from "@/lib/storage";
import { FakeModel } from "./fake";
import { reserveSpend, resetSpendHoldsForTests, spending, SpendingCapReached } from "./generate";
import { AiNotConfigured } from "./model";
import { textModelFor } from "./model-picks";
import { isOwnKeyProvider, OwnKeyTextModel, ownKeyFrom } from "./own-key";

// M34 S4, bring your own key: the owner's keys pay only for the owner; anyone else's request uses the key it carries.

const OWNER = { role: "admin" };
const READER = { role: "reader" };
const asked = (headers: Record<string, string> = {}) => new Request("http://x/api/books/b/rewrites", { headers });
const withAiKey = asked({ [OWN_KEY_HEADERS.ai]: "sk-ant-test-1234" });
const withVoiceKey = asked({ [OWN_KEY_HEADERS.voice]: "el-test-5678" });

afterEach(() => resetSpendHoldsForTests());

describe("ownKeyFrom", () => {
  it("reads one printable word from the right header, and nothing else", () => {
    expect(ownKeyFrom(withAiKey, "ai")).toBe("sk-ant-test-1234");
    expect(ownKeyFrom(withAiKey, "voice")).toBeNull();
    expect(ownKeyFrom(asked({ [OWN_KEY_HEADERS.ai]: "  " }), "ai")).toBeNull();
    expect(ownKeyFrom(asked({ [OWN_KEY_HEADERS.ai]: "two words" }), "ai")).toBeNull();
    expect(ownKeyFrom(asked({ [OWN_KEY_HEADERS.ai]: "x".repeat(301) }), "ai")).toBeNull();
  });
});

describe("who pays", () => {
  let database: Database;
  beforeEach(async () => {
    database = await testDatabase();
  });
  afterEach(() => database.raw.close());

  it("the owner uses the library's key, with or without a key in the request", async () => {
    const env = { AI_FAKE: "1" };
    expect((await textModelFor(database.db, "rewrite", OWNER, asked(), env)).provider).toBe("anthropic");
    expect((await textModelFor(database.db, "rewrite", OWNER, withAiKey, env)).provider).toBe("anthropic");
  });

  it("anyone else needs their own key, and their model is marked as theirs", async () => {
    const env = { AI_FAKE: "1", ANTHROPIC_API_KEY: "the-owners-key" };
    await expect(textModelFor(database.db, "rewrite", READER, asked(), env)).rejects.toThrow(AiNotConfigured);
    await expect(textModelFor(database.db, "rewrite", READER, asked(), env)).rejects.toThrow(OWN_KEY_NEEDED.ai);
    const theirs = await textModelFor(database.db, "rewrite", READER, withAiKey, env);
    expect(theirs.provider).toBe("anthropic-own-key");
    expect(isOwnKeyProvider(theirs.provider)).toBe(true);
  });

  it("a voice and a transcript follow the same rule with the ElevenLabs key", () => {
    const env = { AI_FAKE: "1", ELEVENLABS_API_KEY: "the-owners-key" };
    expect(speechModelFor(OWNER, asked(), env).provider).toBe("elevenlabs");
    expect(() => speechModelFor(READER, asked(), env)).toThrow(SpeechNotConfigured);
    expect(() => speechModelFor(READER, withAiKey, env)).toThrow(OWN_KEY_NEEDED.voice);
    expect(speechModelFor(READER, withVoiceKey, env).provider).toBe("elevenlabs-own-key");
    expect(transcriberFor(OWNER, asked(), env).provider).toBe("elevenlabs");
    expect(() => transcriberFor(READER, asked(), env)).toThrow(SpeechNotConfigured);
    expect(transcriberFor(READER, withVoiceKey, env).provider).toBe("elevenlabs-own-key");
  });
});

describe("spending on your own key", () => {
  it("is not held to the owner's caps", async () => {
    const db = {} as never;
    const now = new Date("2026-11-02T00:00:00Z");
    const caps = { perBookUsd: 0, perMonthUsd: 0 };
    const read = async () => ({ month: 100, book: 100 });
    await expect(reserveSpend(db, "anthropic", "b", 0.5, caps, now, "AI", read)).rejects.toThrow(SpendingCapReached);
    const release = await reserveSpend(db, "anthropic-own-key", "b", 0.5, caps, now, "AI", read);
    await release();
  });

  it("is saved like any answer but never counted in the owner's spending", async () => {
    const database = await testDatabase();
    try {
      const ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
      const file = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
      const bookId = (await importBook(database.db, new MemoryStorage(), ownerId, { name: "jh.epub", bytes: file })).bookId;
      const [p] = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph" && s.text.length > 200);
      const noRoom = { perBookUsd: 0, perMonthUsd: 0 };
      const out = await rewriteParagraph(database.db, new OwnKeyTextModel(new FakeModel()), ownerId, { bookId, sectionId: p.id, level: "plain" }, { caps: noRoom });
      expect(out.reused).toBe(false);
      expect(out.generation.provenance.provider).toBe("anthropic-own-key");
      expect(out.generation.provenance.costUsd).toBeGreaterThan(0);
      expect((await spending(database.db, "anthropic", bookId)).month).toBe(0);
    } finally {
      await database.raw.close();
    }
  });
});
