import { agentUser } from "@/lib/auth/agent";

export const dynamic = "force-dynamic";

/** Who this API token acts for (M11): a first call for an agent to check its token. */
export async function GET(req: Request) {
  const user = await agentUser(req);
  if (user instanceof Response) return user;
  return Response.json({ id: user.id, name: user.name, email: user.email });
}
