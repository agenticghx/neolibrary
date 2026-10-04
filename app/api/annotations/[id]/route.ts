import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { AnnotationError, deleteAnnotation, history, updateAnnotation } from "@/lib/library/annotations";

export const dynamic = "force-dynamic";

const fail = (e: unknown) => {
  if (e instanceof AnnotationError) return Response.json({ error: e.message }, { status: e.message.includes("not found") ? 404 : 400 });
  throw e;
};

/** Every version of one annotation (nothing is ever overwritten). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const versions = await history(await getDb(), user.id, (await params).id);
  if (!versions.length) return Response.json({ error: "Annotation not found." }, { status: 404 });
  return Response.json({ versions });
}

/** Changes colour or note text: { color?, body? } (adds a new version). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    return Response.json(await updateAnnotation(await getDb(), user.id, (await params).id, await req.json().catch(() => ({}))));
  } catch (e) {
    return fail(e);
  }
}

/** Hides an annotation (a new version marked deleted). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    await deleteAnnotation(await getDb(), user.id, (await params).id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fail(e);
  }
}
