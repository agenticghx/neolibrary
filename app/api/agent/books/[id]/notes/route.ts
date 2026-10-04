import { agentAddNote, agentNotes } from "@/lib/agent/library";
import { withAgent } from "@/lib/agent/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The reader's highlights, bookmarks and notes on a book (M11 agent API). */
export async function GET(req: Request, { params }: Params) {
  const bookId = (await params).id;
  return withAgent(req, async ({ db, user }) => ({ notes: await agentNotes(db, user.id, bookId) }));
}

/** Adds a note as the agent: `{ "text": "…", "sectionId": "…" (optional, from a search result) }`. */
export async function POST(req: Request, { params }: Params) {
  const bookId = (await params).id;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return withAgent(req, async ({ db, user, agent }) => ({ note: await agentAddNote(db, user.id, agent, { bookId, text: body.text, sectionId: body.sectionId }) }), 201);
}
