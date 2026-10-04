import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { agentUser } from "@/lib/auth/agent";
import { buildMcpServer } from "@/lib/agent/mcp";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The MCP endpoint (M11), Streamable HTTP in stateless mode: every request
 * builds a server for the token's user and nothing is kept between requests,
 * so it works on any number of app instances. Answers are JSON, not streams.
 */
async function handle(req: Request) {
  const who = await agentUser(req);
  if (who instanceof Response) return who;
  const server = buildMcpServer(await getDb(), who.user.id, who.agent);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
