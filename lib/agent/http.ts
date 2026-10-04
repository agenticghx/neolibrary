import type { PublicUser } from "@/lib/auth/service";
import { agentUser } from "@/lib/auth/agent";
import { getDb } from "@/lib/db";
import type { Db } from "@/lib/db/client";
import { AgentError } from "./library";

/** Runs an agent route: checks the token, then turns AgentError into a JSON error with its status. */
export async function withAgent(req: Request, run: (ctx: { db: Db; user: PublicUser; agent: string }) => Promise<unknown>, status = 200) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  try {
    return Response.json(await run({ db: await getDb(), ...who }), { status });
  } catch (e) {
    if (e instanceof AgentError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
