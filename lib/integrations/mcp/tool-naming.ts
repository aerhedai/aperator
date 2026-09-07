// A tool discovered from an external MCP server's tools/list response —
// cached on the owning Integration row's config.tools. readOnlyHint comes
// straight from the remote server's own (untrusted, per the MCP spec's own
// warning) annotations — used only to relax the approval gate, never to
// grant anything that wasn't already explicitly granted.
export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  readOnlyHint: boolean | null;
}

const PREFIX = "mcp:";

// The namespace exists only so the name is unique inside Aperator's own
// tool list — it is never sent to the remote server, which only ever
// hears its own real tool name (see external-client.ts's callExternalMcpTool).
// remoteToolName may itself contain colons (MCP doesn't forbid it), so
// parsing splits on the first colon after the integration id, not every
// colon in the string.
export function buildMcpToolName(
  integrationId: string,
  remoteToolName: string,
): string {
  return `${PREFIX}${integrationId}:${remoteToolName}`;
}

export function parseMcpToolName(
  toolName: string,
): { integrationId: string; remoteToolName: string } | null {
  if (!toolName.startsWith(PREFIX)) return null;
  const rest = toolName.slice(PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) return null;
  return {
    integrationId: rest.slice(0, separatorIndex),
    remoteToolName: rest.slice(separatorIndex + 1),
  };
}
