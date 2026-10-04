import { describe, expect, it } from "vitest";
import { byteRange } from "./http-range";

describe("byte ranges for stored files", () => {
  it("reads the usual forms and refuses what cannot be served", () => {
    expect(byteRange(null, 100)).toBeNull();
    expect(byteRange("bytes=0-", 100)).toEqual([0, 99]);
    expect(byteRange("bytes=10-19", 100)).toEqual([10, 19]);
    expect(byteRange("bytes=90-500", 100)).toEqual([90, 99]);
    expect(byteRange("bytes=-30", 100)).toEqual([70, 99]);
    expect(byteRange("bytes=-500", 100)).toEqual([0, 99]);
    expect(["bytes=100-", "bytes=20-10", "bytes=-", "items=0-1", "bytes=0-1,5-6"].map((h) => byteRange(h, 100))).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
  });
});
