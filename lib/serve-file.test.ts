import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MAX_RANGE } from "./http-range";
import { serveStoredFile } from "./serve-file";
import { LocalStorage, MemoryStorage, type Storage } from "./storage";

const req = (range?: string) => new Request("http://localhost/f", { headers: range ? { range } : {} });
/** Byte-for-byte equal (a plain toEqual on 20 MB is too slow). */
const same = (a: ArrayBuffer | Uint8Array, b: Uint8Array) => Buffer.from(a instanceof Uint8Array ? a : new Uint8Array(a)).equals(Buffer.from(b));

async function stored(size: number) {
  const storage = new MemoryStorage();
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 7) % 251;
  await storage.put("audio/u1/b1/x.wav", data, "audio/wav");
  return { storage, data };
}

describe("sending stored files (books, covers, audio)", () => {
  it("sends a range as asked, never more than 8 MB, saying which bytes came", async () => {
    const size = 20 * 1024 * 1024 + 5;
    const { storage, data } = await stored(size);
    // Safari's engine asks for the whole file as a closed range.
    const whole = await serveStoredFile(req(`bytes=0-${size - 1}`), storage, "audio/u1/b1/x.wav");
    expect(whole.status).toBe(206);
    expect(whole.headers.get("content-range")).toBe(`bytes 0-${MAX_RANGE - 1}/${size}`);
    expect(whole.headers.get("content-length")).toBe(String(MAX_RANGE));
    expect(same(await whole.arrayBuffer(), data.slice(0, MAX_RANGE))).toBe(true);
    // Chromium's open-ended ask, from the middle.
    const open = await serveStoredFile(req(`bytes=${MAX_RANGE}-`), storage, "audio/u1/b1/x.wav");
    expect(open.headers.get("content-range")).toBe(`bytes ${MAX_RANGE}-${2 * MAX_RANGE - 1}/${size}`);
    // The last bytes, and a small exact range.
    const tail = await serveStoredFile(req("bytes=-5"), storage, "audio/u1/b1/x.wav");
    expect(same(await tail.arrayBuffer(), data.slice(size - 5))).toBe(true);
    const small = await serveStoredFile(req("bytes=10-19"), storage, "audio/u1/b1/x.wav");
    expect(small.headers.get("content-range")).toBe(`bytes 10-19/${size}`);
    expect(same(await small.arrayBuffer(), data.slice(10, 20))).toBe(true);
    expect(small.headers.get("accept-ranges")).toBe("bytes");
    expect(small.headers.get("content-type")).toBe("audio/wav");
    expect(small.headers.get("content-security-policy")).toContain("sandbox");
    const refused = await serveStoredFile(req(`bytes=${size}-`), storage, "audio/u1/b1/x.wav");
    expect(refused.status).toBe(416);
    expect(refused.headers.get("content-range")).toBe(`bytes */${size}`);
  });

  it("sends a large file asked for whole in 8 MB pieces, read one at a time", async () => {
    const size = 20 * 1024 * 1024 + 5;
    const { storage, data } = await stored(size);
    // What the route asks of storage (MemoryStorage's own methods call each other).
    const reads: number[] = [];
    const watched = {
      stat: (k: string) => storage.stat(k),
      getRange: (k: string, start: number, end: number) => (reads.push(end - start + 1), storage.getRange(k, start, end)),
      get: vi.fn((k: string) => storage.get(k)),
    } as unknown as Storage;
    const res = await serveStoredFile(req(), watched, "audio/u1/b1/x.wav");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(same(await res.arrayBuffer(), data)).toBe(true);
    expect(watched.get).not.toHaveBeenCalled();
    expect(reads).toEqual([MAX_RANGE, MAX_RANGE, size - 2 * MAX_RANGE]);
  });

  it("streams a large file from the disk storage the browser tests use, byte for byte", async () => {
    const size = 2 * MAX_RANGE + 12345;
    const disk = new LocalStorage(mkdtempSync(path.join(tmpdir(), "serve-")));
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++) data[i] = (i * 13) % 253;
    await disk.put("books/u1/b1/big.epub", data, "application/epub+zip");
    const res = await serveStoredFile(req(), disk, "books/u1/b1/big.epub");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(size));
    expect(res.headers.get("content-type")).toBe("application/epub+zip");
    expect(same(await res.arrayBuffer(), data)).toBe(true);
    // And a range from the middle, capped.
    const mid = await serveStoredFile(req(`bytes=${MAX_RANGE - 10}-`), disk, "books/u1/b1/big.epub");
    expect(mid.headers.get("content-range")).toBe(`bytes ${MAX_RANGE - 10}-${2 * MAX_RANGE - 11}/${size}`);
    expect(same(await mid.arrayBuffer(), data.slice(MAX_RANGE - 10, 2 * MAX_RANGE - 10))).toBe(true);
  });

  it("sends a small file whole, and says when there is none", async () => {
    const { storage, data } = await stored(1000);
    const res = await serveStoredFile(req(), storage, "audio/u1/b1/x.wav");
    expect(res.status).toBe(200);
    expect(same(await res.arrayBuffer(), data)).toBe(true);
    expect((await serveStoredFile(req(), storage, "audio/u1/b1/missing.wav")).status).toBe(404);
    expect((await serveStoredFile(req("bytes=0-"), storage, "audio/u1/b1/missing.wav")).status).toBe(404);
  });
});
