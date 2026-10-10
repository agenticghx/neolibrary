import { currentUser } from "@/lib/auth/session";
import { trackAudioKey } from "@/lib/library/audio";
import { serveStoredFile } from "@/lib/serve-file";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Plays a paragraph made by an AI voice: its stored file, to its owner only
 * (the file's address is built from the signed-in reader's own id, so no one
 * else's file can be named).
 *
 * Checked by the sign-in cookie, not by a signed link like /api/files, for the
 * reason the uploaded audiobook's route gives (readalong/[importId]/audio/[n]):
 * an audio element asks for byte ranges for as long as it plays, and a link
 * that expires on the way is refused. A PDF page's audio lasts minutes; on
 * 2026-10-10 a reader paused one, pressed Play after half an hour, and the
 * player's request for the rest of the file was refused (403): the word being
 * read stopped moving. The cookie is httpOnly and SameSite=Lax, so another
 * site cannot use it, and a copied address is of no use to anyone else.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; track: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id, track } = await params;
  const key = trackAudioKey(user.id, id, track);
  if (!key) return Response.json({ error: "Not found" }, { status: 404 });
  return serveStoredFile(req, await getStorage(), key);
}
