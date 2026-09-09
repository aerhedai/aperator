import * as agentRepository from "@/lib/agents/agent-repository";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import type { AgentInput } from "@/lib/agents/schemas";
import { Prisma, type AgentStatus } from "@/lib/generated/prisma/client";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import * as integrationService from "@/lib/integrations/integration-service";
import { parseMcpToolName } from "@/lib/integrations/mcp/tool-naming";
import { getToolProvider, TOOL_NAMES } from "@/lib/mcp/tool-registry";

export function listAgents(organisationId: string) {
  return agentRepository.findAgentsByOrganisation(organisationId);
}

export function getAgent(organisationId: string, id: string) {
  return agentRepository.findAgentById(organisationId, id);
}

// actionTool resolves to GMAIL_SEND_EMAIL or OUTLOOK_SEND_EMAIL at run time
// (see lib/harness/propose-action.ts's resolveActionTool) depending on
// which of these two the bound account actually is — so the bound account
// itself must be one of those two providers. Re-checked here (not trusted
// from the form) since the id itself is organisation-scoped by
// findIntegrationById, but nothing before this point confirms it's
// actually an email account at all.
const ACTION_ACCOUNT_PROVIDERS = ["gmail", "outlook"];

// Returns the bound account's provider (for validateToolProvidersMatchBoundAccount
// below), or null when no account is bound.
async function validateActionIntegration(
  organisationId: string,
  actionIntegrationId: string | null,
): Promise<string | null> {
  if (!actionIntegrationId) {
    return null;
  }
  const integration = await integrationRepository.findIntegrationById(
    organisationId,
    actionIntegrationId,
  );
  if (!integration) {
    throw new Error("Connected account not found");
  }
  if (!ACTION_ACCOUNT_PROVIDERS.includes(integration.provider)) {
    throw new Error(
      `The action account must be a Gmail or Outlook account, not a ${integration.provider} one`,
    );
  }
  return integration.provider;
}

// A granted provider-specific tool (GMAIL_SEND_EMAIL, SLACK_POST_MESSAGE, ...)
// must match whichever provider this agent is actually bound to — granting
// GMAIL_SEND_EMAIL to an agent pinned to an Outlook account would look
// grantable but silently never work (createMcpServer only forwards the
// pinned account into the tool(s) whose own provider matches, so the
// mismatched tool would fall back to the organisation's default account
// instead of erroring, an easy-to-miss surprise). Only email-family tools
// are constrained by actionIntegrationId today — ACTION_ACCOUNT_PROVIDERS
// restricts the bound account to gmail/outlook, so a granted Slack/Teams/
// Outlook Calendar/Drive/SharePoint tool has no per-agent binding to check
// against yet and is skipped here.
function validateToolProvidersMatchBoundAccount(
  toolNames: string[],
  boundProvider: string | null,
): void {
  if (!boundProvider) return;
  for (const toolName of toolNames) {
    const provider = getToolProvider(toolName);
    if (provider !== "gmail" && provider !== "outlook") continue;
    if (provider !== boundProvider) {
      throw new Error(
        `"${toolName}" needs a ${provider === "gmail" ? "Gmail" : "Outlook"} account, but this agent is bound to a ${boundProvider} one.`,
      );
    }
  }
}

// A distinct error type — not just a distinctively-worded Error — so
// callers (app/(shell)/(app)/agents/actions.ts) can tell "this tool grant
// doesn't exist" apart from other failure modes (most importantly
// updateAgent's own "Agent not found" case below) with an `instanceof`
// check rather than matching on message text, which would silently break
// the moment either message's wording changed.
export class ToolGrantError extends Error {}

// Every granted tool name must be either a fixed built-in tool
// (lib/mcp/tool-registry.ts) or a tool this organisation's own connected
// MCP server actually reports having (lib/integrations/mcp/tool-naming.ts
// + findMcpTool) — checked here, before anything is written, so a
// loosened Zod schema (any non-empty string, see schemas.ts) can never by
// itself let an agent be granted a tool name that isn't real, including
// one naming a different organisation's MCP connection.
async function validateToolGrants(
  organisationId: string,
  toolNames: string[],
): Promise<void> {
  for (const toolName of toolNames) {
    if ((TOOL_NAMES as readonly string[]).includes(toolName)) continue;

    const parsed = parseMcpToolName(toolName);
    if (!parsed) {
      throw new ToolGrantError(`"${toolName}" is not a valid tool.`);
    }

    const tool = await integrationService.findMcpTool(
      organisationId,
      parsed.integrationId,
      parsed.remoteToolName,
    );
    if (!tool) {
      throw new ToolGrantError(
        `"${toolName}" does not exist on any of this organisation's connected MCP servers.`,
      );
    }
  }
}

export async function createAgent(organisationId: string, input: AgentInput) {
  const { toolNames, ...agentColumns } = input;
  const boundProvider = await validateActionIntegration(
    organisationId,
    input.actionIntegrationId,
  );
  validateToolProvidersMatchBoundAccount(toolNames, boundProvider);
  await validateToolGrants(organisationId, toolNames);
  const agent = await agentRepository.createAgent(organisationId, agentColumns);
  await agentToolRepository.setToolsForAgent(agent.id, toolNames);
  return agent;
}

export async function updateAgent(
  organisationId: string,
  id: string,
  input: AgentInput,
) {
  const { toolNames, ...agentColumns } = input;
  const boundProvider = await validateActionIntegration(
    organisationId,
    input.actionIntegrationId,
  );
  validateToolProvidersMatchBoundAccount(toolNames, boundProvider);
  await validateToolGrants(organisationId, toolNames);
  const result = await agentRepository.updateAgent(
    organisationId,
    id,
    agentColumns,
  );
  if (result.count === 0) {
    throw new Error("Agent not found");
  }
  await agentToolRepository.setToolsForAgent(id, toolNames);
}

export async function updateAgentStatus(
  organisationId: string,
  id: string,
  status: AgentStatus,
) {
  const result = await agentRepository.updateAgentStatus(
    organisationId,
    id,
    status,
  );
  if (result.count === 0) {
    throw new Error("Agent not found");
  }
}

export async function deleteAgent(
  organisationId: string,
  id: string,
): Promise<boolean> {
  try {
    const { count } = await agentRepository.deleteAgent(organisationId, id);
    return count > 0;
  } catch (error) {
    // P2003: foreign key constraint failed — this agent has real run
    // history (AgentRun.agent is deliberately not cascaded, see
    // agent-repository.ts). Archiving removes it from workflow dispatch
    // just as completely without destroying that history.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      throw new Error(
        "This agent has run history and can't be deleted — archive it instead.",
      );
    }
    throw error;
  }
}
