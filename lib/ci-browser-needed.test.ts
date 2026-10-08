import { describe, expect, it } from "vitest";
import { browserJobNeeded } from "../scripts/ci-browser-needed.mjs";

describe("browserJobNeeded", () => {
  it("skips the browser job only when every file is docs, a workflow, or Markdown", () => {
    expect(browserJobNeeded(["docs/security-leftovers.md", "PROGRESS.md", ".github/workflows/ci.yml"])).toBe(false);
    expect(browserJobNeeded([".claude/skills/merge-train/SKILL.md"])).toBe(false);
    expect(browserJobNeeded(["app/api/health/route.ts"])).toBe(true);
    expect(browserJobNeeded(["lib/health.ts", "docs/security-leftovers.md"])).toBe(true);
    expect(browserJobNeeded([])).toBe(true);
    expect(browserJobNeeded(["package.json"])).toBe(true);
  });
});
