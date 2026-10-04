import { deflateRawSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { safeUnzip, ZipError } from "./zipread";

/**
 * M13 (c3): unpacking uploaded zips safely. Real zips (made by fflate, as the
 * browser does, stored or deflated) read back exactly; crafted ones are
 * refused before they cost memory or CPU.
 */
const limits = { maxUnpacked: 10 * 1024 * 1024, maxEntries: 100 };

/** A one-entry zip whose deflated data and declared size are chosen freely. */
function zipWith(name: string, data: Uint8Array, declared: number, method = 8, flags = 0) {
  const n = strToU8(name);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(6, flags, true);
  lv.setUint16(8, method, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, declared, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const dir = new Uint8Array(46 + n.length);
  const dv = new DataView(dir.buffer);
  dv.setUint32(0, 0x02014b50, true);
  dv.setUint16(8, flags, true);
  dv.setUint16(10, method, true);
  dv.setUint32(20, data.length, true);
  dv.setUint32(24, declared, true);
  dv.setUint16(28, n.length, true);
  dv.setUint32(42, 0, true);
  dir.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, dir.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + dir.length + end.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(dir, local.length + data.length);
  out.set(end, local.length + data.length + dir.length);
  return out;
}

describe("safeUnzip", () => {
  it("reads real zips exactly, stored or deflated, with folders and empty files", () => {
    const files = { "manifest.json": strToU8('{"a":1}'), "timings/01.json": strToU8("x".repeat(50_000)), "empty.txt": new Uint8Array(), "audio/01.wav": new Uint8Array(70_000).map((_, i) => i % 251) };
    for (const level of [0, 6] as const) {
      const out = safeUnzip(zipSync({ ...files, "folder/": new Uint8Array() }, { level }), limits);
      expect(Object.keys(out).sort()).toEqual(Object.keys(files).sort());
      for (const [k, v] of Object.entries(files)) expect(out[k]).toEqual(v);
    }
  });

  it("stops at once on an entry that unpacks to more than it declares (a zip bomb), without decompressing it all", () => {
    const bomb = deflateRawSync(new Uint8Array(200 * 1024 * 1024)); // 200 MB of zeros, about 200 KB packed
    const zip = zipWith("timings/01.json", bomb, 16);
    const t = Date.now();
    expect(() => safeUnzip(zip, { maxUnpacked: 1024 * 1024 * 1024, maxEntries: 10 })).toThrow(ZipError);
    expect(Date.now() - t).toBeLessThan(500); // fflate took about 0.7 s per 255 KB stream, and kept going
  });

  it("refuses declared sizes over the limit, too many entries, encryption and unknown compression", () => {
    expect(() => safeUnzip(zipWith("a", deflateRawSync(new Uint8Array(10)), 11 * 1024 * 1024), limits)).toThrow("too large");
    const many = zipSync(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`f${i}`, new Uint8Array(1)])));
    expect(() => safeUnzip(many, limits)).toThrow("too many entries");
    expect(() => safeUnzip(zipWith("a", new Uint8Array(4), 4, 0, 1), limits)).toThrow("encrypted");
    expect(() => safeUnzip(zipWith("a", new Uint8Array(4), 4, 14), limits)).toThrow("unsupported compression");
    expect(() => safeUnzip(strToU8("not a zip at all"), limits)).toThrow("not a zip");
  });

  it("refuses entries that share data (one stream unpacked many times)", () => {
    const zip = zipSync({ a: new Uint8Array(1000), b: new Uint8Array(1000) }, { level: 0 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let firstLocal = -1;
    for (let i = 0; i + 4 <= zip.byteLength; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        if (firstLocal < 0) firstLocal = view.getUint32(i + 42, true);
        else view.setUint32(i + 42, firstLocal, true); // the second entry points at the first's data
      }
    }
    expect(() => safeUnzip(zip, limits)).toThrow("entries overlap");
  });
});
