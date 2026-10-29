import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { testDatabase } from "@/lib/db/test-db";
import { generate, type GenerationRequest } from "./generate";
import { getModelPicks, modelTable, ModelPickError, setModelPicks, textModel } from "./model-picks";
import type { TextModel, TextRequest } from "./model";

const KEY = "sk-ant-test-not-a-real-key";
const env = { ANTHROPIC_API_KEY: KEY };

let database: Database;
let ownerId: string;

beforeEach(async () => {
  database = await testDatabase();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
});
afterEach(() => database.raw.close());

/** A stand-in for Claude that answers as one named model and counts its calls. */
function stub(model: string) {
  const m = {
    provider: "anthropic",
    model,
    calls: 0,
    async generate(req: TextRequest) {
      m.calls += 1;
      return { text: `${model} on ${req.prompt}`, model, inputTokens: 100, outputTokens: 50 };
    },
  };
  return m satisfies TextModel;
}

const request = (): GenerationRequest => ({
  ownerId,
  bookId: null,
  sectionId: null,
  kind: "prerequisites",
  options: { style: "plain" },
  promptName: "prerequisites",
  promptHash: "p1",
  input: "Chapter 21's text",
  system: "Instructions",
  prompt: "Chapter 21's text",
  maxTokens: 1000,
  effort: "low",
});

describe("the owner's model picks (M35)", () => {
  it("start empty, so every feature answers with its default", async () => {
    expect(await getModelPicks(database.db)).toEqual({});
    const table = await modelTable(database.db, {});
    expect(table.find((r) => r.feature === "explain-back")).toMatchObject({ label: "Explain it back", picked: null, answers: "claude-opus-5-5" });
    expect((await textModel(database.db, "explain-back", env)).model).toBe("claude-opus-5-5");
  });

  it("a pick wins over the server setting, and 'default' takes it back off", async () => {
    await setModelPicks(database.db, ownerId, { "explain-back": "claude-sonnet-5-5", questions: "default" });
    expect(await getModelPicks(database.db)).toEqual({ "explain-back": "claude-sonnet-5-5" });
    expect((await textModel(database.db, "explain-back", { ...env, AI_MODEL_EXPLAIN_BACK: "claude-haiku-5-5" })).model).toBe("claude-sonnet-5-5");
    expect((await textModel(database.db, "questions", env)).model).toBe("claude-haiku-5-5");

    await setModelPicks(database.db, ownerId, { "explain-back": "default" });
    expect(await getModelPicks(database.db)).toEqual({});
    expect((await textModel(database.db, "explain-back", { ...env, AI_MODEL_EXPLAIN_BACK: "claude-haiku-5-5" })).model).toBe("claude-haiku-5-5");
  });

  it("refuses a model that is not on the list, and keeps the picks it had", async () => {
    await setModelPicks(database.db, ownerId, { rewrite: "claude-opus-5-5" });
    await expect(setModelPicks(database.db, ownerId, { rewrite: "claude-opus-9" })).rejects.toBeInstanceOf(ModelPickError);
    await expect(setModelPicks(database.db, ownerId, { rewrite: "fake" })).rejects.toBeInstanceOf(ModelPickError);
    expect(await getModelPicks(database.db)).toEqual({ rewrite: "claude-opus-5-5" });
  });

  it("after a switch, a saved answer is still served free; asking again uses the new model (Samuel, 2026-10-29)", async () => {
    const haiku = stub("claude-haiku-5-5");
    const first = await generate(database.db, haiku, request());
    expect(first.reused).toBe(false);

    const sonnet = stub("claude-sonnet-5-5");
    const again = await generate(database.db, sonnet, request());
    expect(again.reused).toBe(true);
    expect(again.generation.provenance.model).toBe("claude-haiku-5-5");
    expect(sonnet.calls).toBe(0);

    const fresh = await generate(database.db, sonnet, request(), { fresh: true });
    expect(fresh.reused).toBe(false);
    expect(fresh.generation.provenance.model).toBe("claude-sonnet-5-5");
    expect(sonnet.calls).toBe(1);
  });
});
