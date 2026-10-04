import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AnnotationError, createAnnotation, listAnnotations } from "@/lib/library/annotations";

export const dynamic = "force-dynamic";

/** The signed-in user's current highlights, bookmarks and notes for a book. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const bookId = (await params).id;
  if (!/^[0-9a-f-]{36}$/i.test(bookId)) return Response.json({ annotations: [] });
  return Response.json({ annotations: await listAnnotations(await getDb(), user.id, bookId) });
}

/** Adds a highlight, bookmark or note: { kind, cfi?, quote?, color?, body? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const a = await createAnnotation(await getDb(), user.id, { ...body, bookId: (await params).id });
    return Response.json(a, { status: 201 });
  } catch (e) {
    if (e instanceof AnnotationError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
