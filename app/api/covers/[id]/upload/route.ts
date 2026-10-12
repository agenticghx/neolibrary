import { currentUser } from "@/lib/auth/session";
import { MAX_COVER_BYTES } from "@/lib/covers/image";
import { getDb } from "@/lib/db";
import { CoverError, uploadCover } from "@/lib/library/cover-lookup";
import { bodyBytes } from "@/lib/readalong/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * "Use your own picture" (C3b): the request's body is the picture (a JPEG, PNG or WebP, at most 3 MB, sent with its
 * own content type), and it becomes the title's cover, in place of a found one or as its first. Its bytes are
 * checked on the server, whatever the browser said.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!PICTURE_TYPES.includes(type)) return Response.json({ error: "Choose a JPEG, PNG or WebP picture." }, { status: 415 });
  const data = await bodyBytes(req, MAX_COVER_BYTES);
  if (data instanceof Response) return Response.json({ error: "That picture is larger than 3 MB." }, { status: 413 });
  if (!data.byteLength) return Response.json({ error: "No picture received." }, { status: 400 });
  try {
    await uploadCover(await getDb(), await getStorage(), user.id, (await params).id, data);
    return Response.json({ status: "uploaded" });
  } catch (e) {
    if (e instanceof CoverError) return Response.json({ error: e.message }, { status: e.message === "Book not found." ? 404 : 400 });
    throw e;
  }
}
