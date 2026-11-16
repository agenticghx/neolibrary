import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Railway starts the site with `npm run start`; npm runs the script through `sh -c`. On Linux that `sh` (dash) stays
// between npm and Next, and dies at once on SIGTERM: npm then exits and the container ends, so Next never hears the
// signal and cannot finish the narration paragraph being paid for (verify-narration, finding 1). `exec` makes the
// shell hand its place to Next, which then gets SIGTERM from npm and is waited for. Checked 2026-11-16 in
// node:22-bookworm-slim: without exec the app was stopped in 0.6 s without the signal ("npm error signal SIGTERM",
// as Railway logged); with exec it got the signal and finished 3 s of work before exiting 0.
describe("the start script", () => {
  it("hands the shell's place to Next (exec), so a deploy's SIGTERM reaches it", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.start).toMatch(/^exec next start /);
  });
});
