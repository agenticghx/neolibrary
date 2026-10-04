// Copies Samuel's STE skill files (the original) into prompts/ste/ (the app's copy)
// and prints which files changed. Override the original's folder with STE_SKILL_DIR.
// Usage: node scripts/sync-ste.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STE_FILES = [
  ["SKILL.md", "SKILL.md"],
  ["references/rules.md", "rules.md"],
  ["references/substitutions.md", "substitutions.md"],
  ["scripts/ste_check.py", "ste_check.py"],
];

const src =
  process.env.STE_SKILL_DIR ||
  join(homedir(), "projects/llm_configs/plugins/bio-skills/skills/simplified-technical-english");
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts", "ste");

if (!existsSync(src)) {
  console.error(`Original STE skill not found at ${src} (set STE_SKILL_DIR).`);
  process.exit(1);
}
let changed = 0;
for (const [from, to] of STE_FILES) {
  const next = readFileSync(join(src, from));
  const target = join(dest, to);
  const prev = existsSync(target) ? readFileSync(target) : null;
  if (prev && prev.equals(next)) {
    console.log(`unchanged  ${to}`);
  } else {
    writeFileSync(target, next);
    changed++;
    console.log(`UPDATED    ${to}  (from ${from})`);
  }
}
console.log(changed ? `${changed} file(s) updated.` : "All 4 files already match the original.");
