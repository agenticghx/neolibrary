import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capsFromEnv } from "./generate";
import { fill, readPrompt, splitPrompt } from "./prompts";

describe("prompt files", () => {
  it("fills {{values}} and refuses a missing one", () => {
    expect(fill("Hi {{name}}, {{name}}.", { name: "Sam" })).toBe("Hi Sam, Sam.");
    expect(() => fill("{{missing}}", {})).toThrow("{{missing}}");
  });

  it("splits system and message at ---user---", async () => {
    expect(splitPrompt("System\n---user---\nUser {{x}}\n")).toEqual({ system: "System", user: "User {{x}}" });
    expect(() => splitPrompt("no divider")).toThrow("---user---");
    const { system, user } = splitPrompt(await readPrompt("rewrite"));
    expect(system).toContain("{{instruction}}");
    expect(user).toContain("<passage>\n{{text}}\n</passage>");
  });

  it("has an instruction file for every rewrite level but STE (which has its own prompt), and nothing else", async () => {
    const { LEVELS } = await import("@/lib/library/rewrite");
    const levels = Object.keys(LEVELS).filter((l) => l !== "ste");
    expect(readdirSync("prompts/rewrite-levels").sort()).toEqual(levels.map((l) => `${l}.md`).sort());
    const { system, user } = splitPrompt(await readPrompt("ste-rewrite"));
    expect(system).toContain("{{skill}}");
    expect(system).toContain("---notes---");
    expect(user).toContain("<passage>\n{{text}}\n</passage>");
  });

  it("refuses names that could leave the prompts folder", async () => {
    await expect(readPrompt("../package")).rejects.toThrow("Bad prompt name");
  });
});

describe("spending caps from settings", () => {
  it("defaults to $5 per book and $20 per month", () => {
    expect(capsFromEnv({})).toEqual({ perBookUsd: 5, perMonthUsd: 20 });
    expect(capsFromEnv({ AI_CAP_PER_BOOK_USD: "2.5", AI_CAP_PER_MONTH_USD: "50" })).toEqual({ perBookUsd: 2.5, perMonthUsd: 50 });
    expect(capsFromEnv({ AI_CAP_PER_BOOK_USD: "lots", AI_CAP_PER_MONTH_USD: "-1" })).toEqual({ perBookUsd: 5, perMonthUsd: 20 });
  });
});
