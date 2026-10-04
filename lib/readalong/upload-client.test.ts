import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { audioTracks } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { getSections } from "@/lib/library/sections-store";
import { MemoryStorage } from "@/lib/storage";
import { buildPackage, type FixtureChapter } from "./fixture";
import { finishImport, listImports, putAudioPart, ReadalongError, startImport } from "./importer";
import { abortableWait, packageFiles, placedWords, RETRY_WAITS_MS, splitPackage, uploadPackage, type UploadProgress } from "./upload-client";

/**
 * M13 (c3): the browser side of sending a read-along package. The network is
 * replaced by a stand-in that calls the real importer (real database in
 * memory), so these tests show the browser code and the server code fit.
 */

/**
 * Like the real bucket: every part gets an unguessable tag, joining checks
 * the tags, and every part except the last must be at least the minimum
 * size (5 MB on S3; PART here, the test's part size).
 */
class BucketLikeStorage extends MemoryStorage {
  private tags = new Map<string, string>();
  private sizes = new Map<string, number>();
  override async putPart(key: string, uploadId: string, part: number, data: Uint8Array) {
    await super.putPart(key, uploadId, part, data);
    const tag = `"${crypto.randomUUID()}"`;
    this.tags.set(`${uploadId}:${part}`, tag);
    this.sizes.set(`${uploadId}:${part}`, data.byteLength);
    return tag;
  }
  override async finishUpload(key: string, uploadId: string, parts: { part: number; tag: string }[]) {
    if (parts.some((p) => this.tags.get(`${uploadId}:${p.part}`) !== p.tag)) throw new Error("InvalidPart: a tag does not match");
    if (parts.slice(0, -1).some((p) => (this.sizes.get(`${uploadId}:${p.part}`) ?? 0) < PART)) throw new Error("EntityTooSmall: a part before the last is too small");
    return super.finishUpload(key, uploadId, parts);
  }
}

let database: Database;
let storage: BucketLikeStorage;
let ownerId: string;
let bookId: string;
let bookBytes: Uint8Array;
let paragraphs: { id: string; text: string; chapterIndex: number }[];
let calls: { method: string; path: string; body?: BodyInit | null }[];
let failNext = 0;
let loseNextFinishAnswer = false;

const PART = 3000; // small parts, so a test file needs several

beforeEach(async () => {
  database = await testDatabase();
  storage = new BucketLikeStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookBytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: bookBytes })).bookId;
  paragraphs = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
  calls = [];
  failNext = 0;
  loseNextFinishAnswer = false;
});
afterEach(() => database.raw.close());

/** The server, without HTTP: the same calls the API routes make. */
async function server(url: string, init: RequestInit = {}) {
  const u = new URL(url, "http://test");
  const method = init.method ?? "GET";
  calls.push({ method, path: u.pathname, body: init.body });
  if (failNext > 0) {
    failNext--;
    throw new TypeError("Failed to fetch");
  }
  const m = /^\/api\/books\/([^/]+)\/readalong(?:\/([^/]+)\/(parts|finish))?$/.exec(u.pathname)!;
  const bytes = async () => new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
  try {
    if (!m[2] && method === "GET") return Response.json({ imports: await listImports(database.db, ownerId, m[1]), partBytes: PART });
    if (!m[2]) return Response.json({ import: await startImport(database.db, storage, ownerId, m[1], await bytes()), partBytes: PART }, { status: 201 });
    if (m[3] === "parts") return Response.json(await putAudioPart(database.db, storage, ownerId, m[1], m[2], u.searchParams.get("file")!, Number(u.searchParams.get("part")), await bytes()));
    const done = await finishImport(database.db, storage, ownerId, m[1], m[2], JSON.parse(String(init.body)).parts);
    if (loseNextFinishAnswer) {
      loseNextFinishAnswer = false;
      throw new TypeError("Failed to fetch"); // the server finished, the answer was lost
    }
    return Response.json({ import: done });
  } catch (e) {
    if (e instanceof ReadalongError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** What a folder picker gives for a package folder named `name`. */
function pickedFolder(files: Record<string, Uint8Array>, name = "jekyll-readalong") {
  return Object.entries(files).map(([path, data]) => ({ name: path.split("/").pop()!, webkitRelativePath: `${name}/${path}`, blob: new Blob([data as BlobPart]) }));
}

function chapterOf(from: number, n: number): FixtureChapter {
  const read = paragraphs.slice(from, from + n);
  return { title: `Paragraphs ${from}-${from + n - 1}`, paragraphs: read.map((p) => p.text), inBook: read.map((p) => p.chapterIndex) };
}

function pkg(n = 3, bytes = bookBytes) {
  const read = paragraphs.slice(30, 30 + n);
  return buildPackage({ bookBytes: bytes, chapters: [{ title: "Chapter", paragraphs: ["Chapter Four.", ...read.map((p) => p.text)], inBook: [null, ...read.map((p) => p.chapterIndex)] }] });
}

const noWait = async () => {};

describe("choosing the package (M13)", () => {
  it("finds the package inside the chosen folder, even when a parent folder was chosen, and skips hidden files", () => {
    const { files } = pkg();
    const flat = packageFiles([...pickedFolder(files), { name: ".DS_Store", webkitRelativePath: "jekyll-readalong/.DS_Store", blob: new Blob(["x"]) }]);
    expect(flat.map((f) => f.path).sort()).toEqual(Object.keys(files).sort());
    const parent = packageFiles(pickedFolder(files).map((f) => ({ ...f, webkitRelativePath: `Downloads/${f.webkitRelativePath}` })));
    expect(parent.map((f) => f.path).sort()).toEqual(Object.keys(files).sort());
    expect(() => packageFiles([{ name: "notes.txt", webkitRelativePath: "x/notes.txt", blob: new Blob(["hi"]) }])).toThrow("This folder has no manifest.json");
  });

  it("refuses a parent folder holding two packages, and names them", () => {
    const { files } = pkg();
    const two = [...pickedFolder(files, "Readalong/aaa-other-book"), ...pickedFolder(files, "Readalong/jekyll")];
    expect(() => packageFiles(two)).toThrow("This folder holds several read-along packages (aaa-other-book, jekyll). Choose one of them.");
  });

  it("zips only the files the manifest names (stale audio left in the folder is not sent), and names a missing one", async () => {
    const { files } = pkg();
    const stale = { ...files, "audio/02.wav": new Uint8Array(5000), "notes/todo.txt": new Uint8Array(10) };
    const { rest, audio } = await splitPackage(packageFiles(pickedFolder(stale)));
    expect([...audio.keys()]).toEqual(["audio/01.wav"]);
    expect(rest.map((f) => f.path).sort()).toEqual(["book-map.json", "manifest.json", "scripts/01.txt", "timings/01.json"]);
    const noScript = Object.fromEntries(Object.entries(files).filter(([n]) => n !== "scripts/01.txt"));
    await expect(splitPackage(packageFiles(pickedFolder(noScript)))).rejects.toThrow("The folder is missing scripts/01.txt");
  });
});

describe("sending the package (M13)", () => {
  it("sends the scripts in one request and the audio in parts, reporting after every part, then finishes", async () => {
    const { files } = pkg();
    const seen: UploadProgress[] = [];
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, onProgress: (p) => seen.push(p) });
    expect(done.status).toBe("ready");
    const size = files["audio/01.wav"].byteLength;
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(Math.ceil(size / PART));
    expect(calls.map((c) => c.method)).toEqual(["POST", ...puts.map(() => "PUT"), "POST"]);
    // The zip holds the scripts and timings, never the audio.
    const zipped = unzipSync(new Uint8Array(await new Response(calls[0].body!).arrayBuffer()));
    expect(Object.keys(zipped).sort()).toEqual(["book-map.json", "manifest.json", "scripts/01.txt", "timings/01.json"]);
    // Progress: checking, fingerprints, one report before the first part and one after each, finishing, done.
    expect(seen.slice(0, 2).map((p) => p.stage)).toEqual(["checking", "fingerprints"]);
    const sending = seen.filter((p) => p.stage === "sending") as Extract<UploadProgress, { stage: "sending" }>[];
    expect(sending).toHaveLength(puts.length + 1);
    expect(sending.at(-1)).toMatchObject({ sentBytes: size, totalBytes: size, file: "audio/01.wav" });
    expect(sending.map((p) => p.sentBytes)).toEqual([...sending.map((p) => p.sentBytes)].sort((a, b) => a - b));
    expect(seen.slice(-2).map((p) => p.stage)).toEqual(["finishing", "done"]);
    expect(await database.db.select().from(audioTracks)).toHaveLength(3);
    expect(placedWords(done).text).toMatch(/^[\d,]+ of [\d,]+ spoken words placed on the page \(\d+%\)$/);
  });

  it("sends a package with one audio file per chapter, with progress running over all of them", async () => {
    const { files } = buildPackage({ bookBytes, chapters: [chapterOf(30, 2), chapterOf(32, 2)] });
    const seen: UploadProgress[] = [];
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, onProgress: (p) => seen.push(p) });
    expect(done.status).toBe("ready");
    const total = files["audio/01.wav"].byteLength + files["audio/02.wav"].byteLength;
    const sending = seen.filter((p) => p.stage === "sending") as Extract<UploadProgress, { stage: "sending" }>[];
    expect(sending.at(-1)).toMatchObject({ sentBytes: total, totalBytes: total });
    expect(sending.map((p) => p.sentBytes)).toEqual([...sending.map((p) => p.sentBytes)].sort((a, b) => a - b));
    expect(new Set(sending.map((p) => p.file))).toEqual(new Set(["audio/01.wav", "audio/02.wav"]));
    expect(await database.db.select().from(audioTracks)).toHaveLength(4);
  });

  it("refuses audio that is not the file the package was made with, before sending anything", async () => {
    const { files } = pkg(1);
    const changed = files["audio/01.wav"].slice();
    changed[changed.length - 1] ^= 1;
    await expect(uploadPackage(bookId, packageFiles(pickedFolder({ ...files, "audio/01.wav": changed })), { fetch: server })).rejects.toThrow(
      "audio/01.wav is not the audio this package was made with (its fingerprint differs). Make the package again with the readalong-audio skill.",
    );
    expect(calls).toEqual([]);
  });

  it("sends a .zip of the whole package in one request (for phones), saying how large it is", async () => {
    const { zip } = pkg(2);
    const blob = new Blob([zip() as BlobPart]);
    const seen: UploadProgress[] = [];
    const done = await uploadPackage(bookId, [{ path: "jekyll-readalong.zip", blob }], { fetch: server, onProgress: (p) => seen.push(p) });
    expect(done.status).toBe("ready");
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    expect(seen.map((p) => p.stage)).toEqual(["checking", "sending-zip", "done"]);
    expect(seen[1]).toEqual({ stage: "sending-zip", totalBytes: blob.size });
  });

  it("refuses a .zip over 50 MB before sending anything", async () => {
    const huge = { path: "big.zip", blob: { size: 201 * 1024 * 1024 } as Blob };
    await expect(uploadPackage(bookId, [huge], { fetch: server })).rejects.toThrow("larger than 50 MB");
    expect(calls).toEqual([]);
  });

  it("retries a dropped connection for about a minute, then gives up in plain words", async () => {
    const { files } = pkg(1);
    const waits: number[] = [];
    failNext = 2;
    const ok = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, wait: async (ms) => void waits.push(ms) });
    expect(ok.status).toBe("ready");
    expect(waits).toEqual(RETRY_WAITS_MS.slice(0, 2));
    calls = [];
    failNext = 100;
    await expect(uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, wait: noWait })).rejects.toThrow(
      "The connection dropped and did not come back. Choose the folder again to start over.",
    );
    expect(calls).toHaveLength(RETRY_WAITS_MS.length + 1);
  });

  it("when the answer to the last step is lost, asks whether it went through instead of sending it again", async () => {
    const { files } = pkg(1);
    loseNextFinishAnswer = true;
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, wait: noWait });
    expect(done.status).toBe("ready");
    expect(calls.filter((c) => c.path.endsWith("/finish"))).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({ method: "GET", path: `/api/books/${bookId}/readalong` });
  });

  it("shows the server's refusal at the last step, and does not say it is done", async () => {
    const { files } = pkg(1);
    const seen: UploadProgress[] = [];
    const refuseFinish = async (url: string, init: RequestInit = {}) =>
      url.endsWith("/finish") ? Response.json({ error: "audio/01.wav could not be put together: a part is missing. Send it again." }, { status: 400 }) : server(url, init);
    await expect(uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: refuseFinish, onProgress: (p) => seen.push(p) })).rejects.toThrow(
      "could not be put together",
    );
    expect(seen.map((p) => p.stage)).not.toContain("done");
    expect((await listImports(database.db, ownerId, bookId)).map((i) => i.status)).toEqual(["uploading"]);
  });

  it("stops when cancelled, leaving an unfinished import the page can remove", async () => {
    const { files } = pkg(3);
    const stop = new AbortController();
    const onProgress = (p: UploadProgress) => {
      if (p.stage === "sending" && p.sentBytes > 0) stop.abort();
    };
    await expect(uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, onProgress, signal: stop.signal })).rejects.toThrow("The upload was cancelled.");
    expect((await listImports(database.db, ownerId, bookId)).map((i) => i.status)).toEqual(["uploading"]);
  });

  it("shows the server's own words when it refuses a package", async () => {
    const { files } = pkg(1, new Uint8Array([9, 9, 9]));
    await expect(uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server })).rejects.toThrow(/made from a different file of this book/);
  });

  it("the zip it sends is a readable package", async () => {
    const { files } = pkg(1);
    await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server });
    const zipped = unzipSync(new Uint8Array(await new Response(calls[0].body!).arrayBuffer()));
    expect(JSON.parse(strFromU8(zipped["manifest.json"])).format).toBe("neolibrary-readalong/1");
  });

  it("reads audio 8 MB at a time to check it and send it, never the whole file at once", async () => {
    const big = buildPackage({ bookBytes, chapters: [chapterOf(40, 100)] }).files; // about 16 MB of audio
    expect(big["audio/01.wav"].byteLength).toBeGreaterThan(9 * 1024 * 1024);
    const picked = packageFiles(pickedFolder(big));
    const audio = picked.find((f) => f.path === "audio/01.wav")!;
    const reads: number[] = [];
    const real = audio.blob;
    audio.blob = {
      size: real.size,
      slice: (a?: number, b?: number) => (reads.push((b ?? real.size) - (a ?? 0)), real.slice(a, b)),
      arrayBuffer: () => Promise.reject(new Error("read the whole file")),
    } as unknown as Blob;
    const real8 = 8 * 1024 * 1024;
    await uploadPackage(bookId, picked, {
      fetch: async (url, init) => {
        const u = new URL(url, "http://test");
        if (u.pathname.endsWith("/readalong") && init?.method === "POST") {
          return Response.json({ import: await startImport(database.db, storage, ownerId, bookId, new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer())), partBytes: real8 }, { status: 201 });
        }
        return server(url, init);
      },
    });
    expect(Math.max(...reads)).toBeLessThanOrEqual(real8);
    expect(reads.length).toBeGreaterThanOrEqual(4); // two reads to check it, two to send it
  });

  it("refuses a changed second audio file too, before sending anything", async () => {
    const { files } = buildPackage({ bookBytes, chapters: [chapterOf(30, 2), chapterOf(32, 2)] });
    const changed = files["audio/02.wav"].slice();
    changed[100] ^= 1;
    await expect(uploadPackage(bookId, packageFiles(pickedFolder({ ...files, "audio/02.wav": changed })), { fetch: server })).rejects.toThrow("audio/02.wav is not the audio");
    expect(calls).toEqual([]);
  });

  it("says plainly when a chosen file cannot be read (moved or changed after choosing), rather than blaming the package", async () => {
    const { files } = pkg(1);
    const picked = packageFiles(pickedFolder(files));
    const audio = picked.find((f) => f.path === "audio/01.wav")!;
    const real = audio.blob;
    audio.blob = {
      size: real.size,
      slice: () => ({ arrayBuffer: () => Promise.reject(new DOMException("The file could not be read.", "NotReadableError")) }),
    } as unknown as Blob;
    await expect(uploadPackage(bookId, picked, { fetch: server })).rejects.toThrow(
      "audio/01.wav could not be read from this computer (was it moved or changed after you chose the folder?). Choose the folder again.",
    );
  });

  it("keeps trying for at least a minute in all", () => {
    expect(RETRY_WAITS_MS.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });

  it("a pause between tries ends at once when the upload is cancelled", async () => {
    const stop = new AbortController();
    const t = Date.now();
    const pause = abortableWait(30_000, stop.signal);
    stop.abort();
    await pause;
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it("tries a part again after a 503 from the hosting's front door (the app restarting)", async () => {
    const { files } = pkg(1);
    let refused = 0;
    const flaky = async (url: string, init: RequestInit = {}) => {
      if (init.method === "PUT" && refused === 0) {
        refused++;
        return new Response("Service Unavailable", { status: 503 });
      }
      return server(url, init);
    };
    expect((await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: flaky, wait: noWait })).status).toBe("ready");
    expect(refused).toBe(1);
  });

  it("sends the last step again if it never reached the server", async () => {
    const { files } = pkg(1);
    let lost = 1;
    const losesFirstFinish = async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/finish") && lost > 0) {
        lost--;
        throw new TypeError("Failed to fetch"); // lost on the way: the server never saw it
      }
      return server(url, init);
    };
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: losesFirstFinish, wait: noWait });
    expect(done.status).toBe("ready");
    expect(calls.filter((c) => c.path.endsWith("/finish"))).toHaveLength(1); // the one that arrived
  });

  it("once the last step has started, Cancel cannot stop it: the server finishes, and the page says so", async () => {
    const { files } = pkg(1);
    const stop = new AbortController();
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), {
      fetch: server,
      signal: stop.signal,
      onProgress: (p) => p.stage === "finishing" && stop.abort(),
    });
    expect(done.status).toBe("ready");
    // Straight from the finish request's answer, not recovered by asking afterwards.
    expect(calls.at(-1)).toMatchObject({ method: "POST" });
    expect(calls.filter((c) => c.method === "GET")).toEqual([]);
  });

  it("a 503 on the last step is not taken as an answer: it asks, then sends it again", async () => {
    const { files } = pkg(1);
    let gateway = 1;
    const frontDoor = async (url: string, init: RequestInit = {}) => {
      if (url.endsWith("/finish") && gateway > 0) {
        gateway--;
        return new Response("Bad Gateway", { status: 502 });
      }
      return server(url, init);
    };
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: frontDoor, wait: noWait });
    expect(done.status).toBe("ready");
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1); // asked once, saw it unfinished and not being finished
  });
});
