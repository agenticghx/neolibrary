import { MAX_RANGE, servedRange } from "./http-range";
import type { Storage } from "./storage";

/**
 * Sends a stored file (a book, a cover, audio) as the answer to a request:
 * the byte range a player asked for (see servedRange in lib/http-range.ts),
 * or the whole file. Anything longer than MAX_RANGE is read and sent
 * MAX_RANGE bytes at a time, each piece read when the previous one has been
 * taken, so the server never holds a long audiobook in memory at once. Used
 * by /api/files (signed links) and the read-along audio route (M13 (d));
 * each checks who may have the file first.
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
    const [start, end] = range;
    if (end - start + 1 > MAX_RANGE) {
      return new Response(inPieces(storage, key, start, end), {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
      });
    }
    // Only the bytes to be sent are read from storage.
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
  return new Response(inPieces(storage, key, 0, size - 1), { headers: { ...headers, "content-length": String(size) } });
}

/** Bytes start..end (inclusive) of a stored file, read MAX_RANGE bytes at a time as the receiver takes them. */
function inPieces(storage: Storage, key: string, start: number, end: number) {
  let at = start;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (at > end) {
        controller.close();
        return;
      }
      const chunk = await storage.getRange(key, at, Math.min(end, at + MAX_RANGE - 1)).catch(() => null);
      if (!chunk?.byteLength) {
        controller.error(new Error(`Stored file ${key} ended early`));
        return;
      }
      controller.enqueue(chunk);
      at += chunk.byteLength;
    },
  });
}
