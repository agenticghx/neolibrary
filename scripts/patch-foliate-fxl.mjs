// foliate-js 1.0.1 is installed from npm (it is not copied into this repo).
// Its fixed-layout reader has two mistakes that move a PDF to the other
// page of a pair. This rewrites those two spots in node_modules after
// install, and again before dev and build, so a reinstall does not drop
// the fix. A second run does nothing. A different foliate version stops
// here instead of skipping the fix quietly.
//
//   node scripts/patch-foliate-fxl.mjs [path-to-fixed-layout.js]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(root, "node_modules/foliate-js/fixed-layout.js");

// The public `side` is never set, so a pair always reports its right-hand page.
const indexFrom = `        const section = spread?.center ?? (this.side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)`;
const indexTo = `        // \`side\` is never set. The page on screen is \`#side\`.
        const section = spread?.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)`;

// Going to the other page of the open pair painted it once, then a resize
// put the old page back, and no relocate was sent.
const gotoFrom = `        if (index === this.#index) {
            this.#render(side)
            return
        }`;
const gotoTo = `        if (index === this.#index) {
            // A later resize paints \`#side\`. Set it, and say where we are,
            // or the other page of this pair snaps back and the saved place stays put.
            if (side) this.#side = side
            this.#render(side)
            this.#reportLocation(reason)
            return
        }`;

const already = (src) => src.includes("this.#side === 'left'") && src.includes("if (side) this.#side = side");

const src = readFileSync(file, "utf8");
if (already(src)) {
  console.log("foliate-js fixed-layout.js already reports the page on screen");
  process.exit(0);
}
if (!src.includes(indexFrom) || !src.includes(gotoFrom)) {
  throw new Error(
    "foliate-js fixed-layout.js does not match version 1.0.1, so the page-on-screen patch was not applied. Update scripts/patch-foliate-fxl.mjs for this version.",
  );
}
let next = src.replace(indexFrom, indexTo).replace(gotoFrom, gotoTo);
if (!already(next)) {
  throw new Error("foliate-js fixed-layout.js patch did not apply cleanly (version 1.0.1).");
}
writeFileSync(file, next);
console.log("foliate-js fixed-layout.js now reports the page on screen");
