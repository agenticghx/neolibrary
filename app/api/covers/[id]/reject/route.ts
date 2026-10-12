import { currentUser } from "@/lib/auth/session";
import { CoverSourceError, getCoverSource } from "@/lib/covers/sources";
import { getDb } from "@/lib/db";
import { CoverError, rejectCover } from "@/lib/library/cover-lookup";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * "Not this cover" (M22): the found cover is removed and never offered again for this title; the next match
 * takes its place at once ({ status: "replaced" }), or the drawn cover comes back ({ status: "cleared" }).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  try {
    const status = await rejectCover(await getDb(), await getStorage(), getCoverSource(), user.id, id);
    return Response.json({ status });
  } catch (e) {
    if (e instanceof CoverError) return Response.json({ error: e.message }, { status: e.message === "Book not found." ? 404 : 400 });
    // Turned down already; only the search for the next one failed.
    if (e instanceof CoverSourceError) return Response.json({ status: "cleared", error: "The catalogue could not be asked for another cover just now; the next lookup will try." }, { status: 200 });
    throw e;
  }
}
