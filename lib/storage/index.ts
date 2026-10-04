import { randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where big files (books, covers, audio) live. Ground rule 3: an interface
 * with a fake. MemoryStorage is the test fake; LocalStorage keeps files on
 * disk for development and browser tests; S3Storage (./s3.ts) is the bucket.
 */
export interface Storage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Size and type without reading the file (M13: audiobooks can be hundreds of MB). */
  stat(key: string): Promise<{ size: number; contentType: string } | null>;
  /** Bytes start..end (inclusive) only, so seeking in a long audiobook does not read all of it. */
  getRange(key: string, start: number, end: number): Promise<Uint8Array | null>;
  /**
   * A large file sent in parts (M13), so no single request holds all of it:
   * start, send numbered parts (each at least 5 MB except the last, the
   * bucket's rule), then finish. Nothing exists under `key` until finished.
   */
  startUpload(key: string, contentType: string): Promise<string>;
  putPart(key: string, uploadId: string, part: number, data: Uint8Array): Promise<string>;
  finishUpload(key: string, uploadId: string, parts: { part: number; tag: string }[]): Promise<void>;
  abortUpload(key: string, uploadId: string): Promise<void>;
}

/** Shared by the two non-bucket storages: parts are numbered from 1 and must all be present. */
function checkParts(parts: { part: number }[], have: number[]) {
  const want = parts.map((p) => p.part);
  if (!want.length || want.some((p, i) => p !== i + 1) || want.some((p) => !have.includes(p))) throw new Error("Upload parts are missing or out of order");
}

export function assertSafeKey(key: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(key) || key.includes("..")) throw new Error(`Unsafe storage key: ${key}`);
}

export class MemoryStorage implements Storage {
  private files = new Map<string, { data: Uint8Array; contentType: string }>();
  async put(key: string, data: Uint8Array, contentType: string) {
    assertSafeKey(key);
    this.files.set(key, { data, contentType });
  }
  async get(key: string) {
    assertSafeKey(key);
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
  async stat(key: string) {
    const f = await this.get(key);
    return f ? { size: f.data.byteLength, contentType: f.contentType } : null;
  }
  async getRange(key: string, start: number, end: number) {
    const f = await this.get(key);
    return f ? f.data.slice(start, end + 1) : null;
  }
  private uploads = new Map<string, { key: string; contentType: string; parts: Map<number, Uint8Array> }>();
  async startUpload(key: string, contentType: string) {
    assertSafeKey(key);
    const id = randomUUID();
    this.uploads.set(id, { key, contentType, parts: new Map() });
    return id;
  }
  async putPart(key: string, uploadId: string, part: number, data: Uint8Array) {
    const u = this.uploads.get(uploadId);
    if (!u || u.key !== key) throw new Error("Unknown upload");
    u.parts.set(part, data);
    return String(part);
  }
  async finishUpload(key: string, uploadId: string, parts: { part: number; tag: string }[]) {
    const u = this.uploads.get(uploadId);
    if (!u || u.key !== key) throw new Error("Unknown upload");
    checkParts(parts, [...u.parts.keys()]);
    const chunks = parts.map((p) => u.parts.get(p.part)!);
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    await this.put(key, all, u.contentType);
    this.uploads.delete(uploadId);
  }
  async abortUpload(_key: string, uploadId: string) {
    this.uploads.delete(uploadId);
  }
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    assertSafeKey(key);
    return path.join(this.root, key);
  }
  async put(key: string, data: Uint8Array, contentType: string) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, data);
    await writeFile(`${f}.type`, contentType);
  }
  async get(key: string) {
    const f = this.file(key);
    try {
      return { data: new Uint8Array(await readFile(f)), contentType: await readFile(`${f}.type`, "utf8") };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const f = this.file(key);
    await rm(f, { force: true });
    await rm(`${f}.type`, { force: true });
  }
  async stat(key: string) {
    const f = this.file(key);
    try {
      return { size: (await stat(f)).size, contentType: await readFile(`${f}.type`, "utf8") };
    } catch {
      return null;
    }
  }
  async getRange(key: string, start: number, end: number) {
    let fh;
    try {
      fh = await open(this.file(key), "r");
    } catch {
      return null;
    }
    try {
      const buf = new Uint8Array(end - start + 1);
      const { bytesRead } = await fh.read(buf, 0, buf.byteLength, start);
      return buf.slice(0, bytesRead);
    } finally {
      await fh.close();
    }
  }
  private uploadDir(uploadId: string) {
    if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new Error("Unknown upload");
    return path.join(this.root, ".uploads", uploadId);
  }
  async startUpload(key: string, contentType: string) {
    this.file(key);
    const id = randomUUID();
    await mkdir(this.uploadDir(id), { recursive: true });
    await writeFile(path.join(this.uploadDir(id), "meta.json"), JSON.stringify({ key, contentType }));
    return id;
  }
  private async upload(key: string, uploadId: string) {
    const meta = JSON.parse(await readFile(path.join(this.uploadDir(uploadId), "meta.json"), "utf8").catch(() => "{}"));
    if (meta.key !== key) throw new Error("Unknown upload");
    return meta as { key: string; contentType: string };
  }
  async putPart(key: string, uploadId: string, part: number, data: Uint8Array) {
    await this.upload(key, uploadId);
    if (!Number.isInteger(part) || part < 1 || part > 10000) throw new Error("Bad part number");
    await writeFile(path.join(this.uploadDir(uploadId), `${part}.part`), data);
    return String(part);
  }
  async finishUpload(key: string, uploadId: string, parts: { part: number; tag: string }[]) {
    const meta = await this.upload(key, uploadId);
    const dir = this.uploadDir(uploadId);
    const have = (await readdir(dir)).filter((n) => n.endsWith(".part")).map((n) => Number(n.slice(0, -5)));
    checkParts(parts, have);
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, new Uint8Array());
    for (const p of parts) await appendFile(f, await readFile(path.join(dir, `${p.part}.part`)));
    await writeFile(`${f}.type`, meta.contentType);
    await rm(dir, { recursive: true, force: true });
  }
  async abortUpload(_key: string, uploadId: string) {
    await rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }
}

const g = globalThis as unknown as { __neolibraryStorage?: Storage };

/** The bucket when S3_BUCKET is set (production); otherwise files on local disk. */
export async function getStorage(): Promise<Storage> {
  if (!g.__neolibraryStorage) {
    if (process.env.S3_BUCKET) {
      const { S3Storage } = await import("./s3");
      g.__neolibraryStorage = new S3Storage(process.env.S3_BUCKET, process.env);
    } else {
      g.__neolibraryStorage = new LocalStorage(process.env.FILES_DIR ?? path.join(process.cwd(), ".data", "files"));
    }
  }
  return g.__neolibraryStorage;
}
