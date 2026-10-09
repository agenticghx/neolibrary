import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = "scripts/patch-foliate-fxl.mjs";

// The two spots in foliate-js 1.0.1 that report the wrong page of a pair.
const ORIGINAL = `
        const section = spread?.center ?? (this.side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        if (index === this.#index) {
            this.#render(side)
            return
        }
`;

describe("foliate fixed-layout patch", () => {
  it("makes the installed file report the page on screen, and a second run changes nothing", () => {
    execFileSync("node", [SCRIPT], { encoding: "utf8" });
    const src = readFileSync("node_modules/foliate-js/fixed-layout.js", "utf8");
    expect(src).toContain("this.#side === 'left'");
    expect(src).toContain("if (side) this.#side = side");
    expect(src).not.toContain("this.side === 'left'");
    const again = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    expect(again).toMatch(/already/);
    expect(readFileSync("node_modules/foliate-js/fixed-layout.js", "utf8")).toBe(src);
  });

  it("patches a 1.0.1 copy and refuses a file it does not recognise", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxl-"));
    try {
      const file = join(dir, "fixed-layout.js");
      writeFileSync(file, ORIGINAL);
      execFileSync("node", [SCRIPT, file], { encoding: "utf8" });
      const patched = readFileSync(file, "utf8");
      expect(patched).toContain("this.#side === 'left'");
      expect(patched).toContain("if (side) this.#side = side");
      expect(patched).not.toContain("this.side === 'left'");
      expect(execFileSync("node", [SCRIPT, file], { encoding: "utf8" })).toMatch(/already/);
      writeFileSync(file, "not the foliate file");
      let failed = false;
      try {
        execFileSync("node", [SCRIPT, file], { encoding: "utf8" });
      } catch (err) {
        failed = true;
        const out = err as { message?: string; stderr?: string };
        expect(`${out.message ?? ""}\n${out.stderr ?? ""}`).toMatch(/1\.0\.1/);
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
