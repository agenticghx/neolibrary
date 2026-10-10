// Checks that the app's copy of the plain-english skill (prompts/plain/) matches
// Samuel's original. Runs only on a machine that has the original (his laptop);
// skipped elsewhere, e.g. on GitHub's test machines.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const original = process.env.PLAIN_SKILL_DIR || join(homedir(), ".local/share/chezmoi/claude/skills/plain-english");
const copy = join(__dirname, "..", "..", "prompts", "plain", "SKILL.md");

describe.skipIf(!existsSync(original))("plain-english skill copy matches the original", () => {
  it("prompts/plain/SKILL.md matches SKILL.md", () => {
    const same = readFileSync(join(original, "SKILL.md")).equals(readFileSync(copy));
    expect(same, "prompts/plain/SKILL.md differs from the original skill. Copy it again (prompts/plain/README.md).").toBe(true);
  });
});
