import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import { DEFAULT_AGENT_MODEL } from "@/lib/agents/default-agent-config";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";

const DEFAULT_NAME = "Assistant";
const DEFAULT_DESCRIPTION =
  "Chats with your team and delegates to your workers and tools when useful.";
// Talks about "workers" and "departments" throughout — the business-facing
// names for Agent and Workflow (see the product-wide renaming this text
// is part of) — even though the tools it actually calls keep their
// internal identifiers (invoke_agent, invoke_workflow, ...) unchanged.
// The model only ever needs the exact tool name to call it; nothing about
// how it talks to a human needs to match that name.
const DEFAULT_INSTRUCTIONS =
  "You are this business's assistant. Answer directly when you can. When something needs to actually happen — a real, trackable piece of work, whether it's one step or several workers/departments in sequence with data passed between them — use create_task, not a bare invoke_agent/invoke_workflow call: it gives the business owner a visible record of what was asked and what happened. Use invoke_agent/invoke_workflow directly only for something so minor it doesn't deserve its own task record — invoke_agent asks a specific worker directly, invoke_workflow hands it to a department's own manager to route internally. If they want something repeated on a schedule instead of done once, use create_routine instead of create_task — pick the closest schedulePreset to what they asked for, and say plainly which one you picked. A routine's plan is decided once, when it's created — it won't notice new workers added later on its own, so if asked to update one, create a fresh routine rather than expecting it to adapt by itself. If nothing you have can do what's being asked, check list_templates before saying so — it lists both single workers and whole departments; install_template brings on a new worker on the spot, install_workflow_template stands up a whole working department (immediately usable) on the spot. If asked what workers or departments you currently have, always call list_invokable rather than answering from what you said earlier in this conversation — something may have been installed or changed since then. Be concise, say plainly when you can't do something, and say plainly when you've just installed something new.";

// Granted to every chat agent from the moment it's created — this is
// what makes "the business can always ask for more, any time" (not just
// at some separate setup step) actually true: chat can see what's
// available (list_invokable/list_templates) and act on it (install_template /
// install_workflow_template) in the same conversation, not just delegate
// to what already exists.
const DEFAULT_TOOL_NAMES = [
  "list_invokable",
  "invoke_agent",
  "invoke_workflow",
  "list_templates",
  "install_template",
  "install_workflow_template",
  "create_task",
  "create_routine",
];

export function findChatAgent(organisationId: string): Promise<Agent | null> {
  return prisma.agent.findFirst({
    where: { organisationId, executionMode: "CHAT" },
  });
}

export const listChatAgentToolNames = agentToolRepository.findToolNamesForAgent;

/**
 * Every organisation gets at most one CHAT-mode agent — a product
 * decision, not a schema constraint, enforced here the same way Workflow's
 * one-ACTIVE-per-trigger rule is enforced in workflow-service.ts rather
 * than the database. Auto-provisioned with editable defaults on first
 * visit to /chat, rather than requiring a setup step before a business can
 * even try it — everything it creates stays editable afterwards, same as
 * installing a template. invoke_agent itself is granted by default, and
 * every other active agent in the organisation is invokable by default too
 * (Agent.chatInvokable) — delegation works the moment a second agent
 * exists, with no separate grant step required.
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
  await agentToolRepository.setToolsForAgent(agent.id, DEFAULT_TOOL_NAMES);
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

/**
 * invokableAgentIds here is "the full set of the organisation's non-chat
 * agents that should currently be chatInvokable: true" (a checkbox list
 * defaulting to all-checked, see chat-settings-form.tsx) — not a delta.
 * Every other candidate agent in the org is explicitly set to false, so
 * unchecking one really excludes it rather than just failing to include
 * it.
 */
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

  const candidates = await prisma.agent.findMany({
    where: { organisationId, executionMode: { not: "CHAT" } },
    select: { id: true },
  });
  const checked = new Set(input.invokableAgentIds);
  const checkedIds = candidates
    .map((a) => a.id)
    .filter((id) => checked.has(id));
  const uncheckedIds = candidates
    .map((a) => a.id)
    .filter((id) => !checked.has(id));

  await prisma.$transaction([
    prisma.agent.updateMany({
      where: { id: { in: checkedIds } },
      data: { chatInvokable: true },
    }),
    prisma.agent.updateMany({
      where: { id: { in: uncheckedIds } },
      data: { chatInvokable: false },
    }),
  ]);
}
