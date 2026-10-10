// Writes the paragraphs the app finds in a PDF, exactly as it reads them
// (pdf.js with the reader's character maps, lib/library/pdf-sections.ts), so
// the laptop's read-along tools check a narration script against the app's
// own text (docs/pdf-narration-plan.md, Part D step 3):
//   map_to_book.py BOOK.pdf OUT.json SCRIPTS... --app-text paragraphs.json
// Run: node scripts/pdf-paragraphs.mjs BOOK.pdf paragraphs.json
// Needs Node 22.18 or newer (it loads the app's TypeScript file directly).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [pdf, out] = process.argv.slice(2);
if (!pdf || !out) {
  console.error("usage: node scripts/pdf-paragraphs.mjs BOOK.pdf OUT.json");
  process.exit(2);
}
const bytes = new Uint8Array(readFileSync(resolve(pdf)));
const outPath = resolve(out);
// pdf.js's fonts and character maps are found from the repository's root, as in the app.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const { extractPdfSections, toolParagraphs } = await import("../lib/library/pdf-sections.ts");
const paragraphs = toolParagraphs(await extractPdfSections(bytes));
const book = { file: basename(pdf), sha256: createHash("sha256").update(bytes).digest("hex") };
writeFileSync(outPath, JSON.stringify({ format: "neolibrary-pdf-paragraphs/1", book, paragraphs }, null, 1));
const pages = new Set(paragraphs.map((p) => p.page)).size;
console.log(`${paragraphs.length} paragraphs on ${pages} pages, as the app reads them; wrote ${outPath}`);
