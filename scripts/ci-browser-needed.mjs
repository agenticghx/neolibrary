/**
 * Whether CI's browser job has to run. Docs, the ledger, and workflow files
 * do not change a page. Anything else might (a lib change can change what a
 * browser test sees), so the job runs. An empty list runs it too: a missing
 * file list must not skip the tests.
 *
 * Used by .github/workflows/ci.yml. The unit test imports `browserJobNeeded`.
 */

export function browserJobNeeded(files) {
  const names = files.map((f) => String(f).trim()).filter(Boolean);
  if (!names.length) return true;
  const docsOnly = (f) => f.startsWith("docs/") || f.startsWith(".claude/") || f.startsWith(".github/") || f.endsWith(".md") || f === "LICENSE" || f.startsWith("LICENSE.");
  return names.some((f) => !docsOnly(f));
}

const isMain = process.argv[1] && process.argv[1].endsWith("ci-browser-needed.mjs");
if (isMain) {
  const fs = await import("node:fs");
  const path = process.argv[2];
  const text = path ? fs.readFileSync(path, "utf8") : "";
  console.log(browserJobNeeded(text.split("\n")) ? "yes" : "no");
}
