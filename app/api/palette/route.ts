import { currentUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { paletteData } from "@/lib/palette/data";

export const dynamic = "force-dynamic";

/** What the command palette (Cmd+K or Ctrl+K, M21) can jump to: the reader's books, Paths and newest notes. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json(await paletteData(await getDb(), user.id), { headers: { "cache-control": "private, no-store" } });
}
