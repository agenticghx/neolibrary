import { bodyBytes } from "@/lib/readalong/http";

/**
 * The request body, read at most up to `max` bytes (see `bodyBytes`), then
 * parsed as a form upload. A body over the limit is a 413 and is not parsed.
 * Callers that take a file (books, voice notes) use this so the size is
 * checked while the body is read, not after the whole thing is in memory.
 */
export async function cappedFormData(req: Request, max: number): Promise<FormData | Response> {
  const bytes = await bodyBytes(req, max);
  if (bytes instanceof Response) return bytes;
  const body =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.slice().buffer as ArrayBuffer);
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  try {
    return await new Request(req.url, { method: req.method, headers, body }).formData();
  } catch {
    return Response.json({ error: "Send the files as a form upload." }, { status: 400 });
  }
}

/** The request body as JSON, refused at `max` bytes the same way. */
export async function jsonAtMost(req: Request, max: number): Promise<unknown | Response> {
  const bytes = await bodyBytes(req, max);
  if (bytes instanceof Response) return bytes;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json({ error: "That file is not valid JSON." }, { status: 400 });
  }
}
