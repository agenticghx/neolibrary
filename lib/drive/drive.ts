/**
 * Google Drive as a place to add books from (M30): a link to a file or a folder shared as "Anyone with the link".
 * No Google account, key or sign-in: the public folder view lists a folder's files, and the public download address
 * sends a file. Only the id is taken from what the reader pastes; every address fetched is built here, on Google's
 * own hosts, so a pasted link can never send the server anywhere else.
 */
export type DriveLink = { kind: "file" | "folder"; id: string };
export type DriveFile = { id: string; name: string };

export class DriveError extends Error {}

/** What reaches Google, behind an interface so tests use a fake (ground rule 3). */
export interface DriveSource {
  /** The files (not subfolders) directly in a shared folder. */
  list(folderId: string): Promise<DriveFile[]>;
  /** A shared file's bytes and name, at most `maxBytes`. */
  download(fileId: string, maxBytes: number): Promise<{ name: string; bytes: Uint8Array }>;
}

const ID = /^[\w-]{10,200}$/;
const HOSTS = new Set(["drive.google.com", "drive.usercontent.google.com", "docs.google.com"]);

/** A Drive share link to a file or a folder, or null when it is not one. */
export function parseDriveLink(link: string): DriveLink | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname)) return null;
  const folder = /\/folders\/([\w-]+)/.exec(url.pathname)?.[1];
  if (folder && ID.test(folder)) return { kind: "folder", id: folder };
  const file = /\/(?:file\/)?d\/([\w-]+)/.exec(url.pathname)?.[1] ?? url.searchParams.get("id") ?? "";
  if (file && ID.test(file)) return { kind: "file", id: file };
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

/** The files in Google's public folder view (exported for tests): each entry links to /file/d/<id>; folders do not. */
export function filesInFolderView(html: string): DriveFile[] {
  const out: DriveFile[] = [];
  for (const m of html.matchAll(/<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]*)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g)) {
    const [, id, href, title] = m;
    if (!/\/file\/d\//.test(href) || !ID.test(id)) continue;
    out.push({ id, name: decode(title).trim() });
  }
  return out;
}

/** The file name in a Content-Disposition header (exported for tests). */
export function nameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim());
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]+)"/.exec(header)?.[1] ?? /filename=([^;]+)/.exec(header)?.[1]?.trim() ?? null;
}

/** Reads a response body up to `max` bytes; refuses a bigger one without reading it all. */
async function bodyAtMost(res: Response, max: number) {
  const length = Number(res.headers.get("content-length"));
  if (length > max) throw new DriveError(`This file is larger than ${Math.round(max / 1024 / 1024)} MB.`);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new DriveError(`This file is larger than ${Math.round(max / 1024 / 1024)} MB.`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const NOT_SHARED = "Google Drive did not send this. Share it as “Anyone with the link” (Share → General access), then try again.";

/** The real Google Drive, through its public addresses. */
export class PublicDrive implements DriveSource {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async list(folderId: string) {
    if (!ID.test(folderId)) throw new DriveError("That is not a Google Drive folder link.");
    const res = await this.fetchFn(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`, { redirect: "follow" });
    if (!res.ok) throw new DriveError(NOT_SHARED);
    const html = await res.text();
    if (!/class="flip-entries"|class="flip-entry"/.test(html)) throw new DriveError(NOT_SHARED);
    return filesInFolderView(html);
  }

  async download(fileId: string, maxBytes: number) {
    if (!ID.test(fileId)) throw new DriveError("That is not a Google Drive file link.");
    // confirm=t: a big file is sent at once, not after Google's "can't scan this file for viruses" page.
    const res = await this.fetchFn(`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`, { redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    // Not shared, or no such file: Google answers with a web page, not the file.
    if (!res.ok || type.startsWith("text/html")) throw new DriveError(NOT_SHARED);
    const name = nameFromDisposition(res.headers.get("content-disposition")) ?? `${fileId}.bin`;
    return { name, bytes: await bodyAtMost(res, maxBytes) };
  }
}
