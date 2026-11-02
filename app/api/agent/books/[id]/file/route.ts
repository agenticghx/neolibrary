import { AgentError, agentBookFile } from "@/lib/agent/library";
import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { serveStoredFile } from "@/lib/serve-file";

export const dynamic = "force-dynamic";

/**
 * One of the reader's own book files (M40 S4), for work done on the laptop with the owner's token, such as reading a
 * scanned book into a text edition overnight (S6). Only the token's own books; another reader's is "not found".
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  const { id } = await params;
  try {
    const file = await agentBookFile(await getDb(), who.user.id, id);
    return serveStoredFile(req, await getStorage(), file.key);
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
