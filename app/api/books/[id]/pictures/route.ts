import { SpendingCapReached, type Generation } from "@/lib/ai/generate";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getImageGenerator, ImageGenerationError, ImageGenerationNotConfigured } from "@/lib/images/generate";
import { estimatePicture, makePicture, PictureError, storedPicture } from "@/lib/library/pictures";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

async function view(g: Generation | null) {
  if (!g) return null;
  const secret = await serverSecret(await getDb(), "file-links");
  return {
    id: g.id,
    subject: g.options.subject,
    key: g.output,
    url: signFileUrl(secret, g.output),
    model: g.provenance.model,
    costUsd: g.provenance.costUsd,
    createdAt: g.provenance.createdAt,
  };
}

function errorResponse(e: unknown) {
  if (e instanceof PictureError) return Response.json({ error: e.message }, { status: e.message === "Book not found." ? 404 : 400 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof ImageGenerationNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof ImageGenerationError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/** A generated picture already made for `?subject=` (if any) and what making one costs. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const subject = new URL(req.url).searchParams.get("subject") ?? "";
  try {
    const stored = await storedPicture(await getDb(), user.id, (await params).id, subject);
    let configured = true;
    try {
      getImageGenerator();
    } catch (e) {
      if (!(e instanceof ImageGenerationNotConfigured)) throw e;
      configured = false;
    }
    return Response.json({ picture: await view(stored), estimate: configured ? estimatePicture() : null });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Makes a picture of { subject } (or re-serves the one already made). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { subject?: unknown };
  try {
    const out = await makePicture(await getDb(), await getStorage(), getImageGenerator(), user.id, { bookId: (await params).id, subject: body.subject });
    return Response.json({ picture: await view(out.generation), reused: out.reused }, { status: out.reused ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
