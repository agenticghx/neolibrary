import { agentUser } from "@/lib/auth/agent";

export const dynamic = "force-dynamic";

/** Who this API token acts for (M11): a first call for an agent to check its token. */
export async function GET(req: Request) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  return Response.json({ id: who.user.id, name: who.user.name, email: who.user.email, token: who.agent });
}
