// Checks that the app's copy of the plain-english skill (prompts/plain/) matches
// the original, which lives in this repository at .claude/skills/plain-english
// (since M37, 2026-10-29; it was on Samuel's laptop before). Runs everywhere,
// including GitHub's test machines.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const original = process.env.PLAIN_SKILL_DIR || join(__dirname, "..", "..", ".claude", "skills", "plain-english");
const copy = join(__dirname, "..", "..", "prompts", "plain", "SKILL.md");

describe("plain-english skill copy matches the original", () => {
  it("prompts/plain/SKILL.md matches SKILL.md", () => {
    const same = readFileSync(join(original, "SKILL.md")).equals(readFileSync(copy));
    expect(same, "prompts/plain/SKILL.md differs from the original skill. Copy it again (prompts/plain/README.md).").toBe(true);
  });
});
