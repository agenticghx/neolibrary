// Neolibrary's service worker (M12): a small script the browser keeps running
// in the background, so a book downloaded "for offline" opens with no network.
//
// The rule: always ask the network first. Only when the network fails does it
// answer from the cache, and only with what the reader downloaded (the
// reader page, the book file, its notes) and the app's own files. Nothing
// else is cached, so online behaviour is unchanged. Audio is passed straight
// through (it needs byte ranges).
const BOOKS = "neolibrary-offline-books-v1";
const ASSETS = "neolibrary-offline-assets-v1";

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
    event.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok) {
            const cache = await caches.open(BOOKS);
            if (await cache.match(url.origin + path)) await cache.put(url.origin + path, res.clone());
          }
          return res;
        })
        .catch(() => fromCache(BOOKS, url.origin + path)),
    );
    return;
  }
  // The app's own files (scripts, styles, fonts): network first, cache when offline.
  if (path.startsWith("/_next/static/") || path.startsWith("/fonts/") || path.startsWith("/pdfjs/")) {
    event.respondWith(fetch(req).catch(() => fromCache(ASSETS, req.url)));
  }
});
