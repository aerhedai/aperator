import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import type { AIProvider } from "@/lib/ai/provider";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import * as integrationService from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";
import { createCheckCalendarAvailabilityTool } from "@/lib/mcp/tools/check-calendar-availability";
import { createCreateCalendarEventTool } from "@/lib/mcp/tools/create-calendar-event";
import { createCreateFolderTool } from "@/lib/mcp/tools/create-folder";
import { createCreateRecordTool } from "@/lib/mcp/tools/create-record";
import { createFindRecordTool } from "@/lib/mcp/tools/find-record";
import { createInvokeAgentTool } from "@/lib/mcp/tools/invoke-agent";
import { createMcpProxyTool } from "@/lib/mcp/tools/mcp-proxy-tool";
import { createNotifyChannelTool } from "@/lib/mcp/tools/notify-channel";
import { createPopulateTemplateTool } from "@/lib/mcp/tools/populate-template";
import { createSaveFileTool } from "@/lib/mcp/tools/save-file";
import { createSearchKnowledgeTool } from "@/lib/mcp/tools/search-knowledge";
import { createSearchRecordsTool } from "@/lib/mcp/tools/search-records";
import { createSendEmailTool } from "@/lib/mcp/tools/send-email";
import { createUpdateRecordTool } from "@/lib/mcp/tools/update-record";

// Marks a tool as having no side effects. Read-only tools are never
// approval-gated (lib/policies/policy-engine.ts); the tools that mutate
// external state carry explicit policy rules instead of relying on the
// default ALLOW.
const readOnly = { readOnlyHint: true };

// Mirrors registerTool's own generics rather than restating them, so a
// tool's argument types still flow through to its handler exactly as they
// would at a direct call site — this helper removes the repetition without
// weakening any of the type checking it replaced. Every tool factory in
// tools/ returns this shape.
interface ToolDefinition<
  InputArgs extends ZodRawShapeCompat,
  OutputArgs extends ZodRawShapeCompat,
> {
  name: string;
  description: string;
  inputSchema: InputArgs;
  outputSchema: OutputArgs;
  handler: ToolCallback<InputArgs>;
}

/**
 * organisationId is required (not defaulted via getCurrentOrganisation
 * internally) so every caller has to state which organisation's tools this
 * server instance serves — send_email needs it to look up the right
 * credentials, and CLAUDE.md §13 requires every organisation-scoped action
 * to be explicitly scoped, not resolved via a global fallback deep inside
 * a tool handler. actionIntegrationId (an agent's
 * Agent.actionIntegrationId) similarly pins which *specific* connected
 * account action tools use — null/undefined keeps the "organisation's
 * default account" behavior.
 *
 * An agent's actionIntegrationId is a single field shared across all of
 * its granted action tools, but a pinned account only ever belongs to one
 * provider (e.g. a Gmail address) — forwarding it unconditionally into
 * every action tool would make notify_channel hard-error ("not a Slack
 * account") for an agent pinned to Gmail, or vice versa. Resolved once
 * here and only forwarded into the tool(s) whose own provider matches;
 * otherwise undefined, so that tool falls back to its own provider's
 * organisation default instead of failing. send_email is provider-agnostic
 * across Gmail/Outlook, so it matches either.
 *
 * callerAgentId identifies which agent this server instance's calls are
 * made on behalf of — invoke_agent is the one tool that needs to know who
 * is calling, to check its AgentInvocationGrant allow-list. Every other
 * tool ignores it. invocationDepth is forwarded to invoke_agent's own
 * recursion guard. aiProvider, if supplied, is the already-resolved
 * AIProvider the calling run is itself using — invoke_agent reuses it
 * rather than resolving its own, and falls back to resolving one itself
 * only if it's omitted (see invoke-agent.ts). Named distinctly from the
 * `provider` string below (an Integration.provider value, e.g. "gmail") —
 * unrelated concepts that happen to share a common short name.
 */
export async function createMcpServer(
  organisationId: string,
  actionIntegrationId?: string | null,
  callerAgentId?: string,
  invocationDepth = 0,
  aiProvider?: AIProvider,
): Promise<McpServer> {
  const server = new McpServer({ name: "aperator-tools", version: "0.1.0" });

  const provider = actionIntegrationId
    ? ((
        await integrationService.getIntegration(
          organisationId,
          actionIntegrationId,
        )
      )?.provider ?? null)
    : null;
  const pinnedFor = (...providers: string[]) =>
    provider && providers.includes(provider) ? actionIntegrationId : undefined;

  const emailId = pinnedFor("gmail", "outlook");
  const slackId = pinnedFor("slack");
  const teamsId = pinnedFor("teams");
  const calendarId = pinnedFor("outlook-calendar");

  const register = <
    InputArgs extends ZodRawShapeCompat,
    OutputArgs extends ZodRawShapeCompat,
  >(
    tool: ToolDefinition<InputArgs, OutputArgs>,
    annotations?: typeof readOnly,
  ) => {
    // An empty outputSchema shape ({}) is not the same thing as "no output
    // schema" to the SDK: an empty raw shape is still a valid raw shape
    // (isZodRawShapeCompat treats {} as "a tool with no parameters"), so it
    // gets converted into a Zod/JSON schema that permits *no* properties at
    // all — both the server's own output validation and the calling
    // client's validation would then reject any real structuredContent.
    // Proxy tools for external MCP servers (lib/mcp/tools/mcp-proxy-tool.ts)
    // don't cache the remote's *output* schema (only its input schema), so
    // they pass {} to mean "genuinely unknown" — that must skip output
    // validation entirely, not enforce an empty one. Every built-in tool
    // always declares real output fields, so this is a no-op for them.
    const hasOutputSchema = Object.keys(tool.outputSchema).length > 0;
    server.registerTool<OutputArgs, InputArgs>(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(hasOutputSchema ? { outputSchema: tool.outputSchema } : {}),
        ...(annotations ? { annotations } : {}),
      },
      tool.handler,
    );
  };

  // Read business data
  register(createFindRecordTool(organisationId), readOnly);
  register(createSearchRecordsTool(organisationId), readOnly);
  register(createSearchKnowledgeTool(organisationId), readOnly);

  // Write business data
  register(createCreateRecordTool(organisationId));
  register(createUpdateRecordTool(organisationId));

  // Communicate
  register(createSendEmailTool(organisationId, emailId));
  register(createNotifyChannelTool(organisationId, slackId, teamsId));

  // Calendar
  register(
    createCheckCalendarAvailabilityTool(organisationId, calendarId),
    readOnly,
  );
  register(createCreateCalendarEventTool(organisationId, calendarId));

  // Files
  register(createCreateFolderTool(organisationId));
  register(createSaveFileTool(organisationId));
  register(createPopulateTemplateTool(organisationId));

  // Orchestration
  register(
    createInvokeAgentTool(
      organisationId,
      callerAgentId,
      invocationDepth,
      aiProvider,
    ),
  );

  // Discovered tools from connected external MCP servers — proxied here,
  // one registration per cached tool, so every existing tool-call path
  // (grant checks, policy checks, ToolCall/RunStep recording) applies to
  // them exactly as it does to any built-in tool. One connection failing
  // to load must never break another connection's tools or the built-in
  // ones (see the design spec's error-handling section) — each
  // connection's registration is wrapped so a bad row can't take down the
  // rest of the server build.
  const mcpConnections = await integrationRepository.findIntegrationsByProvider(
    organisationId,
    integrationService.MCP_PROVIDER,
  );
  for (const connection of mcpConnections) {
    try {
      const config = connection.config as unknown as {
        url: string;
        tools: DiscoveredMcpTool[];
      };
      const token = connection.credentials?.token as string | undefined;
      if (!token) continue;
      for (const remoteTool of config.tools) {
        register(
          createMcpProxyTool(connection.id, config.url, token, remoteTool),
          remoteTool.readOnlyHint === true ? readOnly : undefined,
        );
      }
    } catch {
      // Malformed cached config on this one row — skip it, don't fail the
      // whole server build over one bad connection.
      continue;
    }
  }

  return server;
}
