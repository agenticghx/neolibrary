import { MAX_RANGE, servedRange } from "./http-range";
import type { Storage } from "./storage";

/**
 * Sends a stored file (a book, a cover, audio) as the answer to a request:
 * the byte range a player asked for (at most MAX_RANGE bytes, see
 * lib/http-range.ts), or the whole file. A whole file larger than MAX_RANGE
 * is read and sent MAX_RANGE bytes at a time, so the server never holds a
 * long audiobook in memory at once. Used by /api/files (signed links) and the
 * read-along audio route (M13 (d)); each checks who may have the file first.
 *
 * Files are never rendered as pages on this site: the sandbox policy stops
 * scripts in, for example, an SVG cover.
 */
export async function serveStoredFile(req: Request, storage: Storage, key: string): Promise<Response> {
  const info = await storage.stat(key).catch(() => null);
  if (!info) return Response.json({ error: "Not found" }, { status: 404 });
  const headers = {
    "content-type": info.contentType,
    "cache-control": "private, max-age=300",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    // Audio players ask for byte ranges to learn the length and to seek.
    "accept-ranges": "bytes",
  };
  const size = info.size;
  const range = servedRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  }
  if (range) {
    // Only the bytes to be sent are read from storage.
    const [start, end] = range;
    const data = await storage.getRange(key, start, end);
    if (!data?.byteLength) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Buffer.from(data), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${start + data.byteLength - 1}/${size}`, "content-length": String(data.byteLength) },
    });
  }
  if (size <= MAX_RANGE) {
    const file = await storage.get(key).catch(() => null);
    if (!file) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Buffer.from(file.data), { headers: { ...headers, "content-length": String(file.data.length) } });
  }
  // A large file asked for whole: one piece at a time, each read when the
  // previous one has been sent.
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at >= size) {
        controller.close();
        return;
      }
      const chunk = await storage.getRange(key, at, Math.min(size, at + MAX_RANGE) - 1).catch(() => null);
      if (!chunk?.byteLength) {
        controller.error(new Error(`Stored file ${key} ended early`));
        return;
      }
      controller.enqueue(chunk);
      at += chunk.byteLength;
    },
  });
  return new Response(body, { headers: { ...headers, "content-length": String(size) } });
}
