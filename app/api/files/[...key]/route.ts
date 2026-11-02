import { readerMayFetch } from "@/lib/library/shared-papers";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { lockedOutOfFile } from "@/lib/library/focus-lock";
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
  const db = await getDb();
  const secret = await serverSecret(db, "file-links");
  if (!verifyFileSignature(secret, key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return Response.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  // The reader's own file, or (M41 R3c) the file or cover of a paper the owner shares with them.
  if (!(await readerMayFetch(db, user.id, key, fileOwner(key) === user.id))) return Response.json({ error: "Not found" }, { status: 404 });
  // M26 R4a: another book's file, while a focus session runs, is refused (423 Locked), so a tab left open on it
  // cannot go on reading. Covers and pictures are not locked.
  const locked = await lockedOutOfFile(db, user.id, key);
  if (locked) return locked;
  return serveStoredFile(req, await getStorage(), key);
}
