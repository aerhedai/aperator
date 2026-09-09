import * as integrationService from "@/lib/integrations/integration-service";
import { getAvailableTools } from "@/lib/mcp/scope-tool-map";

// The proactive half of scope-based tool availability
// (docs/provider-specific-tools-design.md) — called at the top of each
// provider-specific tool's handler, before it does any real network work.
//
// Deliberately not implemented by skipping registration in
// lib/mcp/server.ts, even though that was the original plan: grant
// checking (CLAUDE.md #9 step 3) already establishes the pattern that a
// tool a caller can't use is refused in application code before an MCP
// call is ever attempted (lib/runtime/tool-execution.ts's
// recordDisallowedTool) — never by hiding it from the registered tool
// list, which would surface as an opaque MCP protocol "tool not found"
// instead of a clear, actionable message. Checking here, inside the
// handler that already resolves this exact account to fetch a token,
// keeps that same shape: the tool stays discoverable, and an
// insufficient-scope call gets the same friendly message
// translateScopeError produces reactively, just without the wasted
// network round-trip to find out.
//
// Returns null when the call should proceed as normal, including when no
// account is connected at all — that case is left to the existing
// getValidXAccessToken call to report with its own "not connected"
// message, unchanged from before this existed. Only returns a message
// when an account genuinely *is* connected but its granted scope doesn't
// cover this specific tool.
export async function ensureScopeAvailable(
  organisationId: string,
  provider: string,
  integrationId: string | null | undefined,
  toolName: string,
): Promise<string | null> {
  const integration = integrationId
    ? await integrationService.getIntegration(organisationId, integrationId)
    : await integrationService.getDefaultIntegrationByProvider(
        organisationId,
        provider,
      );
  if (!integration) return null;

  const config = integration.config as { grantedScopes?: string[] } | null;
  const grantedScopes = config?.grantedScopes ?? [];
  const available = getAvailableTools(provider, grantedScopes);

  if (available.has(toolName)) return null;
  return "Tool access denied — the connected account no longer grants this permission. Reconnect it from Settings if this capability is still needed.";
}
