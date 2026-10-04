// Copies pdf.js's worker, character maps and standard fonts into public/pdfjs/
// so the browser can load them from this site (the security policy allows
// only 'self'). Runs before `next build` and `next dev` (see package.json).
import { cp, mkdir } from "node:fs/promises";

const from = "node_modules/pdfjs-dist";
const to = "public/pdfjs";
await mkdir(to, { recursive: true });
await cp(`${from}/legacy/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
await cp(`${from}/cmaps`, `${to}/cmaps`, { recursive: true });
await cp(`${from}/standard_fonts`, `${to}/standard_fonts`, { recursive: true });
console.log("pdf.js assets copied to public/pdfjs");

// The list of these files, so "Download for offline" (lib/offline.ts) can keep
// all of them for reading PDFs with no network: a later page may need a font
// or character map the first pages did not.
import { readdir, writeFile } from "node:fs/promises";
const files = (await readdir(to, { recursive: true, withFileTypes: true }))
  .filter((e) => e.isFile() && e.name !== "files.json")
  .map((e) => `${e.parentPath ?? e.path}/${e.name}`.slice(to.length + 1))
  .sort();
await writeFile(`${to}/files.json`, JSON.stringify(files));
console.log(`public/pdfjs/files.json lists ${files.length} files`);
