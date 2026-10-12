import { currentUser } from "@/lib/auth/session";
import { CoverSourceError, getCoverSource } from "@/lib/covers/sources";
import { getDb } from "@/lib/db";
import { chooseCover, CoverError } from "@/lib/library/cover-lookup";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * "Use this cover" (C3a): the result the reader chose from their own search ({ choice }, its code) becomes the
 * title's cover, in place of a found one (never offered again) or as its first.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { choice?: unknown } | null;
  if (typeof body?.choice !== "string") return Response.json({ error: "Say which cover to use." }, { status: 400 });
  try {
    await chooseCover(await getDb(), await getStorage(), getCoverSource(), user.id, id, body.choice);
    return Response.json({ status: "chosen" });
  } catch (e) {
    if (e instanceof CoverError) return Response.json({ error: e.message }, { status: e.message === "Book not found." ? 404 : 400 });
    if (e instanceof CoverSourceError) return Response.json({ error: "The catalogue could not send the picture just now. Try again in a moment." }, { status: 502 });
    throw e;
  }
}
