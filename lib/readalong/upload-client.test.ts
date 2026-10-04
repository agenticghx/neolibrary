import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFirstAdmin } from "@/lib/auth/service";
import type { Database } from "@/lib/db/client";
import { audioTracks } from "@/lib/db/schema";
import { testDatabase } from "@/lib/db/test-db";
import { importBook } from "@/lib/library/import";
import { getSections } from "@/lib/library/sections-store";
import { MemoryStorage } from "@/lib/storage";
import { buildPackage } from "./fixture";
import { finishImport, putAudioPart, ReadalongError, startImport } from "./importer";
import { packageFiles, placedWords, splitPackage, uploadPackage, UploadError, type UploadProgress } from "./upload-client";

/**
 * M13 (c3): the browser side of sending a read-along package. The network is
 * replaced by a stand-in that calls the real importer (real database in
 * memory), so these tests show the browser code and the server code fit.
 */
let database: Database;
let storage: MemoryStorage;
let ownerId: string;
let bookId: string;
let bookBytes: Uint8Array;
let paragraphs: { id: string; text: string; chapterIndex: number }[];
let calls: { method: string; path: string }[];
let failNext = 0;

const PART = 3000; // small parts, so a test file needs several

beforeEach(async () => {
  database = await testDatabase();
  storage = new MemoryStorage();
  ownerId = (await createFirstAdmin(database.db, { email: "o@example.com", name: "O", password: "long enough pw" })).id;
  bookBytes = new Uint8Array(readFileSync(new URL("../../fixtures/books/stevenson-jekyll-and-hyde.epub", import.meta.url)));
  bookId = (await importBook(database.db, storage, ownerId, { name: "jh.epub", bytes: bookBytes })).bookId;
  paragraphs = (await getSections(database.db, ownerId, bookId)).filter((s) => s.kind === "paragraph");
  calls = [];
  failNext = 0;
});
afterEach(() => database.raw.close());

/** The server, without HTTP: the same calls the API routes make. */
async function server(url: string, init: RequestInit = {}) {
  const u = new URL(url, "http://test");
  calls.push({ method: init.method ?? "GET", path: u.pathname });
  if (failNext > 0) {
    failNext--;
    throw new TypeError("Failed to fetch");
  }
  const m = /^\/api\/books\/([^/]+)\/readalong(?:\/([^/]+)\/(parts|finish))?$/.exec(u.pathname)!;
  const bytes = async () => new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
  try {
    if (!m[2]) return Response.json({ import: await startImport(database.db, storage, ownerId, m[1], await bytes()), partBytes: PART }, { status: 201 });
    if (m[3] === "parts") return Response.json(await putAudioPart(database.db, storage, ownerId, m[1], m[2], u.searchParams.get("file")!, Number(u.searchParams.get("part")), await bytes()));
    return Response.json({ import: await finishImport(database.db, storage, ownerId, m[1], m[2], JSON.parse(String(init.body)).parts) });
  } catch (e) {
    if (e instanceof ReadalongError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

/** What a folder picker gives for a package folder named "jekyll-readalong". */
function pickedFolder(files: Record<string, Uint8Array>, extra: Record<string, Uint8Array> = {}) {
  return Object.entries({ ...files, ...extra }).map(([path, data]) => ({ name: path.split("/").pop()!, webkitRelativePath: `jekyll-readalong/${path}`, blob: new Blob([data as BlobPart]) }));
}

function pkg(n = 3, bytes = bookBytes) {
  const read = paragraphs.slice(30, 30 + n);
  return buildPackage({ bookBytes: bytes, chapters: [{ title: "Chapter", paragraphs: ["Chapter Four.", ...read.map((p) => p.text)], inBook: [null, ...read.map((p) => p.chapterIndex)] }] });
}

describe("sending a package from the browser (M13)", () => {
  it("finds the package inside the chosen folder, even when a parent folder was chosen, and skips hidden files", () => {
    const { files } = pkg();
    const flat = packageFiles(pickedFolder(files, { ".DS_Store": new Uint8Array([1]) }));
    expect(flat.map((f) => f.path).sort()).toEqual(Object.keys(files).sort());
    const parent = packageFiles(pickedFolder(files).map((f) => ({ ...f, webkitRelativePath: `Downloads/${f.webkitRelativePath}` })));
    expect(parent.map((f) => f.path).sort()).toEqual(Object.keys(files).sort());
    expect(() => packageFiles([{ name: "notes.txt", webkitRelativePath: "x/notes.txt", blob: new Blob(["hi"]) }])).toThrow("This folder has no manifest.json");
  });

  it("keeps the audio out of the zip, and says which listed audio file is missing", async () => {
    const { files } = pkg();
    const { rest, audio } = await splitPackage(packageFiles(pickedFolder(files)));
    expect([...audio.keys()]).toEqual(["audio/01.wav"]);
    expect(rest.map((f) => f.path)).not.toContain("audio/01.wav");
    const noAudio = packageFiles(pickedFolder(Object.fromEntries(Object.entries(files).filter(([n]) => !n.startsWith("audio/")))));
    await expect(splitPackage(noAudio)).rejects.toThrow("The folder is missing audio/01.wav");
  });

  it("sends the folder: the scripts in one request, the audio in parts with progress, then finishes", async () => {
    const { files } = pkg();
    const seen: UploadProgress[] = [];
    const done = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, onProgress: (p) => seen.push(p) });
    expect(done.status).toBe("ready");
    const size = files["audio/01.wav"].byteLength;
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(Math.ceil(size / PART));
    expect(calls.map((c) => c.method)).toEqual(["POST", ...puts.map(() => "PUT"), "POST"]);
    // Progress: checking, then sending up to the whole file, then finishing, then done.
    expect(seen[0]).toEqual({ stage: "checking" });
    const sending = seen.filter((p) => p.stage === "sending") as Extract<UploadProgress, { stage: "sending" }>[];
    expect(sending.at(-1)).toMatchObject({ sentBytes: size, totalBytes: size, file: "audio/01.wav" });
    expect(sending.map((p) => p.sentBytes)).toEqual([...sending.map((p) => p.sentBytes)].sort((a, b) => a - b));
    expect(seen.slice(-2).map((p) => p.stage)).toEqual(["finishing", "done"]);
    expect(await database.db.select().from(audioTracks)).toHaveLength(3);
    expect(placedWords(done).text).toMatch(/^[\d,]+ of [\d,]+ spoken words placed on the page \(\d+%\)$/);
  });

  it("sends a small .zip of the whole package in one request (for phones, which cannot pick folders)", async () => {
    const { zip } = pkg(2);
    const done = await uploadPackage(bookId, [{ path: "jekyll-readalong.zip", blob: new Blob([zip() as BlobPart]) }], { fetch: server });
    expect(done.status).toBe("ready");
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
  });

  it("refuses a .zip over 200 MB before sending anything", async () => {
    const huge = { path: "big.zip", blob: { size: 201 * 1024 * 1024 } as Blob };
    await expect(uploadPackage(bookId, [huge], { fetch: server })).rejects.toThrow("larger than 200 MB");
    expect(calls).toEqual([]);
  });

  it("retries a dropped connection, and gives up with a plain message after three tries", async () => {
    const { files } = pkg(1);
    failNext = 1; // the first request fails once, then works
    const ok = await uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, wait: async () => {} });
    expect(ok.status).toBe("ready");
    failNext = 3;
    await expect(uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server, wait: async () => {} })).rejects.toThrow(UploadError);
  });

  it("shows the server's own words when it refuses a package", async () => {
    const { files } = pkg(1, new Uint8Array([9, 9, 9]));
    await expect(uploadPackage(bookId, packageFiles(pickedFolder(files)), { fetch: server })).rejects.toThrow(/made from a different file of this book/);
  });
});
