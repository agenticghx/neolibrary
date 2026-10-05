import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { importAudio } from "@/lib/readalong/importer";
import { isId } from "@/lib/readalong/http";
import { serveStoredFile } from "@/lib/serve-file";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Plays an uploaded audiobook (M13 (d)): audio file number `n` (from 0) of a
 * finished read-along import, to the book's owner only.
 *
 * Checked by the sign-in cookie, not by a signed link like /api/files. An
 * audio element keeps asking for byte ranges for as long as it plays (hours,
 * for an audiobook), and a link that expires on the way stops Chromium with
 * an error and leaves Safari's engine retrying refused requests without end
 * (found by the skeptics of docs/m13-player-plan.md). The cookie is httpOnly
 * and SameSite=Lax, so another site cannot use it, and a copied address is of
 * no use to anyone but the owner. This path skips proxy.ts (see its matcher),
 * so the sign-in check comes first here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; importId: string; n: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: bookId, importId, n } = await params;
  if (!isId(bookId) || !isId(importId) || !/^\d{1,4}$/.test(n)) return Response.json({ error: "Not found" }, { status: 404 });
  const audio = await importAudio(await getDb(), user.id, bookId, importId, Number(n));
  if (!audio) return Response.json({ error: "Not found" }, { status: 404 });
  return serveStoredFile(req, await getStorage(), audio.key);
}
