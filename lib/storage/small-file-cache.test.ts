import { describe, expect, it } from "vitest";
import { serveStoredFile } from "@/lib/serve-file";
import { MemoryStorage, type Storage } from "./index";
import { withSmallFileCache } from "./small-file-cache";

/** A storage that counts how often each file is read or measured. */
function counted() {
  const inner = new MemoryStorage();
  const calls = { get: 0, stat: 0 };
  const spy: Storage = Object.assign(Object.create(inner) as Storage, {
    get: (key: string) => (calls.get++, inner.get(key)),
    stat: (key: string) => (calls.stat++, inner.stat(key)),
    put: (key: string, data: Uint8Array, type: string) => inner.put(key, data, type),
    delete: (key: string) => inner.delete(key),
  });
  return { inner, spy, calls };
}
const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

describe("withSmallFileCache", () => {
  it("reads a cover from storage once: the stat and the read of a request, and every later request, come from memory", async () => {
    const { spy, calls } = counted();
    const storage = withSmallFileCache(spy);
    await storage.put("covers/o/a.jpg", bytes(10), "image/jpeg");
    for (let i = 0; i < 3; i++) {
      expect(await storage.stat("covers/o/a.jpg")).toEqual({ size: 10, contentType: "image/jpeg" });
      expect((await storage.get("covers/o/a.jpg"))?.data.byteLength).toBe(10);
    }
    expect(calls).toEqual({ get: 1, stat: 0 });
  });

  it("a cover written or deleted through it is served new, or not at all, at once", async () => {
    const { spy } = counted();
    const storage = withSmallFileCache(spy);
    await storage.put("covers/o/a.jpg", bytes(10, 1), "image/jpeg");
    expect((await storage.get("covers/o/a.jpg"))?.data[0]).toBe(1);
    await storage.put("covers/o/a.jpg", bytes(12, 2), "image/png");
    expect(await storage.stat("covers/o/a.jpg")).toEqual({ size: 12, contentType: "image/png" });
    expect((await storage.get("covers/o/a.jpg"))?.data[0]).toBe(2);
    await storage.delete("covers/o/a.jpg");
    expect(await storage.get("covers/o/a.jpg")).toBeNull();
    expect(await storage.stat("covers/o/a.jpg")).toBeNull();
  });

  it("keeps only small files under the prefix: a book's file and a large picture are read from storage each time", async () => {
    const { spy, calls } = counted();
    const storage = withSmallFileCache(spy, { maxFileBytes: 100 });
    await storage.put("books/o/b.epub", bytes(10), "application/epub+zip");
    await storage.put("covers/o/big.jpg", bytes(101), "image/jpeg");
    for (let i = 0; i < 2; i++) {
      await storage.get("books/o/b.epub");
      await storage.stat("books/o/b.epub");
      await storage.get("covers/o/big.jpg");
    }
    expect(calls).toEqual({ get: 4, stat: 2 });
  });

  it("forgets a copy after its time, and the copies read longest ago when memory is full", async () => {
    const { spy, calls } = counted();
    let clock = 0;
    const storage = withSmallFileCache(spy, { ttlMs: 1000, maxTotalBytes: 25, now: () => clock });
    for (const name of ["a", "b", "c"]) await storage.put(`covers/o/${name}.jpg`, bytes(10), "image/jpeg");
    await storage.get("covers/o/a.jpg");
    await storage.get("covers/o/b.jpg");
    await storage.get("covers/o/a.jpg"); // a was read last, so b is the oldest
    await storage.get("covers/o/c.jpg"); // 30 bytes would be kept: b goes
    expect(calls.get).toBe(3);
    await storage.get("covers/o/a.jpg");
    expect(calls.get).toBe(3);
    await storage.get("covers/o/b.jpg");
    expect(calls.get).toBe(4);
    clock = 2000;
    await storage.get("covers/o/a.jpg");
    expect(calls.get).toBe(5);
  });

  it("a file that is not there is asked for again next time", async () => {
    const { spy, calls } = counted();
    const storage = withSmallFileCache(spy);
    expect(await storage.stat("covers/o/none.jpg")).toBeNull();
    expect(await storage.get("covers/o/none.jpg")).toBeNull();
    expect(calls.get).toBe(2);
  });

  it("a cover request is answered whole, with its type and length, from one read of storage", async () => {
    const { spy, calls } = counted();
    const storage = withSmallFileCache(spy);
    await storage.put("covers/o/a.jpg", bytes(10, 7), "image/jpeg");
    for (let i = 0; i < 2; i++) {
      const res = await serveStoredFile(new Request("http://x/api/files/covers/o/a.jpg"), storage, "covers/o/a.jpg");
      expect([res.status, res.headers.get("content-type"), res.headers.get("content-length")]).toEqual([200, "image/jpeg", "10"]);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(10, 7));
    }
    expect(calls).toEqual({ get: 1, stat: 0 });
  });

  it("a read still on its way when the cover is replaced does not bring the old picture back", async () => {
    const inner = new MemoryStorage();
    let release: () => void = () => {};
    const slow: Storage = Object.assign(Object.create(inner) as Storage, {
      // The first read waits until the test lets it go; it has already taken the old bytes.
      get: async (key: string) => {
        const file = await inner.get(key);
        await new Promise<void>((r) => (release = r));
        return file;
      },
      put: (key: string, data: Uint8Array, type: string) => inner.put(key, data, type),
      delete: (key: string) => inner.delete(key),
    });
    const storage = withSmallFileCache(slow);
    await inner.put("covers/o/a.jpg", bytes(10, 1), "image/jpeg");
    const old = storage.get("covers/o/a.jpg");
    await new Promise((r) => setTimeout(r, 0));
    await storage.put("covers/o/a.jpg", bytes(10, 2), "image/jpeg");
    release();
    expect((await old)?.data[0]).toBe(1);
    // The next read goes to storage again (the old bytes were not kept) and gets the new picture.
    const next = storage.get("covers/o/a.jpg");
    await new Promise((r) => setTimeout(r, 0));
    release();
    expect((await next)?.data[0]).toBe(2);
  });
});
