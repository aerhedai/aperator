import { z } from "zod";

import type { AIProvider } from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import * as agentRepository from "@/lib/agents/agent-repository";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import type { ToolName } from "@/lib/mcp/tool-registry";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";
import * as runRepository from "@/lib/runs/run-repository";
import { runAgent } from "@/lib/runtime/agent-runtime";

const TOOL_NAME: ToolName = "invoke_agent";

// A cap on how many invoke_agent calls can chain in one request, not on how
// many tools a single agent may call (MAX_AGENT_STEPS already bounds that
// per run) — this bounds the depth of agent-invokes-agent, which two
// orchestrators granted to invoke each other could otherwise chain
// unboundedly deep, each hop spinning up a brand-new AgentRun. CLAUDE.md
// #10: "There must always be safeguards against infinite agent loops."
const MAX_INVOCATION_DEPTH = 3;

export interface InvokableAgentSummary {
  id: string;
  name: string;
  description: string;
}

const inputSchema = {
  agentId: z
    .string()
    .min(1)
    .describe(
      "The id of the agent to invoke — must be one listed as available in this tool's own description.",
    ),
  input: z
    .string()
    .min(1)
    .describe(
      "The text to send that agent, as if a user had typed it to it directly.",
    ),
};

const outputSchema = {
  status: z.enum([
    "completed",
    "waiting_for_approval",
    "waiting_for_input",
    "failed",
  ]),
  response: z
    .string()
    .nullable()
    .describe("The invoked agent's final or paused reply, if any."),
  runId: z.string(),
};

const STATUS_MAP: Record<string, z.infer<(typeof outputSchema)["status"]>> = {
  COMPLETED: "completed",
  WAITING_FOR_APPROVAL: "waiting_for_approval",
  WAITING_FOR_INPUT: "waiting_for_input",
  FAILED: "failed",
  CANCELLED: "failed",
};

function buildDescription(invokableAgents: InvokableAgentSummary[]): string {
  const base =
    "Delegate a task to another agent already active in this organisation. Pass its id and the input text it should receive.";
  if (invokableAgents.length === 0) {
    return `${base} No other agents are currently available to invoke — do not call this tool.`;
  }
  const list = invokableAgents
    .map((a) => `- id: ${a.id} — ${a.name}: ${a.description}`)
    .join("\n");
  return `${base}\n\nAgents you may currently invoke:\n${list}`;
}

/**
 * The one generic tool an orchestrator uses to delegate to another agent —
 * same "one tool, a parameter, not one tool per target" shape as
 * find_record's recordType (CLAUDE.md §4.5).
 *
 * Which agents are actually nameable is *not* a per-orchestrator grant any
 * more (see Agent.chatInvokable in schema.prisma) — it's "every active
 * agent in the organisation that hasn't been individually excluded,"
 * computed fresh by the caller (lib/mcp/server.ts) and passed in as
 * `invokableAgents`. That list does double duty: it's both what gets
 * embedded in this tool's description (so the model actually knows what
 * exists, rather than being told to guess an id) and the enforcement set
 * the handler checks against — the two can never drift apart because
 * they're the same array.
 *
 * Workflows are not invocable here (see the architecture plan): their
 * entry point is trigger-shaped inbound data, not a plain string, and
 * fabricating a synthetic trigger payload to force-fit them is a separate
 * problem left for later.
 */
export function createInvokeAgentTool(
  organisationId: string,
  callerAgentId?: string,
  invocationDepth = 0,
  // The AIProvider the calling run is already using — reused rather than
  // re-resolved so provider resolution stays "once, at a real request
  // boundary" (organisation-ai-provider.ts's own stated rule) even for a
  // delegated run. Falls back to resolving one only when a caller genuinely
  // has none in scope (there is no real call site that omits it today).
  provider?: AIProvider,
  invokableAgents: InvokableAgentSummary[] = [],
) {
  return {
    name: TOOL_NAME,
    description: buildDescription(invokableAgents),
    inputSchema,
    outputSchema,
    handler: async ({ agentId, input }: { agentId: string; input: string }) => {
      if (!callerAgentId) {
        return toolError(
          "invoke_agent has no caller identity in this context and cannot check invocation grants.",
        );
      }

      if (invocationDepth >= MAX_INVOCATION_DEPTH) {
        return toolError(
          `Reached the maximum agent-invocation depth (${MAX_INVOCATION_DEPTH}). This usually means two agents are set up to invoke each other — check their invocation grants.`,
        );
      }

      const isInvokable = invokableAgents.some((a) => a.id === agentId);
      if (!isInvokable) {
        return toolError(
          `"${agentId}" is not an agent this orchestrator may currently invoke — it may not exist, may not be active, or may have been individually excluded from invocation.`,
        );
      }

      const targetAgent = await agentRepository.findAgentById(
        organisationId,
        agentId,
      );
      if (!targetAgent) {
        return toolError(`No agent found with id "${agentId}".`);
      }

      const resolvedProvider =
        provider ?? (await getAIProvider(organisationId));

      const result =
        targetAgent.executionMode === "HARNESS"
          ? await runHarnessPipeline(targetAgent, input, resolvedProvider)
          : await runAgent(
              targetAgent,
              input,
              resolvedProvider,
              invocationDepth + 1,
            );

      const finishedRun = await runRepository.findRunById(
        organisationId,
        result.runId,
      );
      const response = finishedRun?.steps.at(-1)?.detail ?? null;

      return toolSuccess({
        status: STATUS_MAP[result.status] ?? "failed",
        response,
        runId: result.runId,
      });
    },
  };
}
