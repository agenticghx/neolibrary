// Checks that the app's copy of the STE skill (prompts/ste/) matches Samuel's
// original skill. Runs only on a machine that has the original (his laptop);
// skipped elsewhere, e.g. on GitHub's test machines.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const original =
  process.env.STE_SKILL_DIR ||
  join(homedir(), "projects/llm_configs/plugins/bio-skills/skills/simplified-technical-english");
const copy = join(__dirname, "..", "..", "prompts", "ste");

const files: [string, string][] = [
  ["SKILL.md", "SKILL.md"],
  ["references/rules.md", "rules.md"],
  ["references/substitutions.md", "substitutions.md"],
  ["scripts/ste_check.py", "ste_check.py"],
];

describe.skipIf(!existsSync(original))("STE skill copy matches the original", () => {
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
