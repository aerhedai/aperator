import * as agentRepository from "@/lib/agents/agent-repository";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import type { AgentInput } from "@/lib/agents/schemas";
import { Prisma, type AgentStatus } from "@/lib/generated/prisma/client";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import * as integrationService from "@/lib/integrations/integration-service";
import { parseMcpToolName } from "@/lib/integrations/mcp/tool-naming";
import { TOOL_NAMES } from "@/lib/mcp/tool-registry";

export function listAgents(organisationId: string) {
  return agentRepository.findAgentsByOrganisation(organisationId);
}

export function getAgent(organisationId: string, id: string) {
  return agentRepository.findAgentById(organisationId, id);
}

// actionTool is always "send_email" today (no UI to change it yet — see
// Agent.actionTool's schema.prisma comment), which is provider-agnostic
// across Gmail and Outlook Mail (getValidEmailAccessToken resolves
// whichever is actually connected/pinned) — so the bound account must be
// one of those two, not literally Gmail. Re-checked here (not trusted
// from the form) since the id itself is organisation-scoped by
// findIntegrationById, but nothing before this point confirms it's
// actually an email account at all.
const ACTION_ACCOUNT_PROVIDERS = ["gmail", "outlook"];

async function validateActionIntegration(
  organisationId: string,
  actionIntegrationId: string | null,
) {
  if (!actionIntegrationId) {
    return;
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
}

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
      throw new Error(`"${toolName}" is not a valid tool.`);
    }

    const tool = await integrationService.findMcpTool(
      organisationId,
      parsed.integrationId,
      parsed.remoteToolName,
    );
    if (!tool) {
      throw new Error(
        `"${toolName}" does not exist on any of this organisation's connected MCP servers.`,
      );
    }
  }
}

export async function createAgent(organisationId: string, input: AgentInput) {
  const { toolNames, ...agentColumns } = input;
  await validateActionIntegration(organisationId, input.actionIntegrationId);
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
  await validateActionIntegration(organisationId, input.actionIntegrationId);
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
