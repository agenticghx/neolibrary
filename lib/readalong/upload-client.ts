import { zipSync } from "fflate";

/**
 * M13 (c3): sending a read-along package from the browser.
 *
 * The reader picks the package folder (made on the laptop by the
 * `readalong-audio` skill). Everything except the audio is zipped and sent in
 * one request; the server checks it and says which audio files it still needs
 * (`waitingFor`). Each of those is sent in parts of `partBytes` (8 MB), so no
 * request carries a whole audiobook, and the import is finished. A .zip of
 * the package (small enough to send at once) is accepted too, for browsers
 * that cannot pick a folder (phones).
 *
 * No browser APIs beyond fetch and Blob, so it runs in tests under Node.
 */
export type PickedFile = { path: string; blob: Blob };

export type ImportSummary = {
  id: string;
  status: "uploading" | "ready";
  title: string | null;
  voice: string | null;
  madeWith: string | null;
  createdAt: string;
  finishedAt: string | null;
  report: { chapters: { n: number; title: string; spokenWords: number; matchedWords: number }[]; paragraphs: number };
  waitingFor: string[];
};

export type UploadProgress =
  | { stage: "checking" }
  | { stage: "sending"; file: string; sentBytes: number; totalBytes: number }
  | { stage: "finishing" }
  | { stage: "done"; summary: ImportSummary };

export class UploadError extends Error {}

/** The most one request may carry: the server's limit for the package zip (MAX_ZIP_BYTES). */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const RETRIES = 3;

const ignored = (path: string) => path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

/**
 * The package's files with paths relative to its manifest.json, from what a
 * folder picker gives (`webkitRelativePath` such as
 * "kuhn-readalong/timings/01.json"). If the reader picked a parent folder,
 * the shallowest manifest.json decides which folder is the package.
 */
export function packageFiles(files: { name: string; webkitRelativePath?: string; blob: Blob }[]): PickedFile[] {
  const all = files.map((f) => ({ path: (f.webkitRelativePath || f.name).replace(/\\/g, "/"), blob: f.blob })).filter((f) => !ignored(f.path));
  const manifests = all.filter((f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"));
  if (!manifests.length) throw new UploadError("This folder has no manifest.json. Choose the read-along folder itself (the one the readalong-audio skill made).");
  const root = manifests.map((m) => m.path.slice(0, -"manifest.json".length)).sort((a, b) => a.split("/").length - b.split("/").length)[0];
  return all.filter((f) => f.path.startsWith(root)).map((f) => ({ path: f.path.slice(root.length), blob: f.blob }));
}

/** Splits a package into what goes in the zip and the audio files the manifest lists. */
export async function splitPackage(files: PickedFile[]) {
  const manifest = files.find((f) => f.path === "manifest.json");
  if (!manifest) throw new UploadError("This folder has no manifest.json.");
  let audioPaths: string[];
  try {
    audioPaths = (JSON.parse(await manifest.blob.text()) as { audio?: { file: string }[] }).audio?.map((a) => a.file) ?? [];
  } catch {
    throw new UploadError("manifest.json in this folder is not readable.");
  }
  const audio = new Map(files.filter((f) => audioPaths.includes(f.path)).map((f) => [f.path, f.blob]));
  const missing = audioPaths.filter((p) => !audio.has(p));
  if (missing.length) throw new UploadError(`The folder is missing ${missing.join(", ")}, which the package lists.`);
  const rest = files.filter((f) => !audio.has(f.path));
  return { rest, audio };
}

async function zipOf(files: PickedFile[]) {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.path] = new Uint8Array(await f.blob.arrayBuffer());
  return zipSync(entries, { level: 6 });
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function json(res: Response) {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!res.ok) throw new UploadError(body.error ?? `The server said ${res.status}.`);
  return body;
}

/**
 * Sends a package. `files` is either the folder's files (see packageFiles) or
 * a single .zip of the package. Calls onProgress as it goes; resolves with
 * the finished import.
 */
export async function uploadPackage(
  bookId: string,
  files: PickedFile[],
  opts: { fetch?: Fetch; onProgress?: (p: UploadProgress) => void; signal?: AbortSignal; wait?: (ms: number) => Promise<void> } = {},
): Promise<ImportSummary> {
  const doFetch: Fetch = opts.fetch ?? ((i, init) => fetch(i, init));
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const progress = opts.onProgress ?? (() => {});
  const base = `/api/books/${bookId}/readalong`;
  const send = async (url: string, init: RequestInit) => {
    // A dropped connection is retried a few times; an answer from the server is not.
    for (let attempt = 1; ; attempt++) {
      try {
        return await doFetch(url, { ...init, signal: opts.signal });
      } catch {
        if (opts.signal?.aborted || attempt >= RETRIES) throw new UploadError("The connection dropped while sending. Choose the folder again to retry.");
        await wait(1000 * attempt);
      }
    }
  };

  progress({ stage: "checking" });
  let body: Uint8Array | Blob;
  let audio = new Map<string, Blob>();
  if (files.length === 1 && /\.zip$/i.test(files[0].path)) {
    if (files[0].blob.size > MAX_ZIP_BYTES) throw new UploadError("This .zip is larger than 200 MB. Choose the package folder instead, so the audio can be sent in parts.");
    body = files[0].blob;
  } else {
    const split = await splitPackage(files);
    audio = split.audio;
    body = await zipOf(split.rest);
  }
  const started = await json(await send(base, { method: "POST", headers: { "content-type": "application/zip" }, body: body as BodyInit }));
  let summary = started.import as ImportSummary;
  const partBytes = Number(started.partBytes) || 8 * 1024 * 1024;

  const parts: Record<string, { part: number; tag: string }[]> = {};
  const totalBytes = summary.waitingFor.reduce((n, f) => n + (audio.get(f)?.size ?? 0), 0);
  let sentBytes = 0;
  for (const file of summary.waitingFor) {
    const blob = audio.get(file);
    if (!blob) throw new UploadError(`The server is waiting for ${file}, which is not in what you chose. Choose the package folder rather than a .zip.`);
    parts[file] = [];
    progress({ stage: "sending", file, sentBytes, totalBytes });
    for (let at = 0, n = 1; at < blob.size; at += partBytes, n++) {
      const piece = blob.slice(at, Math.min(blob.size, at + partBytes));
      const url = `${base}/${summary.id}/parts?${new URLSearchParams({ file, part: String(n) })}`;
      parts[file].push((await json(await send(url, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: piece }))) as { part: number; tag: string });
      sentBytes += piece.size;
      progress({ stage: "sending", file, sentBytes, totalBytes });
    }
  }
  if (summary.status !== "ready") {
    progress({ stage: "finishing" });
    summary = (await json(await send(`${base}/${summary.id}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parts }) }))).import as ImportSummary;
  }
  progress({ stage: "done", summary });
  return summary;
}

/** "3,162 of 3,180 spoken words placed (99%)" for a finished import. */
export function placedWords(summary: Pick<ImportSummary, "report">) {
  const spoken = summary.report.chapters.reduce((n, c) => n + c.spokenWords, 0);
  const placed = summary.report.chapters.reduce((n, c) => n + c.matchedWords, 0);
  const pct = spoken ? Math.floor((placed / spoken) * 100) : 0;
  return { spoken, placed, pct, text: `${placed.toLocaleString("en-US")} of ${spoken.toLocaleString("en-US")} spoken words placed on the page (${pct}%)` };
}

/** "75 of 201 MB" */
export const megabytes = (sent: number, total: number) => `${Math.round(sent / 1024 / 1024)} of ${Math.max(1, Math.round(total / 1024 / 1024))} MB`;
