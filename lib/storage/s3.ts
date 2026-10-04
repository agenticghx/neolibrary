import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { assertSafeKey, type Storage } from "./index";

/** Railway's S3-compatible bucket, configured by the S3_* variables (see .env.example). */
export class S3Storage implements Storage {
  private client: Pick<S3Client, "send">;
  constructor(
    private bucket: string,
    env: Record<string, string | undefined>,
    /** For tests: something with S3Client's send(). */
    client?: Pick<S3Client, "send">,
  ) {
    this.client = client ?? new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || "auto",
      forcePathStyle: (env.S3_URL_STYLE ?? "path").toLowerCase().startsWith("path"),
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "" },
    });
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }

  async get(key: string) {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { data: await res.Body!.transformToByteArray(), contentType: res.ContentType ?? "application/octet-stream" };
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async stat(key: string) {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? "application/octet-stream" };
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey") return null;
      throw e;
    }
  }

  async getRange(key: string, start: number, end: number) {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` }));
      return await res.Body!.transformToByteArray();
    } catch (e) {
      if (e instanceof NoSuchKey || (e as { name?: string }).name === "NoSuchKey") return null;
      throw e;
    }
  }

  async startUpload(key: string, contentType: string) {
    assertSafeKey(key);
    const res = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }));
    return res.UploadId!;
  }

  async putPart(key: string, uploadId: string, part: number, data: Uint8Array) {
    assertSafeKey(key);
    const res = await this.client.send(new UploadPartCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId, PartNumber: part, Body: data }));
    return res.ETag!;
  }

  async finishUpload(key: string, uploadId: string, parts: { part: number; tag: string }[]) {
    assertSafeKey(key);
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.part, ETag: p.tag })) },
      }),
    );
  }

  async abortUpload(key: string, uploadId: string) {
    assertSafeKey(key);
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }));
  }
}
