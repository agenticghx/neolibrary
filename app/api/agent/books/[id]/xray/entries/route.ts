import { agentXray } from "@/lib/agent/library";
import { withAgent } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

/** A book's whole X-ray (M40 S4): every entry with its facts and the book's own words for each, for checking. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAgent(req, async ({ db, user }) => ({ entries: await agentXray(db, user.id, id) }));
}
