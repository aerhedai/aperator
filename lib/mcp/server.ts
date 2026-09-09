import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import type { AIProvider } from "@/lib/ai/provider";
import * as agentRepository from "@/lib/agents/agent-repository";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import * as integrationService from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";
import { createCreateRecordTool } from "@/lib/mcp/tools/create-record";
import { createFindRecordTool } from "@/lib/mcp/tools/find-record";
import { createGoogleDriveCreateFolderTool } from "@/lib/mcp/tools/google-drive-create-folder";
import { createGoogleDrivePopulateTemplateTool } from "@/lib/mcp/tools/google-drive-populate-template";
import { createGoogleDriveSaveFileTool } from "@/lib/mcp/tools/google-drive-save-file";
import { createInstallTemplateTool } from "@/lib/mcp/tools/install-template";
import { createInstallWorkflowTemplateTool } from "@/lib/mcp/tools/install-workflow-template";
import { createInvokeAgentTool } from "@/lib/mcp/tools/invoke-agent";
import { createListInvokableTool } from "@/lib/mcp/tools/list-invokable";
import { createInvokeWorkflowTool } from "@/lib/mcp/tools/invoke-workflow";
import { createListTemplatesTool } from "@/lib/mcp/tools/list-templates";
import { createMcpProxyTool } from "@/lib/mcp/tools/mcp-proxy-tool";
import { createOutlookCheckCalendarAvailabilityTool } from "@/lib/mcp/tools/outlook-check-calendar-availability";
import { createOutlookCreateCalendarEventTool } from "@/lib/mcp/tools/outlook-create-calendar-event";
import { createGmailReadInboxTool } from "@/lib/mcp/tools/gmail-read-inbox";
import { createGmailSendEmailTool } from "@/lib/mcp/tools/gmail-send-email";
import { createOutlookReadInboxTool } from "@/lib/mcp/tools/outlook-read-inbox";
import { createOutlookSendEmailTool } from "@/lib/mcp/tools/outlook-send-email";
import { createSearchKnowledgeTool } from "@/lib/mcp/tools/search-knowledge";
import { createSearchRecordsTool } from "@/lib/mcp/tools/search-records";
import { createSharePointCreateFolderTool } from "@/lib/mcp/tools/sharepoint-create-folder";
import { createSharePointPopulateTemplateTool } from "@/lib/mcp/tools/sharepoint-populate-template";
import { createSharePointSaveFileTool } from "@/lib/mcp/tools/sharepoint-save-file";
import { createSlackPostMessageTool } from "@/lib/mcp/tools/slack-post-message";
import { createTeamsPostMessageTool } from "@/lib/mcp/tools/teams-post-message";
import { createUpdateRecordTool } from "@/lib/mcp/tools/update-record";
import * as workflowService from "@/lib/workflows/workflow-service";

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
 * provider (e.g. a Gmail address) — every provider-specific tool
 * (GMAIL_SEND_EMAIL, SLACK_POST_MESSAGE, ...) only ever needs the pin
 * forwarded when it's actually that tool's own provider; otherwise
 * undefined, so the tool falls back to its provider's organisation default
 * instead of receiving a pin that belongs to a different provider entirely.
 *
 * callerAgentId identifies which agent this server instance's calls are
 * made on behalf of — invoke_agent is the one tool that needs to know who
 * is calling, both to exclude it from its own invokable list and to check
 * invocation depth. Every other tool ignores it. invocationDepth is
 * forwarded to invoke_agent's own
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

  const gmailId = pinnedFor("gmail");
  const outlookId = pinnedFor("outlook");
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

  // Gmail
  register(createGmailReadInboxTool(organisationId, gmailId), readOnly);
  register(createGmailSendEmailTool(organisationId, gmailId));

  // Outlook
  register(createOutlookReadInboxTool(organisationId, outlookId), readOnly);
  register(createOutlookSendEmailTool(organisationId, outlookId));

  // Slack
  register(createSlackPostMessageTool(organisationId, slackId));

  // Teams
  register(createTeamsPostMessageTool(organisationId, teamsId));

  // Outlook Calendar
  register(
    createOutlookCheckCalendarAvailabilityTool(organisationId, calendarId),
    readOnly,
  );
  register(createOutlookCreateCalendarEventTool(organisationId, calendarId));

  // Google Drive
  register(createGoogleDriveCreateFolderTool(organisationId));
  register(createGoogleDriveSaveFileTool(organisationId));
  register(createGoogleDrivePopulateTemplateTool(organisationId));

  // SharePoint
  register(createSharePointCreateFolderTool(organisationId));
  register(createSharePointSaveFileTool(organisationId));
  register(createSharePointPopulateTemplateTool(organisationId));

  // Orchestration — list_invokable first: it re-queries live at call time
  // (unlike invoke_agent/invoke_workflow's own descriptions below, which
  // are fixed strings computed once when this server is built and can go
  // stale for the rest of a turn the moment something is installed
  // mid-loop) — see its own doc comment for why that distinction matters.
  register(createListInvokableTool(organisationId, callerAgentId), readOnly);

  // Every active agent in the org is invokable by default
  // (Agent.chatInvokable), so the set the model is actually told about is
  // computed fresh here rather than read from a per-caller grant table.
  // CHAT-mode agents are excluded (nothing invokes the one chat agent an
  // org has), as is the caller itself.
  const invokableAgents = callerAgentId
    ? (await agentRepository.findAgentsByOrganisation(organisationId))
        .filter(
          (a) =>
            a.id !== callerAgentId &&
            a.status === "ACTIVE" &&
            a.executionMode !== "CHAT" &&
            a.chatInvokable,
        )
        .map((a) => ({ id: a.id, name: a.name, description: a.description }))
    : [];
  register(
    createInvokeAgentTool(
      organisationId,
      callerAgentId,
      invocationDepth,
      aiProvider,
      invokableAgents,
    ),
  );
  // Every ACTIVE workflow is invokable — a workflow has no per-agent grant
  // to check (unlike invoke_agent's chatInvokable), since asking a
  // department to handle something is gated only by whether that
  // department is actually running, not by an explicit allow-list.
  const invokableWorkflows = (
    await workflowService.listWorkflows(organisationId)
  )
    .filter((w) => w.status === "ACTIVE")
    .map((w) => ({ id: w.id, name: w.name, description: w.description }));
  register(
    createInvokeWorkflowTool(
      organisationId,
      invocationDepth,
      aiProvider,
      invokableWorkflows,
    ),
  );
  register(createListTemplatesTool(organisationId), readOnly);
  register(createInstallTemplateTool(organisationId));
  register(createInstallWorkflowTemplateTool(organisationId));

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
