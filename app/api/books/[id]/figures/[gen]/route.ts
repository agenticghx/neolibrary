import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { figureRedrawSvg } from "@/lib/library/figure-redraws";
import { getBook } from "@/lib/library/paths";

export const dynamic = "force-dynamic";

/**
 * M41 R6: one redrawn figure, as a picture for the reader's page (an <img>, where a browser runs no code in an SVG).
 * For anyone who may read the book. Never a page of this site: the sandbox policy and nosniff, as for stored files.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; gen: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id, gen } = await params;
  const db = await getDb();
  const found = await getBook(db, user.id, id);
  if (!found || !found.available.read) return Response.json({ error: "Not found" }, { status: 404 });
  const svg = await figureRedrawSvg(db, found.book, gen.replace(/\.svg$/, ""));
  if (!svg) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // A redraw's row is never changed (a newer one has a new address), so the browser may keep it.
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
