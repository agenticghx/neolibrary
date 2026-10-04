import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fileOwner } from "@/lib/library/import";
import { serverSecret } from "@/lib/secrets";
import { verifyFileSignature } from "@/lib/signed-url";
import { servedRange } from "@/lib/http-range";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Serves a stored file only to its owner, signed in, holding a fresh signed
 * link (lib/signed-url.ts). Files are never rendered as pages on this site:
 * the sandbox policy stops scripts in, for example, an SVG cover.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = (await params).key.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const secret = await serverSecret(await getDb(), "file-links");
  if (!verifyFileSignature(secret, key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return Response.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  if (fileOwner(key) !== user.id) return Response.json({ error: "Not found" }, { status: 404 });
  const storage = await getStorage();
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
    // Only the bytes asked for are read from storage (an audiobook can be
    // hundreds of MB); see servedRange for open-ended requests.
    const [start, end] = range;
    const data = await storage.getRange(key, start, end);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });
    return new Response(Buffer.from(data), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${start + data.byteLength - 1}/${size}`, "content-length": String(data.byteLength) },
    });
  }
  const file = await storage.get(key).catch(() => null);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(Buffer.from(file.data), { headers: { ...headers, "content-length": String(file.data.length) } });
}
