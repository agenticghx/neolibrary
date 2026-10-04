/** The answer to an agent request without a valid API token (used by proxy.ts and lib/auth/agent.ts). */
export function agentUnauthorised() {
  return Response.json(
    { error: "A valid API token is required: send it as 'Authorization: Bearer <token>'. Make one on the Agent access page." },
    { status: 401, headers: { "www-authenticate": 'Bearer realm="neolibrary"' } },
  );
}
