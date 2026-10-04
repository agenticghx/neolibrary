import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { assertSafeKey, type Storage } from "./index";

/** Railway's S3-compatible bucket, configured by the S3_* variables (see .env.example). */
export class S3Storage implements Storage {
  private client: S3Client;
  constructor(
    private bucket: string,
    env: Record<string, string | undefined>,
  ) {
    this.client = new S3Client({
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
}
