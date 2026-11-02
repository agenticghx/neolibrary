#!/usr/bin/env node
// Fails a pull request that has no new PROGRESS.md Log entry.
// A Log entry is a new line starting with "### " added under "## Log".
// Usage: node scripts/check-pr-hygiene.mjs <base-ref>   (e.g. origin/main)
import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";
// The ledger passed 1 MB on 2026-11-02 (40 entries copied to main), past execFileSync's default 1 MB output limit:
// the check then crashed with "spawnSync git ENOBUFS". 64 MB leaves room for years of entries.
const big = { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
const diff = execFileSync("git", ["diff", "--unified=0", `${base}...HEAD`, "--", "PROGRESS.md"], big);
const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
// A ledger committed with git's conflict markers still "has a new entry"; it happened once (2026-10-07) and was merged.
for (const file of ["PROGRESS.md", "LEARNING_LOG.md"]) {
  const text = execFileSync("git", ["show", `HEAD:${file}`], big);
  const marker = text.split("\n").findIndex((l) => /^(<<<<<<< |=======$|>>>>>>> )/.test(l));
  if (marker >= 0) {
    console.error(`PR hygiene: ${file} line ${marker + 1} is a git conflict marker. Resolve it (keep both sides) before merging.`);
    process.exit(1);
  }
}
const entries = added.filter((l) => /^\+### \d{4}-\d{2}-\d{2}/.test(l));

if (entries.length === 0) {
  console.error(
    "PR hygiene: no new Log entry in PROGRESS.md.\n" +
      "Add one at the top of '## Log' (heading '### YYYY-MM-DD … · who · what') with the five fields. See CLAUDE.md.",
  );
  process.exit(1);
}
console.log(`PR hygiene: found ${entries.length} new Log entr${entries.length === 1 ? "y" : "ies"}:`);
for (const e of entries) console.log("  " + e.slice(1));
