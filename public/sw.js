// Neolibrary's service worker (M12): a small script the browser keeps running
// in the background, so a book downloaded "for offline" opens with no network.
//
// The rule: always ask the network first. Only when the network fails does it
// answer from the cache, and only with what the reader downloaded (the
// reader page, the book file, its notes) and the app's own files. Audio is
// passed straight through (it needs byte ranges).
//
// Two more rules (2026-11-10):
// - Saving to the cache never decides the answer. The network's answer is
//   returned at once and saved afterwards; if saving fails (storage full or
//   blocked) the page still loads.
// - While this device holds a download, the app's own files are saved as
//   they load. A deploy gives the reader page new script files; without this
//   the refreshed page would name files the device never kept, and the book
//   would stop opening offline. The saved files are emptied when the last
//   download is removed (lib/offline.ts) and trimmed to the newest
//   ASSET_LIMIT here.
const BOOKS = "neolibrary-offline-books-v1";
const ASSETS = "neolibrary-offline-assets-v1";

/** The most app files kept. A reader page loads well under a hundred; the PDF viewer adds a few hundred once. */
const ASSET_LIMIT = 1500;

/** Runs cache work whose failure must never reach the page. */
const quietly = (work) => work().catch(() => {});

/** Drops the app files saved longest ago beyond ASSET_LIMIT (a file loaded again moves to the newest end). */
const trimAssets = () =>
  quietly(async () => {
    if (!(await caches.has(ASSETS))) return;
    const cache = await caches.open(ASSETS);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT)).map((k) => cache.delete(k)));
  });
// Each time the browser starts this script again.
void trimAssets();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** The cache key for a book file: its path, without the short-lived signature. */
const fileKey = (url) => url.origin + url.pathname;

async function fromCache(cacheName, key) {
  const cache = await caches.open(cacheName);
  return (await cache.match(key, { ignoreSearch: true })) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  // Book files: the signed link in a cached page has expired, so match on the path.
  if (path.startsWith("/api/files/books/")) {
    event.respondWith(fetch(req).catch(() => fromCache(BOOKS, fileKey(url))));
    return;
  }
  // The reader page and a book's notes: network first; refresh a downloaded copy.
  const isReader = req.mode === "navigate" && /^\/books\/[0-9a-f-]{36}\/read$/.test(path);
  const isNotes = /^\/api\/books\/[0-9a-f-]{36}\/annotations$/.test(path);
  if (isReader || isNotes) {
    const key = url.origin + path;
    event.respondWith(
      fetch(req).then(
        (res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(
              quietly(async () => {
                const cache = await caches.open(BOOKS);
                if (await cache.match(key)) await cache.put(key, copy);
              }),
            );
          }
          return res;
        },
        () => fromCache(BOOKS, key),
      ),
    );
    return;
  }
  // The app's own files (scripts, styles, fonts): network first, cache when offline.
  if (path.startsWith("/_next/static/") || path.startsWith("/fonts/") || path.startsWith("/pdfjs/")) {
    event.respondWith(
      fetch(req).then(
        (res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(
              quietly(async () => {
                // Only a device with a download keeps app files (the cache exists once a book is downloaded).
                if (await caches.has(ASSETS)) await (await caches.open(ASSETS)).put(req.url, copy);
              }),
            );
          }
          return res;
        },
        () => fromCache(ASSETS, req.url),
      ),
    );
  }
});
