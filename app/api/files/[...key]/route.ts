import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fileOwner } from "@/lib/library/import";
import { serverSecret } from "@/lib/secrets";
import { verifyFileSignature } from "@/lib/signed-url";
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
  const file = await (await getStorage()).get(key).catch(() => null);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: {
      "content-type": file.contentType,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
