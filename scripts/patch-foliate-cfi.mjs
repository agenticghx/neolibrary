// foliate-js 1.0.1 (installed from npm, not copied into this repo) writes a
// CFI, the address of a place in a book, from the page's elements. It can be
// told to look through elements the reader added itself (a "filter" that
// answers FILTER_SKIP), so an address is the same with or without them. The
// reader wraps a paper's citations in such elements (M41 R5) to show them as
// numbers. One spot ignores the filter: a place inside a wrapper was counted
// from the wrapper, not from the paragraph around it, so its address was
// wrong. This makes that spot climb past skipped wrappers, as the rest of the
// file already does. Without a filter nothing changes. A second run does
// nothing; a different foliate version stops here instead of skipping it.
//
//   node scripts/patch-foliate-cfi.mjs [path-to-epubcfi.js]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(root, "node_modules/foliate-js/epubcfi.js");

const from = `const nodeToParts = (node, offset, filter) => {
    const { parentNode, id } = node`;
const to = `const nodeToParts = (node, offset, filter) => {
    const { id } = node
    // A parent the filter skips is looked through, as indexChildNodes does (Neolibrary patch).
    let { parentNode } = node
    while (filter && parentNode?.nodeType === 1 && parentNode !== node.ownerDocument.documentElement
        && filter(parentNode) === NodeFilter.FILTER_SKIP) parentNode = parentNode.parentNode`;

const src = readFileSync(file, "utf8");
if (src.includes("(Neolibrary patch)")) {
  console.log("foliate-js epubcfi.js already looks through skipped wrappers");
  process.exit(0);
}
if (!src.includes(from)) {
  throw new Error("foliate-js epubcfi.js does not match version 1.0.1, so the CFI filter patch was not applied. Update scripts/patch-foliate-cfi.mjs for this version.");
}
writeFileSync(file, src.replace(from, to));
console.log("foliate-js epubcfi.js now looks through skipped wrappers");
