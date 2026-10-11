import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getBook } from "@/lib/library/paths";
import { serverSecret } from "@/lib/secrets";
import { signFileUrl } from "@/lib/signed-url";

export const dynamic = "force-dynamic";

/**
 * A fresh five-minute link to the book's file (M20 Q3). The reader page's own
 * link expires five minutes after the page opened, so "Download for offline"
 * asks for a new one at the moment it downloads.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const db = await getDb();
  const found = await getBook(db, user.id, (await params).id);
  if (!found || !found.available.read || !found.book.fileKey) return Response.json({ error: "Book not found." }, { status: 404 });
  return Response.json({ url: signFileUrl(await serverSecret(db, "file-links"), found.book.fileKey) }, { headers: { "cache-control": "no-store" } });
}
