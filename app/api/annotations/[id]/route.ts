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

/** Changes colour or note text: { color?, body?, changeId? } (adds a new version; a resent changeId adds nothing). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    return Response.json(await updateAnnotation(await getDb(), user.id, (await params).id, await req.json().catch(() => ({}))));
  } catch (e) {
    return fail(e);
  }
}

/** Hides an annotation (a new version marked deleted). `?changeId=` makes a resend harmless. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const changeId = new URL(req.url).searchParams.get("changeId") ?? undefined;
    await deleteAnnotation(await getDb(), user.id, (await params).id, new Date(), changeId);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fail(e);
  }
}
