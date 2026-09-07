import { z } from "zod";

import type { AIProvider } from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import * as agentInvocationRepository from "@/lib/agents/agent-invocation-repository";
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

const inputSchema = {
  agentId: z
    .string()
    .min(1)
    .describe(
      "The id of the agent to invoke — must be one you were explicitly granted.",
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

/**
 * The one generic tool an orchestrator uses to delegate to another agent —
 * same "one tool, a parameter, not one tool per target" shape as
 * find_record's recordType (CLAUDE.md §4.5). Granting invoke_agent itself
 * only makes the *capability* available; which agents may actually be
 * named still requires an explicit AgentInvocationGrant row per pair — the
 * grant check below is what makes that real, not merely documented.
 *
 * Workflows are not invocable here (see the architecture plan): their entry
 * point is trigger-shaped inbound data, not a plain string, and fabricating
 * a synthetic trigger payload to force-fit them is a separate problem left
 * for later.
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
) {
  return {
    name: TOOL_NAME,
    description:
      "Delegate a task to another agent this orchestrator has been granted access to invoke. Pass its id and the input text it should receive.",
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

      const granted = await agentInvocationRepository.isAgentInvocationGranted(
        callerAgentId,
        agentId,
      );
      if (!granted) {
        return toolError(
          `This agent has not been granted permission to invoke agent "${agentId}".`,
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
