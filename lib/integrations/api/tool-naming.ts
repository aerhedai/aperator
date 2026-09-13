// Per-connection tool naming for generic "Custom API" connections — same
// reasoning as lib/integrations/mcp/tool-naming.ts's buildMcpToolName:
// granting call_api to an agent must mean "call *this* connection," never
// "call any API connection in the org." Simpler than MCP's naming scheme
// because there's no remote tool list to encode — every connection exposes
// exactly one capability (call_api itself), so the built name only ever
// needs to carry the connection's own id.
const PREFIX = "api__";

export function buildApiToolName(integrationId: string): string {
  return `${PREFIX}${integrationId}`;
}

export function parseApiToolName(
  toolName: string,
): { integrationId: string } | null {
  if (!toolName.startsWith(PREFIX)) return null;
  const integrationId = toolName.slice(PREFIX.length);
  if (integrationId.length === 0) return null;
  return { integrationId };
}
