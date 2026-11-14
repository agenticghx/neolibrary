#!/usr/bin/env node
// Checks pages of the live site as a reader's iPad would load them: in Safari's engine (WebKit) at iPad size, and
// in Chromium for comparison. Reads only, signed out: it opens each page, waits for its pictures, and prints the
// answer's status, how long the pictures took, how many were fetched at once, and any request or script that failed.
//
//   node scripts/live-webkit-check.mjs <site> [path ...]        e.g.  <site> /browse /sign-in
//
// Written for Claude sessions (version 2, check 2: every change a reader sees is checked on the live site in WebKit
// at iPad size). Paste the output in the pull request or the ledger. A signed-in page needs Samuel's own browser;
// this script never signs in and never moves a reading place.
//
// Why "fetched at once" is printed: on 2026-11-11 the open shelf's 129 covers took 12 s in WebKit and 3 s in
// Chromium because WebKit fetched them two at a time (a "Link" response header, and an empty server memory, each
// caused it). The time alone would not have said why.
import { chromium, webkit } from "playwright";

const [site, ...paths] = process.argv.slice(2);
if (!site) {
  console.error("Usage: node scripts/live-webkit-check.mjs <site> [path ...]");
  process.exit(2);
}
const base = site.replace(/\/$/, "");
let failures = 0;

for (const [name, type] of [["webkit", webkit], ["chromium", chromium]]) {
  const browser = await type.launch();
  for (const path of paths.length ? paths : ["/browse", "/sign-in"]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 1024 } }); // a new visitor: nothing saved
    const page = await context.newPage();
    const failed = [];
    const errors = [];
    // A request the browser itself gave up (a link fetched ahead of time, dropped when the page closes) is not a failure.
    page.on("requestfailed", (r) => {
      const why = r.failure()?.errorText ?? "failed";
      if (!/ABORTED|cancell?ed/i.test(why)) failed.push(`${r.method()} ${new URL(r.url()).pathname} (${why})`);
    });
    page.on("response", (r) => {
      if (r.status() >= 400 && new URL(r.url()).origin === base) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
    const t0 = Date.now();
    // "domcontentloaded", not "load": a page of many pictures can take long to finish loading, and that is measured below.
    const answer = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch((e) => ({ status: () => `no answer: ${String(e.message).slice(0, 80)}` }));
    let pictures = { n: 0, loaded: 0 };
    while (Date.now() - t0 < 60_000) {
      pictures = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll("img")];
        return { n: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
      });
      if (pictures.loaded === pictures.n) break;
      await page.waitForTimeout(100);
    }
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    // Of the pictures' requests, how many were on their way at the same moment (from the browser's own timing records).
    const atOnce = await page.evaluate(() => {
      const wanted = new Set([...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src));
      const r = performance.getEntriesByType("resource").filter((e) => wanted.has(e.name)).map((e) => ({ q: e.requestStart, e: e.responseEnd }));
      return r.length ? Math.max(...r.map((x) => r.filter((y) => y.q <= (x.q + x.e) / 2 && y.e >= (x.q + x.e) / 2).length)) : 0;
    });
    // The pictures' size in all: on a slow connection the time is the size divided by the connection's speed, whatever
    // the site does (2026-11-11: 4.7 MB of covers took 10 to 19 s on a laptop connection that measured 1 MB a second).
    const megabytes = await page.evaluate(() => {
      const wanted = new Set([...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src));
      const bytes = performance.getEntriesByType("resource").filter((e) => wanted.has(e.name)).reduce((n, e) => n + (e.encodedBodySize || e.transferSize || 0), 0);
      return (bytes / 1e6).toFixed(1);
    });
    const worker = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)).catch(() => false);
    // A signed-out visitor is sent to the sign-in page from every private page (and from a page that does not exist).
    const landed = new URL(page.url()).pathname;
    const ok = answer.status() === 200 && pictures.loaded === pictures.n && !failed.length && !errors.length;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "ok  " : "LOOK"} ${name} ${path}${landed === path ? "" : ` (sent on to ${landed})`}: status ${answer.status()}; ${pictures.loaded} of ${pictures.n} pictures after ${took} s` +
        `${pictures.n ? `, up to ${atOnce} fetched at once, ${megabytes} MB in all` : ""}; service worker ${worker ? "in control" : "not in control (first visit)"}` +
        `${failed.length ? `; failed requests: ${[...new Set(failed)].slice(0, 5).join(", ")}` : ""}${errors.length ? `; script errors: ${errors.slice(0, 3).join(" | ")}` : ""}`,
    );
    await context.close();
  }
  await browser.close();
}
process.exit(failures ? 1 : 0);
