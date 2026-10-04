import { describe, expect, it } from "vitest";
import { byteRange, servedRange } from "./http-range";

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

  it("M13: an open-ended request on a long file gets at most 8 MB; an exact range is served as asked", () => {
    const size = 201 * 1024 * 1024; // the Kuhn audiobook
    const max = 8 * 1024 * 1024;
    expect(servedRange("bytes=0-", size)).toEqual([0, max - 1]);
    expect(servedRange("bytes=100000000-", size)).toEqual([100000000, 100000000 + max - 1]);
    expect(servedRange(`bytes=${size - 10}-`, size)).toEqual([size - 10, size - 1]);
    expect(servedRange("bytes=0-3", size)).toEqual([0, 3]);
    expect(servedRange("bytes=-500", size)).toEqual([size - 500, size - 1]);
    expect(servedRange(null, size)).toBeNull();
    expect(servedRange("bytes=0-", 1000)).toEqual([0, 999]);
  });
});
