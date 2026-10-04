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
