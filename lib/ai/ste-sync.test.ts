// Checks that the app's copy of the STE skill (prompts/ste/) matches the
// original, which lives in this repository at
// .claude/skills/simplified-technical-english (since M37, 2026-10-29; it was on
// Samuel's laptop before). Runs everywhere, including GitHub's test machines.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const original = process.env.STE_SKILL_DIR || join(__dirname, "..", "..", ".claude", "skills", "simplified-technical-english");
const copy = join(__dirname, "..", "..", "prompts", "ste");

const files: [string, string][] = [
  ["SKILL.md", "SKILL.md"],
  ["references/rules.md", "rules.md"],
  ["references/substitutions.md", "substitutions.md"],
  ["scripts/ste_check.py", "ste_check.py"],
];

describe("STE skill copy matches the original", () => {
  for (const [from, to] of files) {
    it(`prompts/ste/${to} matches ${from}`, () => {
      const same = readFileSync(join(original, from)).equals(readFileSync(join(copy, to)));
      expect(
        same,
        `prompts/ste/${to} differs from the original skill's ${from}. Run "node scripts/sync-ste.mjs" to copy it again.`,
      ).toBe(true);
    });
  }
});
