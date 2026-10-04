import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { serverSecret } from "@/lib/secrets";
import { verifyFileSignature } from "@/lib/signed-url";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Serves a stored file only to a signed-in user holding a fresh signed link
 * (lib/signed-url.ts). Per-user ownership checks arrive with books in M3.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!(await currentUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const key = (await params).key.join("/");
  const url = new URL(req.url);
  const secret = await serverSecret(await getDb(), "file-links");
  if (!verifyFileSignature(secret, key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return Response.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  const file = await getStorage().get(key).catch(() => null);
  if (!file) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(Buffer.from(file.data), {
    headers: { "content-type": file.contentType, "cache-control": "private, no-store" },
  });
}
