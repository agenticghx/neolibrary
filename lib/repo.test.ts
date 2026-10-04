import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// A too-broad .gitignore rule once hid app/(app)/books/ ("books/" was meant
// for book files), so the page never reached GitHub. Source must never be ignored.
const ALLOWED = ["e2e/.auth/"];

describe("repository", () => {
  it("does not ignore any source file", () => {
    const out = execFileSync(
      "git",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "app", "components", "lib", "db", "data", "e2e", "scripts", "fixtures"],
      { encoding: "utf8" },
    );
    const ignored = out.split("\n").filter((l) => l && !ALLOWED.some((a) => l.startsWith(a)));
    expect(ignored).toEqual([]);
  });
});
