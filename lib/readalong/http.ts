import { ReadalongError } from "./importer";

/** Shared by the read-along routes (M13). */
export const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export function readalongError(e: unknown) {
  if (e instanceof ReadalongError) {
    return Response.json({ error: e.message }, { status: /not found$/i.test(e.message) ? 404 : 400 });
  }
  throw e;
}

/**
 * The request body as bytes, at most `max`. Refused before reading when it
 * says it is larger, and read as a stream that stops at `max` when it does
 * not say (so a body without a length cannot make the server hold more).
 */
export async function bodyBytes(req: Request, max: number): Promise<Uint8Array | Response> {
  const tooLarge = () => Response.json({ error: `Too large: at most ${Math.max(1, Math.round(max / 1024 / 1024))} MB in one request.` }, { status: 413 });
  if (Number(req.headers.get("content-length") ?? "0") > max) return tooLarge();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
