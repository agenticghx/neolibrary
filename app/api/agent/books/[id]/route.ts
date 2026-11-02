import { agentBook } from "@/lib/agent/library";
import { withAgent } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

/** One of the reader's own books in detail (M40 S4): its kind, whether it is a scan with a text edition, its cover. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAgent(req, async ({ db, user }) => ({ book: await agentBook(db, user.id, id) }));
}
