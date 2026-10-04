import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { LocalStorage, MemoryStorage, type Storage } from "./index";
import { S3Storage } from "./s3";

/**
 * M13: storage for long audio. Reading a byte range must not need the whole
 * file, and a large file can be sent in parts that only become a file when
 * finished. The bucket itself is not reachable from tests, so S3Storage is
 * checked by the requests it would send.
 */
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) % 251);

describe.each<[string, () => Storage]>([
  ["memory", () => new MemoryStorage()],
  ["local disk", () => new LocalStorage(mkdtempSync(path.join(tmpdir(), "storage-")), { minPartBytes: 1000 })],
])("%s storage", (_, make) => {
  it("tells a file's size and type, and reads just a byte range", async () => {
    const s = make();
    const data = bytes(10_000);
    await s.put("audio/u1/b1/book.m4b", data, "audio/mp4");
    expect(await s.stat("audio/u1/b1/book.m4b")).toEqual({ size: 10_000, contentType: "audio/mp4" });
    expect(await s.getRange("audio/u1/b1/book.m4b", 100, 199)).toEqual(data.slice(100, 200));
    expect(await s.getRange("audio/u1/b1/book.m4b", 9_990, 20_000)).toEqual(data.slice(9_990));
    expect(await s.stat("audio/u1/b1/missing.m4b")).toBeNull();
    expect(await s.getRange("audio/u1/b1/missing.m4b", 0, 10)).toBeNull();
  });

  it("joins a file sent in parts, in order, and only when finished", async () => {
    const s = make();
    const parts = [bytes(5000, 1), bytes(5000, 2), bytes(1234, 3)];
    const id = await s.startUpload("audio/u1/b1/big.m4b", "audio/mp4");
    // Sent out of order, as parallel uploads may arrive.
    const tags = await Promise.all([2, 0, 1].map(async (i) => ({ part: i + 1, tag: await s.putPart("audio/u1/b1/big.m4b", id, i + 1, parts[i]) })));
    expect(await s.stat("audio/u1/b1/big.m4b")).toBeNull();
    await s.finishUpload("audio/u1/b1/big.m4b", id, tags.sort((a, b) => a.part - b.part));
    const got = await s.get("audio/u1/b1/big.m4b");
    expect(got?.contentType).toBe("audio/mp4");
    expect(got?.data).toEqual(Uint8Array.from([...parts[0], ...parts[1], ...parts[2]]));
  });

  it("refuses to finish with a part missing, and forgets an aborted upload", async () => {
    const s = make();
    const id = await s.startUpload("audio/u1/b1/x.m4b", "audio/mp4");
    const t1 = await s.putPart("audio/u1/b1/x.m4b", id, 1, bytes(10));
    await expect(s.finishUpload("audio/u1/b1/x.m4b", id, [{ part: 1, tag: t1 }, { part: 2, tag: "2" }])).rejects.toThrow();
    await expect(s.putPart("audio/u1/b1/other.m4b", id, 2, bytes(10))).rejects.toThrow("Unknown upload");
    await s.abortUpload("audio/u1/b1/x.m4b", id);
    await expect(s.finishUpload("audio/u1/b1/x.m4b", id, [{ part: 1, tag: t1 }])).rejects.toThrow();
    expect(await s.stat("audio/u1/b1/x.m4b")).toBeNull();
  });
});

describe("the bucket's minimum part size", () => {
  it("local storage refuses, by default, a part before the last that is under 5 MB, as the bucket does", async () => {
    const s = new LocalStorage(mkdtempSync(path.join(tmpdir(), "storage-")));
    const id = await s.startUpload("audio/u1/b1/x.m4b", "audio/mp4");
    const t1 = await s.putPart("audio/u1/b1/x.m4b", id, 1, bytes(1000));
    const t2 = await s.putPart("audio/u1/b1/x.m4b", id, 2, bytes(10));
    await expect(s.finishUpload("audio/u1/b1/x.m4b", id, [{ part: 1, tag: t1 }, { part: 2, tag: t2 }])).rejects.toThrow("EntityTooSmall");
    // One part (the last may be any size) is fine.
    expect(await s.finishUpload("audio/u1/b1/x.m4b", id, [{ part: 1, tag: t1 }])).toBeUndefined();
  });
});

describe("bucket storage (S3)", () => {
  type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
  const fake = (reply: (c: Cmd) => unknown) => {
    const sent: Cmd[] = [];
    const client = { send: async (c: Cmd) => (sent.push(c), reply(c)) } as unknown as ConstructorParameters<typeof S3Storage>[2];
    return { sent, s3: new S3Storage("bucket", {}, client) };
  };

  it("asks the bucket for a byte range, not the whole file", async () => {
    const { sent, s3 } = fake(() => ({ Body: { transformToByteArray: async () => bytes(100) } }));
    expect(await s3.getRange("audio/u1/b1/book.m4b", 1000, 1099)).toHaveLength(100);
    expect(sent[0]).toBeInstanceOf(GetObjectCommand);
    expect(sent[0].input).toMatchObject({ Bucket: "bucket", Key: "audio/u1/b1/book.m4b", Range: "bytes=1000-1099" });
  });

  it("reads size and type from the bucket's headers, and says null for a missing file", async () => {
    const { sent, s3 } = fake((c) => {
      if (c.input.Key === "audio/u1/b1/missing.m4b") throw Object.assign(new Error("not found"), { name: "NotFound" });
      return { ContentLength: 201_517_486, ContentType: "audio/mp4" };
    });
    expect(await s3.stat("audio/u1/b1/book.m4b")).toEqual({ size: 201_517_486, contentType: "audio/mp4" });
    expect(sent[0]).toBeInstanceOf(HeadObjectCommand);
    expect(await s3.stat("audio/u1/b1/missing.m4b")).toBeNull();
  });

  it("uses the bucket's own multipart upload", async () => {
    const { sent, s3 } = fake((c) => (c instanceof CreateMultipartUploadCommand ? { UploadId: "up-1" } : c instanceof UploadPartCommand ? { ETag: `"tag-${c.input.PartNumber}"` } : {}));
    const id = await s3.startUpload("audio/u1/b1/book.m4b", "audio/mp4");
    const tag = await s3.putPart("audio/u1/b1/book.m4b", id, 1, bytes(10));
    await s3.finishUpload("audio/u1/b1/book.m4b", id, [{ part: 1, tag }]);
    expect(sent.map((c) => c.constructor.name)).toEqual(["CreateMultipartUploadCommand", "UploadPartCommand", "CompleteMultipartUploadCommand"]);
    expect(sent[0].input).toMatchObject({ Key: "audio/u1/b1/book.m4b", ContentType: "audio/mp4" });
    expect(sent[2]).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect(sent[2].input).toMatchObject({ UploadId: "up-1", MultipartUpload: { Parts: [{ PartNumber: 1, ETag: '"tag-1"' }] } });
  });
});
