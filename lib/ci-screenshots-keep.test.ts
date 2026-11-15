import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/ci-screenshots-keep.sh: CI's publish step pushes its commit in place of the ci-screenshots branch.
const SCRIPT = path.resolve("scripts/ci-screenshots-keep.sh");
let dir = "";

function git(...args: string[]) {
  return execFileSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}
function keep(commit: string, n?: number) {
  return execFileSync("sh", [SCRIPT, commit, ...(n === undefined ? [] : [String(n)])], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

/** A branch like ci-screenshots: one folder per pull request, made one commit at a time, and a README. */
function branchWith(prs: number[]) {
  dir = mkdtempSync(path.join(tmpdir(), "shots-"));
  git("init", "-q");
  writeFileSync(path.join(dir, "README.md"), "pictures\n");
  for (const n of prs) {
    mkdirSync(path.join(dir, `pr-${n}`, "abc"), { recursive: true });
    writeFileSync(path.join(dir, `pr-${n}`, "abc", "home-desktop-light.png"), `picture of ${n}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", `Screenshots for pr-${n}`);
  }
  return git("rev-parse", "HEAD");
}
const top = (commit: string) => git("ls-tree", "--name-only", commit).split("\n");

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("ci-screenshots-keep.sh", () => {
  it("keeps the newest 30 pull requests by number, not by name order, in a commit with no parent", () => {
    // 9 and 10 sort the wrong way as text (pr-10 < pr-9); 35 folders, 5 too many.
    const prs = Array.from({ length: 35 }, (_, i) => i + 1);
    const head = branchWith(prs);
    const kept = keep(head);
    expect(top(kept)).toEqual(["README.md", ...Array.from({ length: 30 }, (_, i) => `pr-${i + 6}`)].sort());
    expect(git("rev-list", "--count", kept)).toBe("1");
    // The kept folders are the same objects: nothing is copied or changed.
    expect(git("rev-parse", `${kept}:pr-35`)).toBe(git("rev-parse", `${head}:pr-35`));
  });

  it("keeps everything when there are fewer folders than the limit", () => {
    const head = branchWith([7, 300, 41]);
    expect(top(keep(head, 30))).toEqual(top(head));
  });

  it("takes the number to keep as its second argument and refuses one that is not a number", () => {
    const head = branchWith([1, 2, 3, 4]);
    expect(top(keep(head, 2))).toEqual(["README.md", "pr-3", "pr-4"]);
    expect(() => keep(head, "x" as unknown as number)).toThrow();
  });
});
