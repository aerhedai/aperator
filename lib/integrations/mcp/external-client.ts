import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";

/**
 * Opens a real network connection to an external MCP server — the first
 * genuinely networked MCP client in this codebase (every in-process one
 * uses InMemoryTransport). No connection pooling: each call site connects,
 * does its work, and closes — a deliberate v1 simplification, see the
 * design spec.
 */
export async function connectExternalMcpClient(
  url: string,
  token: string,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({
    name: "aperator-external-mcp-client",
    version: "0.1.0",
  });
  await client.connect(transport);
  return client;
}

export async function listExternalMcpTools(
  url: string,
  token: string,
): Promise<DiscoveredMcpTool[]> {
  const client = await connectExternalMcpClient(url, token);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: {
        type: "object",
        properties: tool.inputSchema?.properties as
          Record<string, unknown> | undefined,
        required: tool.inputSchema?.required,
      },
      readOnlyHint: tool.annotations?.readOnlyHint ?? null,
    }));
  } finally {
    await client.close();
  }
}

export async function callExternalMcpTool(
  url: string,
  token: string,
  remoteToolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const client = await connectExternalMcpClient(url, token);
  try {
    // Client.callTool()'s declared return type is a fixed union of the
    // modern CallToolResult shape and the pre-2025-03-26 "toolResult"
    // compatibility shape, regardless of which resultSchema argument is
    // passed — an SDK typing gap, not a runtime ambiguity. CallToolResultSchema
    // is already the SDK's own runtime default (passed here only to make
    // that explicit); the client validates the response against it and
    // throws rather than ever returning a "toolResult"-shaped result, so
    // this cast reflects what the call can actually produce.
    return (await client.callTool(
      { name: remoteToolName, arguments: args },
      CallToolResultSchema,
    )) as CallToolResult;
  } finally {
    await client.close();
  }
}
