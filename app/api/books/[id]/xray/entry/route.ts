import { SpendingCapReached } from "@/lib/ai/generate";
import { aiIsFake, getTextModel } from "@/lib/ai/index";
import { AiError, AiNotConfigured, AiRefused } from "@/lib/ai/model";
import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { XrayError } from "@/lib/library/xray";
import { askWorld, entryOf, estimateWorld, libraryLinks, storedWorld } from "@/lib/library/xray-layers";

export const dynamic = "force-dynamic";

const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const isEntry = (s: string) => /^x-[0-9a-f]{12}$/.test(s);

function errorResponse(e: unknown) {
  if (e instanceof XrayError) return Response.json({ error: e.message }, { status: 404 });
  if (e instanceof SpendingCapReached) return Response.json({ error: e.message }, { status: 429 });
  if (e instanceof AiNotConfigured) return Response.json({ error: e.message }, { status: 503 });
  if (e instanceof AiRefused) return Response.json({ error: e.message }, { status: 422 });
  if (e instanceof AiError) return Response.json({ error: e.message }, { status: 502 });
  throw e;
}

/**
 * A name's two outer layers (M32 X4): `?entry=` names it. GET: the same name
 * in the reader's other books, the stored "from the world" note if any, and
 * what asking for one would cost. POST { entry, fresh? }: asks Claude.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const entryId = new URL(req.url).searchParams.get("entry") ?? "";
  if (!isEntry(entryId)) return Response.json({ error: "Which name?" }, { status: 400 });
  const db = await getDb();
  try {
    const entry = await entryOf(db, user.id, bookId, entryId);
    const library = await libraryLinks(db, user.id, bookId, entry);
    const world = await storedWorld(db, user.id, bookId, entry);
    let estimate: number | null = null;
    try {
      estimate = await estimateWorld(db, getTextModel("xray-world"), user.id, bookId, entry);
    } catch (e) {
      if (!(e instanceof AiNotConfigured)) throw e;
    }
    return Response.json({ library, world, estimate, fake: aiIsFake() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!isId(bookId)) return Response.json({ error: "Book not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { entry?: unknown; fresh?: unknown };
  const entryId = typeof body.entry === "string" ? body.entry : "";
  if (!isEntry(entryId)) return Response.json({ error: "Which name?" }, { status: 400 });
  const db = await getDb();
  try {
    const entry = await entryOf(db, user.id, bookId, entryId);
    const { world, reused } = await askWorld(db, getTextModel("xray-world"), user.id, bookId, entry, { fresh: body.fresh === true });
    return Response.json({ world, reused }, { status: reused ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
