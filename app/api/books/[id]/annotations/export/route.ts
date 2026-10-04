import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { exportBookAnnotations, fileSlug } from "@/lib/library/annotation-export";

export const dynamic = "force-dynamic";

/** Downloads a book's highlights and notes: ?format=md (Markdown) or ?format=w3c (W3C Web Annotation JSON). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const format = new URL(req.url).searchParams.get("format") === "w3c" ? "w3c" : "md";
  const out = await exportBookAnnotations(await getDb(), user.id, (await params).id, format);
  if (!out) return Response.json({ error: "Not found" }, { status: 404 });
  const name = `${fileSlug(out.book.title)}-notes${format === "w3c" ? ".annotations" : ""}.${out.ext}`;
  return new Response(out.body, {
    headers: { "content-type": out.type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
