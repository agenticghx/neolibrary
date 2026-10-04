import { agentBooks } from "@/lib/agent/library";
import { withAgent } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

/** The reader's books (M11 agent API). `?q=` filters by title or author. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return withAgent(req, async ({ db, user }) => ({ books: await agentBooks(db, user.id, q) }));
}
