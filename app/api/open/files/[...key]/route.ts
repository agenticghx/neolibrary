import { tooMany } from "@/lib/auth/asker";
import { getDb } from "@/lib/db";
import { visitorMayHave } from "@/lib/library/open-shelf";
import { serverSecret } from "@/lib/secrets";
import { serveStoredFile } from "@/lib/serve-file";
import { verifyFileSignature } from "@/lib/signed-url";
import { getStorage } from "@/lib/storage";
import { takeVisitorRequest, visitorAddress } from "@/lib/visitor-limit";

export const dynamic = "force-dynamic";

/**
 * M34: a stored file for a visitor, signed in or not: only a file the open shelf
 * allows (a cover of a book on the shelf), with a fresh link signed by the open
 * shelf's own pages. Anything else answers "Not found", so a visitor cannot tell
 * a private file from one that does not exist.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  // M34 S5: a limit per visitor address (lib/visitor-limit.ts); generous, as a shelf page shows every cover.
  const taken = takeVisitorRequest("file", visitorAddress(req.headers));
  if (!taken.ok) return tooMany(taken.retryAfterSeconds);
  const key = (await params).key.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const db = await getDb();
  const secret = await serverSecret(db, "visitor-file-links");
  if (!verifyFileSignature(secret, key, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return Response.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  if (!(await visitorMayHave(db, key))) return Response.json({ error: "Not found" }, { status: 404 });
  return serveStoredFile(req, await getStorage(), key);
}
