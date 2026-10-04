import { getDb } from "@/lib/db";
import { agentUnauthorised } from "./agent-401";
import type { PublicUser } from "./service";
import { bearerToken, userForApiToken } from "./tokens";

/**
 * For `/api/agent/*` routes: the user whose API token is in the request's
 * `Authorization: Bearer` header, or a 401 response to return as is.
 * Cookies are ignored here, so these routes act only with a token.
 */
export async function agentUser(req: Request): Promise<PublicUser | Response> {
  const user = await userForApiToken(await getDb(), bearerToken(req.headers.get("authorization")));
  return user ?? agentUnauthorised();
}
