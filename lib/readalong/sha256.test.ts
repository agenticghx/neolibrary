import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256, sha256OfBlob } from "./sha256";

/** M13 (c3): the piece-by-piece SHA-256 gives exactly Node's answer, however the input is cut. */
const node = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("SHA-256 in pieces", () => {
  it("matches the standard test vectors", () => {
    expect(new Sha256().update(new Uint8Array()).digestHex()).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(new Sha256().update(new TextEncoder().encode("abc")).digestHex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches Node's SHA-256 at every awkward length (around the 55/56/64-byte padding edges)", () => {
    for (const n of [1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000, 4096, 100_003]) {
      const data = new Uint8Array(randomBytes(n));
      expect(new Sha256().update(data).digestHex(), `${n} bytes`).toBe(node(data));
    }
  });

  it("gives the same answer however the input is cut into pieces", () => {
    const data = new Uint8Array(randomBytes(300_001));
    for (const cut of [1, 7, 63, 64, 65, 1000, 65_536, 299_999]) {
      const h = new Sha256();
      for (let at = 0; at < data.length; at += cut) h.update(data.subarray(at, at + cut));
      expect(h.digestHex(), `pieces of ${cut}`).toBe(node(data));
    }
  });

  it("hashes a Blob in pieces", async () => {
    const data = new Uint8Array(randomBytes(1_000_003));
    expect(await sha256OfBlob(new Blob([data]), 65_537)).toBe(node(data));
    expect(await sha256OfBlob(new Blob([]))).toBe(node(new Uint8Array()));
  });
});
