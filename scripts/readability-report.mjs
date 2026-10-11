#!/usr/bin/env node
// The readability experiment (M21, docs/readability-experiment.md). Written for: Samuel and Claude sessions.
//
// Reads Samuel's own rewrites of The Grid, which are NOT in git (the book is copyrighted), and prints,
// per style, how the Flesch-Kincaid grade and Flesch reading ease of each piece changed from the
// original to its rewrite. It prints numbers only and writes no file: no book text leaves the folder.
//
// Run (Node 22.18 or later, which loads the .ts file directly):
//   node scripts/readability-report.mjs [book folder] [chapter 1 folder] [--json]
// Defaults: ~/Documents/neolibrary-grid-book and ~/Documents/neolibrary-grid-ch1/rewrites.
//
// Where things are (see the book folder's README.md): sections.json holds every piece of the book as
// the app has it (id, text); <unit>/rewrite-<style>.md holds the rewrites, one "## <piece id>" block
// each, with the meaning-choice notes after a "---notes---" line. Chapter 1 sits in its own folder.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

process.removeAllListeners("warning"); // Node's note that the .ts file below has no "type" in package.json
const { measure } = await import("../lib/library/readability.ts");

const args = process.argv.slice(2);
const json = args.includes("--json");
const [bookArg, ch1Arg] = args.filter((a) => a !== "--json");
const home = (p) => p.replace(/^~(?=$|\/)/, homedir());
const book = path.resolve(home(bookArg ?? "~/Documents/neolibrary-grid-book"));
const ch1 = path.resolve(home(ch1Arg ?? "~/Documents/neolibrary-grid-ch1/rewrites"));

// The four styles, under the app's names (lib/library/levels.ts); the folder calls STE standard "ste".
const STYLES = [
  ["plain", "plain", "Plain"],
  ["ste-light", "ste-light", "STE light"],
  ["ste-standard", "ste", "STE"],
  ["ste-strict", "ste-strict", "STE strict"],
];

// The pieces that were rewritten: the Introduction (page 7) to the Acknowledgments (page 248), as in the
// folder's scripts/build_book.py.
const page = (id) => Number(/^p-page-(\d+)-/.exec(id)?.[1] ?? NaN);
const sectionsFile = path.join(book, "sections.json");
if (!existsSync(sectionsFile)) {
  console.error(`No sections.json in ${book}: the originals are not there. See that folder's README.md.`);
  process.exit(1);
}
const originals = new Map(
  JSON.parse(readFileSync(sectionsFile, "utf8"))
    .filter((s) => page(s.id) >= 7 && page(s.id) <= 248)
    .map((s) => [s.id, s.text]),
);

/** The rewrites in one rewrite-<style>.md: piece id to text (notes and the checker's block left out). */
function parse(md) {
  const out = new Map();
  for (const block of md.split(/^## /m).slice(1)) {
    const nl = block.indexOf("\n");
    const head = (nl < 0 ? block : block.slice(0, nl)).trim();
    if (/^checker/i.test(head)) continue;
    const body = nl < 0 ? "" : block.slice(nl + 1);
    out.set(head.split(/\s+/)[0], body.split("---notes---")[0].trim());
  }
  return out;
}

function rewritesFor(fileKey) {
  const files = [path.join(ch1, `rewrite-${fileKey}.md`)];
  for (const d of readdirSync(book, { withFileTypes: true })) {
    if (d.isDirectory()) files.push(path.join(book, d.name, `rewrite-${fileKey}.md`));
  }
  const all = new Map();
  for (const f of files.filter((f) => existsSync(f))) for (const [id, text] of parse(readFileSync(f, "utf8"))) all.set(id, text);
  return all;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Joined with a space, not a blank line: pieces are printed pages that often stop mid-sentence, and a blank
// line would end a sentence at every page edge.
const pooled = (texts) => measure(texts.join(" "));

const rows = [];
for (const [style, fileKey, name] of STYLES) {
  const rw = rewritesFor(fileKey);
  const pairs = [];
  let unscored = 0;
  for (const [id, text] of originals) {
    if (!rw.has(id)) continue;
    const a = measure(text);
    const b = measure(rw.get(id));
    if (a && b) pairs.push([a, b]);
    else unscored++;
  }
  const g0 = pairs.map(([a]) => a.grade);
  const g1 = pairs.map(([, b]) => b.grade);
  const e0 = pairs.map(([a]) => a.ease);
  const e1 = pairs.map(([, b]) => b.ease);
  const ids = [...originals.keys()].filter((id) => rw.has(id));
  rows.push({
    style,
    name,
    pieces: pairs.length,
    unscored,
    missing: originals.size - ids.length,
    grade: {
      originalMean: mean(g0),
      originalMedian: median(g0),
      rewriteMean: mean(g1),
      rewriteMedian: median(g1),
      meanDrop: mean(pairs.map(([a, b]) => a.grade - b.grade)),
      shareEasier: pairs.filter(([a, b]) => b.grade < a.grade).length / pairs.length,
    },
    ease: {
      originalMean: mean(e0),
      originalMedian: median(e0),
      rewriteMean: mean(e1),
      rewriteMedian: median(e1),
      meanRise: mean(pairs.map(([a, b]) => b.ease - a.ease)),
      shareEasier: pairs.filter(([a, b]) => b.ease > a.ease).length / pairs.length,
    },
    // The whole text at once (all pieces joined), to compare with scores.md from Samuel's plain_check.py.
    pooled: {
      original: pooled(ids.map((id) => originals.get(id))),
      rewrite: pooled(ids.map((id) => rw.get(id))),
    },
  });
}

// No process.exit: on a pipe, Node may still be writing a large output when the process is cut short.
if (json) console.log(JSON.stringify({ book, ch1, originals: originals.size, rows }, null, 2));
else tables();

function tables() {
  const f1 = (n) => n.toFixed(1);
  const pct = (n) => `${Math.round(n * 100)}%`;
  console.log(`Pieces in the book (pages 7 to 248): ${originals.size}`);
  console.log("");
  console.log("Flesch-Kincaid grade (lower is easier), per piece");
  console.log("");
  console.log("| Style | Pieces | Original mean | Original median | Rewrite mean | Rewrite median | Mean drop | Easier |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const g = r.grade;
    console.log(`| ${r.name} | ${r.pieces} | ${f1(g.originalMean)} | ${f1(g.originalMedian)} | ${f1(g.rewriteMean)} | ${f1(g.rewriteMedian)} | ${f1(g.meanDrop)} | ${pct(g.shareEasier)} |`);
  }
  console.log("");
  console.log("Flesch reading ease (higher is easier), per piece");
  console.log("");
  console.log("| Style | Pieces | Original mean | Original median | Rewrite mean | Rewrite median | Mean rise | Easier |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const e = r.ease;
    console.log(`| ${r.name} | ${r.pieces} | ${f1(e.originalMean)} | ${f1(e.originalMedian)} | ${f1(e.rewriteMean)} | ${f1(e.rewriteMedian)} | ${f1(e.meanRise)} | ${pct(e.shareEasier)} |`);
  }
  console.log("");
  console.log("The whole text at once (all pieces joined), to compare with scores.md");
  console.log("");
  console.log("| Version | Words | Sentences | Words per sentence | Grade | Reading ease |");
  console.log("|---|---:|---:|---:|---:|---:|");
  const line = (name, m) => `| ${name} | ${m.words} | ${m.sentences} | ${f1(m.words / m.sentences)} | ${f1(m.grade)} | ${f1(m.ease)} |`;
  console.log(line("Original", rows[0].pooled.original));
  for (const r of rows) console.log(line(r.name, r.pooled.rewrite));
  const gaps = rows.filter((r) => r.missing || r.unscored);
  if (gaps.length) {
    console.log("");
    for (const r of gaps) console.log(`${r.name}: ${r.missing} pieces without a rewrite, ${r.unscored} with no words to score.`);
  }
}
