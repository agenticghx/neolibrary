// Checks that the app's copies of the read-along package format and checker
// (tools/readalong/) match the readalong-audio skill they came from, which
// lives in this repository at .claude/skills/readalong-audio (since M37,
// 2026-10-29). Runs everywhere, including GitHub's test machines.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const skill = join(root, ".claude", "skills", "readalong-audio");
const files: [string, string][] = [
  ["references/package-format.md", "package-format.md"],
  ["scripts/validate_package.py", "validate_package.py"],
];

describe("read-along copies match the readalong-audio skill", () => {
  for (const [from, to] of files) {
    it(`tools/readalong/${to} matches ${from}`, () => {
      const same = readFileSync(join(skill, from)).equals(readFileSync(join(root, "tools", "readalong", to)));
      expect(same, `tools/readalong/${to} differs from .claude/skills/readalong-audio/${from}. Copy it again.`).toBe(true);
    });
  }
});
