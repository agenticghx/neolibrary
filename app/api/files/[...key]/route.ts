import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { fileOwner } from "@/lib/library/import";
import { serverSecret } from "@/lib/secrets";
import { serveStoredFile } from "@/lib/serve-file";
import { verifyFileSignature } from "@/lib/signed-url";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Serves a stored file only to its owner, signed in, holding a fresh signed
 * link (lib/signed-url.ts). How the bytes are sent (ranges, large files) is
 * in lib/serve-file.ts.
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
  return serveStoredFile(req, await getStorage(), key);
}
