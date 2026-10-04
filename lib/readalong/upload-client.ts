import { zipSync } from "fflate";
import { sha256OfBlob } from "./sha256";

/**
 * M13 (c3): sending a read-along package from the browser.
 *
 * The reader picks the package folder (made on the laptop by the
 * `readalong-audio` skill). Only the files the manifest names are zipped
 * (scripts, timings, checks, book map) and sent in one request; the server
 * checks them and says which audio files it still needs (`waitingFor`). Each
 * audio file is first checked here against the manifest's fingerprint, then
 * sent in parts of `partBytes` (8 MB), so no request carries a whole
 * audiobook; then the import is finished. A .zip of the package (up to
 * 200 MB) is accepted too, for browsers that cannot pick a folder (phones).
 *
 * No browser APIs beyond fetch and Blob, so it runs in tests under Node.
 * Fingerprints are computed 8 MB at a time (sha256.ts), never holding a
 * whole audiobook in memory.
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
  | { stage: "fingerprints"; totalBytes: number }
  | { stage: "sending-zip"; totalBytes: number }
  | { stage: "sending"; file: string; sentBytes: number; totalBytes: number }
  | { stage: "finishing" }
  | { stage: "done"; summary: ImportSummary };

export class UploadError extends Error {}

/** The most one request may carry: the server's limit for the package zip (MAX_ZIP_BYTES). */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
/** Waits between tries after a dropped connection: about a minute in all (a Wi-Fi reconnect, a short sleep). */
export const RETRY_WAITS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
/** How long to keep asking whether a "finish" whose answer was lost went through. */
const FINISH_POLLS = 40;
const FINISH_POLL_MS = 3000;

const ignored = (path: string) => path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");

/**
 * The package's files with paths relative to its manifest.json, from what a
 * folder picker gives (`webkitRelativePath` such as
 * "kuhn-readalong/timings/01.json"). If the reader picked a parent folder,
 * the shallowest manifest.json decides which folder is the package; two
 * packages side by side are refused rather than one picked by chance.
 */
export function packageFiles(files: { name: string; webkitRelativePath?: string; blob: Blob }[]): PickedFile[] {
  const all = files.map((f) => ({ path: (f.webkitRelativePath || f.name).replace(/\\/g, "/"), blob: f.blob })).filter((f) => !ignored(f.path));
  const roots = all
    .filter((f) => f.path === "manifest.json" || f.path.endsWith("/manifest.json"))
    .map((m) => m.path.slice(0, -"manifest.json".length));
  if (!roots.length) throw new UploadError("This folder has no manifest.json. Choose the read-along folder itself (the one the readalong-audio skill made).");
  const depth = (r: string) => r.split("/").length;
  const shallowest = Math.min(...roots.map(depth));
  const candidates = roots.filter((r) => depth(r) === shallowest);
  if (candidates.length > 1) {
    const names = candidates.map((r) => r.replace(/\/$/, "").split("/").pop()).join(", ");
    throw new UploadError(`This folder holds several read-along packages (${names}). Choose one of them.`);
  }
  const root = candidates[0];
  return all.filter((f) => f.path.startsWith(root)).map((f) => ({ path: f.path.slice(root.length), blob: f.blob }));
}

type Manifest = {
  audio?: { file: string; sha256: string }[];
  chapters?: { script: string; timings: string; check?: string | null }[];
  book_map?: string;
};

/**
 * Splits a package into what goes in the zip and the audio files. Only the
 * files the manifest names are zipped: a folder rebuilt in place can hold
 * stale audio or other files nobody needs to send.
 */
export async function splitPackage(files: PickedFile[]) {
  const byPath = new Map(files.map((f) => [f.path, f.blob]));
  const manifestBlob = byPath.get("manifest.json");
  if (!manifestBlob) throw new UploadError("This folder has no manifest.json.");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await manifestBlob.text()) as Manifest;
  } catch {
    throw new UploadError("manifest.json in this folder is not readable.");
  }
  const named = ["manifest.json", manifest.book_map ?? "book-map.json"];
  for (const c of manifest.chapters ?? []) named.push(c.script, c.timings, ...(c.check ? [c.check] : []));
  const audioList = manifest.audio ?? [];
  const missing = [...named, ...audioList.map((a) => a.file)].filter((p) => !byPath.has(p));
  if (missing.length) throw new UploadError(`The folder is missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " and more" : ""}, which the package lists.`);
  const rest = [...new Set(named)].map((path) => ({ path, blob: byPath.get(path)! }));
  const audio = new Map(audioList.map((a) => [a.file, byPath.get(a.file)!]));
  const fingerprints = new Map(audioList.map((a) => [a.file, a.sha256]));
  return { rest, audio, fingerprints };
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

const CANCELLED = "The upload was cancelled.";

/**
 * Sends a package. `files` is either the folder's files (see packageFiles) or
 * a single .zip of the package. Calls onProgress as it goes; resolves with
 * the finished import. Cancel with `signal`.
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
  const stopIfCancelled = () => {
    if (opts.signal?.aborted) throw new UploadError(CANCELLED);
  };
  /** A request, tried again after a dropped connection (never after an answer from the server). */
  const send = async (url: string, init: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      stopIfCancelled();
      try {
        return await doFetch(url, { ...init, signal: opts.signal });
      } catch {
        stopIfCancelled();
        if (attempt >= RETRY_WAITS_MS.length) throw new UploadError("The connection dropped and did not come back. Choose the folder again to start over.");
        await wait(RETRY_WAITS_MS[attempt]);
      }
    }
  };

  progress({ stage: "checking" });
  let body: Uint8Array | Blob;
  let audio = new Map<string, Blob>();
  if (files.length === 1 && /\.zip$/i.test(files[0].path)) {
    if (files[0].blob.size > MAX_ZIP_BYTES) throw new UploadError("This .zip is larger than 200 MB. Choose the package folder instead, so the audio can be sent in parts.");
    body = files[0].blob;
    progress({ stage: "sending-zip", totalBytes: files[0].blob.size });
  } else {
    const split = await splitPackage(files);
    audio = split.audio;
    // Check the audio here first: a changed file would otherwise be found only
    // after minutes of sending, at the last step.
    progress({ stage: "fingerprints", totalBytes: [...audio.values()].reduce((n, b) => n + b.size, 0) });
    for (const [file, blob] of audio) {
      stopIfCancelled();
      const print = await sha256OfBlob(blob, 8 * 1024 * 1024, opts.signal).catch(() => stopIfCancelled());
      if (print !== split.fingerprints.get(file)) {
        throw new UploadError(`${file} is not the audio this package was made with (its fingerprint differs). Make the package again with the readalong-audio skill.`);
      }
    }
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
    summary = await finish(summary.id, parts);
  }
  progress({ stage: "done", summary });
  return summary;

  /**
   * The last step. It is slow (the server re-reads every audio file to check
   * it) and is never sent twice: if its answer is lost, ask whether it went
   * through instead.
   */
  async function finish(id: string, list: typeof parts): Promise<ImportSummary> {
    stopIfCancelled();
    let res: Response | null = null;
    try {
      res = await doFetch(`${base}/${id}/finish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parts: list }), signal: opts.signal });
    } catch {
      stopIfCancelled();
    }
    if (res) return (await json(res)).import as ImportSummary;
    for (let i = 0; i < FINISH_POLLS; i++) {
      await wait(FINISH_POLL_MS);
      stopIfCancelled();
      const listed = await doFetch(base, { signal: opts.signal }).then(json).catch(() => null);
      const found = (listed?.imports as ImportSummary[] | undefined)?.find((x) => x.id === id);
      if (found?.status === "ready") return found;
    }
    throw new UploadError("The last step did not answer. Reload the page in a minute to see whether the audiobook was saved.");
  }
}

/** "3,162 of 3,180 spoken words placed on the page (99%)" for a finished import. */
export function placedWords(summary: Pick<ImportSummary, "report">) {
  const spoken = summary.report.chapters.reduce((n, c) => n + c.spokenWords, 0);
  const placed = summary.report.chapters.reduce((n, c) => n + c.matchedWords, 0);
  const pct = spoken ? Math.floor((placed / spoken) * 100) : 0;
  return { spoken, placed, pct, text: `${placed.toLocaleString("en-US")} of ${spoken.toLocaleString("en-US")} spoken words placed on the page (${pct}%)` };
}

/** "75 of 201 MB" */
export const megabytes = (sent: number, total: number) => `${Math.round(sent / 1024 / 1024)} of ${Math.max(1, Math.round(total / 1024 / 1024))} MB`;

/** "201 MB" */
export const size = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
