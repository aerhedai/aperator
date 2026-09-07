import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { AIProvider } from "@/lib/ai/provider";
import { createMcpServer } from "@/lib/mcp/server";

/**
 * Connects an MCP client to our own tool server in-process (no HTTP hop —
 * the runtime and the tools live in the same app for now). See CLAUDE.md's
 * MCP architecture discussion: this is the same pattern the app/api/mcp
 * route would use over HTTP, just without the network. actionIntegrationId
 * is passed straight through to createMcpServer — see its doc comment.
 * callerAgentId identifies which agent this client's calls are made on
 * behalf of — invoke_agent needs it to check AgentInvocationGrant; every
 * other tool ignores it. invocationDepth is forwarded to invoke_agent's own
 * recursion guard — see its MAX_INVOCATION_DEPTH. provider is forwarded to
 * invoke_agent so a delegated run uses the same already-resolved provider
 * instance as its caller, rather than re-resolving one — keeps provider
 * resolution "once, at a real request boundary" (see
 * organisation-ai-provider.ts's own doc comment) even though invoke_agent's
 * request boundary is a tool call, not a route handler.
 */
export async function connectMcpClient(
  organisationId: string,
  actionIntegrationId?: string | null,
  callerAgentId?: string,
  invocationDepth = 0,
  provider?: AIProvider,
): Promise<Client> {
  const server = await createMcpServer(
    organisationId,
    actionIntegrationId,
    callerAgentId,
    invocationDepth,
    provider,
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "aperator-runtime", version: "0.1.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return client;
}
