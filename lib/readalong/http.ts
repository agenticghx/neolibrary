import { ReadalongError } from "./importer";

/** Shared by the read-along routes (M13). */
export const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export function readalongError(e: unknown) {
  if (e instanceof ReadalongError) {
    return Response.json({ error: e.message }, { status: /not found$/i.test(e.message) ? 404 : 400 });
  }
  throw e;
}

/** The request body as bytes, refused before reading if it says it is larger than `max`. */
export async function bodyBytes(req: Request, max: number): Promise<Uint8Array | Response> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > max) return Response.json({ error: `Too large: at most ${Math.round(max / 1024 / 1024)} MB in one request.` }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > max) return Response.json({ error: `Too large: at most ${Math.round(max / 1024 / 1024)} MB in one request.` }, { status: 413 });
  return bytes;
}
