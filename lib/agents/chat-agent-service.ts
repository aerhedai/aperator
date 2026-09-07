import * as agentInvocationRepository from "@/lib/agents/agent-invocation-repository";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import { DEFAULT_AGENT_MODEL } from "@/lib/agents/default-agent-config";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";

const DEFAULT_NAME = "Assistant";
const DEFAULT_DESCRIPTION =
  "Chats with your team and delegates to your agents and tools when useful.";
const DEFAULT_INSTRUCTIONS =
  "You are this business's assistant. Answer directly when you can. When a task needs one of your granted agents, use invoke_agent rather than guessing at the answer yourself. Be concise, and say plainly when you can't do something.";

export function findChatAgent(organisationId: string): Promise<Agent | null> {
  return prisma.agent.findFirst({
    where: { organisationId, executionMode: "CHAT" },
  });
}

export const listInvokableAgentIds =
  agentInvocationRepository.findInvokableAgentIdsFor;

export const listChatAgentToolNames = agentToolRepository.findToolNamesForAgent;

/**
 * Every organisation gets at most one CHAT-mode agent — a product
 * decision, not a schema constraint, enforced here the same way Workflow's
 * one-ACTIVE-per-trigger rule is enforced in workflow-service.ts rather
 * than the database. Auto-provisioned with editable defaults and an empty
 * invocation grant list on first visit to /chat, rather than requiring a
 * setup step before a business can even try it — everything it creates
 * stays editable afterwards, same as installing a template. invoke_agent
 * itself is granted by default so delegation works the moment an
 * invocation grant is added; it still can't invoke anything until one is
 * (CLAUDE.md §4.6 — explicit grants, not implied by the tool alone).
 */
export async function getOrCreateChatAgent(
  organisationId: string,
): Promise<Agent> {
  const existing = await findChatAgent(organisationId);
  if (existing) return existing;

  const agent = await prisma.agent.create({
    data: {
      organisationId,
      name: DEFAULT_NAME,
      description: DEFAULT_DESCRIPTION,
      instructions: DEFAULT_INSTRUCTIONS,
      model: DEFAULT_AGENT_MODEL,
      status: "ACTIVE",
      executionMode: "CHAT",
    },
  });
  await agentToolRepository.setToolsForAgent(agent.id, ["invoke_agent"]);
  return agent;
}

export interface ChatAgentSettingsInput {
  name: string;
  description: string;
  instructions: string;
  model: string;
  toolNames: string[];
  invokableAgentIds: string[];
}

export async function updateChatAgentSettings(
  organisationId: string,
  agentId: string,
  input: ChatAgentSettingsInput,
): Promise<void> {
  const { count } = await prisma.agent.updateMany({
    where: { id: agentId, organisationId, executionMode: "CHAT" },
    data: {
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      model: input.model,
    },
  });
  if (count === 0) {
    throw new Error("Chat agent not found");
  }
  await agentToolRepository.setToolsForAgent(agentId, input.toolNames);
  await agentInvocationRepository.setInvokableAgentsFor(
    agentId,
    input.invokableAgentIds,
  );
}
