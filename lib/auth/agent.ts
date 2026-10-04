import { getDb } from "@/lib/db";
import { agentUnauthorised } from "./agent-401";
import type { PublicUser } from "./service";
import { bearerToken, userForApiToken } from "./tokens";

/**
 * For `/api/agent/*` routes: the user whose API token is in the request's
 * `Authorization: Bearer` header and the token's name (marked on notes the
 * agent adds), or a 401 response to return as is. Cookies are ignored here,
 * so these routes act only with a token.
 */
export async function agentUser(req: Request): Promise<{ user: PublicUser; agent: string } | Response> {
  const found = await userForApiToken(await getDb(), bearerToken(req.headers.get("authorization")));
  return found ? { user: found.user, agent: found.tokenName } : agentUnauthorised();
}
