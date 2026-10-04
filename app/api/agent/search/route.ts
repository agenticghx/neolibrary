import { agentSearch } from "@/lib/agent/library";
import { withAgent } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

/** Full-text search across the reader's books (M11 agent API): `?q=…&limit=20`. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  return withAgent(req, async ({ db, user }) => ({
    results: await agentSearch(db, user.id, params.get("q") ?? "", Number(params.get("limit") ?? 20)),
  }));
}
