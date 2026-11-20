import { clearOwnKeys } from "@/lib/own-keys";

/**
 * "Download for offline" (M12), in the browser. Puts what the reader needs
 * into the caches the service worker (public/sw.js) answers from when the
 * network is gone: the reader page, the book file (by path, since its signed
 * link expires), the book's notes, and the app's own files that the open
 * reader page has loaded (for a PDF, all of the PDF viewer's files too). Cache names must match public/sw.js.
 */
export const BOOKS = "neolibrary-offline-books-v1";
export const ASSETS = "neolibrary-offline-assets-v1";
export const FOCUS_STORAGE_KEY = "neolibrary.focus.v1";

const readerPath = (bookId: string) => `/books/${bookId}/read`;
const absolute = (path: string) => new URL(path, location.origin).href;

export function offlineSupported() {
  return typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

export async function isDownloaded(bookId: string) {
  if (!offlineSupported()) return false;
  if (!(await caches.has(BOOKS))) return false;
  return Boolean(await (await caches.open(BOOKS)).match(absolute(readerPath(bookId))));
}

/** The app's own files this page has loaded (scripts, styles, fonts), to cache with the book. */
function loadedAssets() {
  const urls = new Set<string>();
  for (const e of performance.getEntriesByType("resource")) urls.add(e.name);
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(s.src));
  document.querySelectorAll<HTMLLinkElement>("link[href]").forEach((l) => urls.add(l.href));
  return [...urls].filter((u) => {
    const url = new URL(u, location.origin);
    return url.origin === location.origin && /^\/(_next\/static|fonts|pdfjs)\//.test(url.pathname);
  });
}

/** pdf.js, which shows PDF books: every file of it (about 5 MB, kept once per device). */
async function pdfViewerFiles(): Promise<string[]> {
  const res = await fetch("/pdfjs/files.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not download the PDF viewer.");
  return ((await res.json()) as string[]).map((f) => absolute(`/pdfjs/${f.split("/").map(encodeURIComponent).join("/")}`));
}

export async function downloadForOffline(bookId: string, fileType: "epub" | "pdf" = "epub") {
  const books = await caches.open(BOOKS);
  const assets = await caches.open(ASSETS);
  const get = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error(`Could not download ${new URL(url, location.origin).pathname} (${res.status}).`);
    return res;
  };
  // A fresh link: the one the page opened with lasts five minutes (M20 Q3). Kept by path, so either link finds it.
  const { url } = (await (await get(`/api/books/${bookId}/file-link`)).json()) as { url: string };
  const file = new URL(url, location.origin);
  const fileCacheKey = file.origin + file.pathname;
  const notesCacheKey = absolute(`/api/books/${bookId}/annotations`);
  const pageCacheKey = absolute(readerPath(bookId));
  // If downloading a scan PDF that has a text edition, ?view=scan keeps ReadPage on the scan instead of redirecting to the edition.
  const pageFetchPath = fileType === "pdf" && new URLSearchParams(location.search).get("view") === "scan" ? `${readerPath(bookId)}?view=scan` : readerPath(bookId);
  const hadPage = Boolean(await books.match(pageCacheKey));
  try {
    await books.put(fileCacheKey, await get(url));
    await books.put(notesCacheKey, await get(`/api/books/${bookId}/annotations`));
    const appFiles = loadedAssets();
    if (fileType === "pdf") {
      // Already kept for another PDF: skip those.
      for (const u of await pdfViewerFiles()) if (!(await assets.match(u))) appFiles.push(u);
    }
    const unique = [...new Set(appFiles)];
    let index = 0;
    const workers = Array.from({ length: Math.min(8, unique.length) }, async () => {
      while (index < unique.length) {
        const u = unique[index++];
        await assets.put(u, await get(u));
      }
    });
    await Promise.all(workers);
    // The page last: its presence means "downloaded".
    await books.put(pageCacheKey, await get(pageFetchPath));
  } catch (e) {
    if (!hadPage) {
      await Promise.all([books.delete(fileCacheKey), books.delete(notesCacheKey)]).catch(() => {});
      const pages = (await books.keys()).filter((r) => /\/books\/[0-9a-f-]{36}\/read$/.test(new URL(r.url).pathname));
      if (pages.length === 0) await caches.delete(ASSETS).catch(() => {});
    }
    throw e;
  }
}

export async function removeDownload(bookId: string, fileUrl: string) {
  const books = await caches.open(BOOKS);
  const file = new URL(fileUrl, location.origin);
  await books.delete(absolute(readerPath(bookId)));
  await books.delete(file.origin + file.pathname);
  await books.delete(absolute(`/api/books/${bookId}/annotations`));
  // The last download gone: the app's files kept for offline go too (the service worker stops adding to them).
  const pages = (await books.keys()).filter((r) => /\/books\/[0-9a-f-]{36}\/read$/.test(new URL(r.url).pathname));
  if (pages.length === 0) await caches.delete(ASSETS);
}

/**
 * Removes every downloaded book (and signed-in personal keys / cached focus state) from this device: on the sign-in
 * page (so after signing out) and on any page shown to someone not signed in. Notes waiting to be sent
 * (lib/outbox.ts) are not touched: they wait for their writer.
 */
export async function clearOffline(clearAllKeys = false) {
  if (typeof window === "undefined") return;
  clearOwnKeys(clearAllKeys);
  try {
    localStorage.removeItem(FOCUS_STORAGE_KEY);
  } catch {
    // storage blocked
  }
  if ("caches" in window) await Promise.all([caches.delete(BOOKS), caches.delete(ASSETS)]);
}
