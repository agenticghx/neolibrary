/**
 * "Download for offline" (M12), in the browser. Puts what the reader needs
 * into the caches the service worker (public/sw.js) answers from when the
 * network is gone: the reader page, the book file (by path, since its signed
 * link expires), the book's notes, and the app's own files that the open
 * reader page has loaded (for a PDF, all of the PDF viewer's files too). Cache names must match public/sw.js.
 */
export const BOOKS = "neolibrary-offline-books-v1";
export const ASSETS = "neolibrary-offline-assets-v1";

const readerPath = (bookId: string) => `/books/${bookId}/read`;
const absolute = (path: string) => new URL(path, location.origin).href;

export function offlineSupported() {
  return typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

export async function isDownloaded(bookId: string) {
  if (!offlineSupported()) return false;
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

export async function downloadForOffline(bookId: string, fileUrl: string, fileType: "epub" | "pdf" = "epub") {
  const books = await caches.open(BOOKS);
  const assets = await caches.open(ASSETS);
  const get = async (url: string) => {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error(`Could not download ${new URL(url, location.origin).pathname} (${res.status}).`);
    return res;
  };
  const file = new URL(fileUrl, location.origin);
  await books.put(file.origin + file.pathname, await get(fileUrl));
  await books.put(absolute(`/api/books/${bookId}/annotations`), await get(`/api/books/${bookId}/annotations`));
  const appFiles = loadedAssets();
  if (fileType === "pdf") {
    // Already kept for another PDF: skip those.
    for (const u of await pdfViewerFiles()) if (!(await assets.match(u))) appFiles.push(u);
  }
  await Promise.all([...new Set(appFiles)].map(async (u) => assets.put(u, await get(u))));
  // The page last: its presence means "downloaded".
  await books.put(absolute(readerPath(bookId)), await get(readerPath(bookId)));
}

export async function removeDownload(bookId: string, fileUrl: string) {
  const books = await caches.open(BOOKS);
  const file = new URL(fileUrl, location.origin);
  await books.delete(absolute(readerPath(bookId)));
  await books.delete(file.origin + file.pathname);
  await books.delete(absolute(`/api/books/${bookId}/annotations`));
}

/** Removes every downloaded book from this device (on sign-out). */
export async function clearOffline() {
  if (typeof window === "undefined" || !("caches" in window)) return;
  await Promise.all([caches.delete(BOOKS), caches.delete(ASSETS)]);
}
