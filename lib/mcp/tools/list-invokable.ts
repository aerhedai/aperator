import { z } from "zod";

import * as agentRepository from "@/lib/agents/agent-repository";
import { toolSuccess } from "@/lib/mcp/tool-result";
import type { ToolName } from "@/lib/mcp/tool-registry";
import * as workflowService from "@/lib/workflows/workflow-service";

const TOOL_NAME: ToolName = "list_invokable";

const inputSchema = {};

const outputSchema = {
  agents: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string() }),
  ),
  workflows: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string() }),
  ),
};

/**
 * Read-only, live discovery for "what can I currently delegate to" —
 * invoke_agent and invoke_workflow both embed the same lists in their own
 * *description* text, but a description string is fixed the moment the
 * tool is registered at the start of a turn (lib/runtime/agent-runtime.ts's
 * loadTools) and never re-evaluated again for the rest of that turn. A
 * handler function, by contrast, runs fresh every time it's called — so
 * unlike reading the two invoke tools' descriptions (which can go stale
 * the instant something is installed mid-turn, or simply be misremembered
 * from earlier in a long conversation), calling this tool always reflects
 * exactly what's invokable right now, including something installed one
 * step earlier in the very same turn.
 *
 * Mirrors invoke_agent's and invoke_workflow's own enforcement filters
 * exactly (lib/mcp/server.ts) — this must never claim something is
 * invokable that either of those tools would actually refuse, or vice
 * versa.
 */
export function createListInvokableTool(
  organisationId: string,
  callerAgentId?: string,
) {
  return {
    name: TOOL_NAME,
    description:
      "See exactly which agents and workflows (departments) this organisation currently has active and invokable, right now — call this instead of relying on what you said earlier in the conversation or on install_template/install_workflow_template's own past results, since something else may have changed what's available since then.",
    inputSchema,
    outputSchema,
    handler: async () => {
      const agents = callerAgentId
        ? (await agentRepository.findAgentsByOrganisation(organisationId))
            .filter(
              (a) =>
                a.id !== callerAgentId &&
                a.status === "ACTIVE" &&
                a.executionMode !== "CHAT" &&
                a.chatInvokable,
            )
            .map((a) => ({
              id: a.id,
              name: a.name,
              description: a.description,
            }))
        : [];

      const workflows = (await workflowService.listWorkflows(organisationId))
        .filter((w) => w.status === "ACTIVE")
        .map((w) => ({ id: w.id, name: w.name, description: w.description }));

      return toolSuccess({ agents, workflows });
    },
  };
}
