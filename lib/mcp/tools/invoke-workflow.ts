import { z } from "zod";

import type { AIProvider } from "@/lib/ai/provider";
import { dispatchToWorkflowById } from "@/lib/routing/dispatch";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";
import type { ToolName } from "@/lib/mcp/tool-registry";
import * as runRepository from "@/lib/runs/run-repository";

const TOOL_NAME: ToolName = "invoke_workflow";

const MAX_INVOCATION_DEPTH = 3;

export interface InvokableWorkflowSummary {
  id: string;
  name: string;
  description: string;
}

const inputSchema = {
  workflowId: z
    .string()
    .min(1)
    .describe(
      "The id of the workflow to invoke — must be one listed as available in this tool's own description.",
    ),
  input: z
    .string()
    .min(1)
    .describe(
      "The text to send that workflow's classifier, as if it had arrived as a real inbound message.",
    ),
};

const outputSchema = {
  status: z.enum([
    "completed",
    "waiting_for_approval",
    "waiting_for_input",
    "failed",
    "no_match",
  ]),
  handledBy: z
    .string()
    .nullable()
    .describe("Which handler agent under the workflow actually took this."),
  response: z
    .string()
    .nullable()
    .describe("The handling agent's final or paused reply, if any."),
  runId: z.string().nullable(),
};

const STATUS_MAP: Record<string, z.infer<(typeof outputSchema)["status"]>> = {
  COMPLETED: "completed",
  WAITING_FOR_APPROVAL: "waiting_for_approval",
  WAITING_FOR_INPUT: "waiting_for_input",
  FAILED: "failed",
  CANCELLED: "failed",
};

function buildDescription(workflows: InvokableWorkflowSummary[]): string {
  const base =
    "Ask a workflow (a department: a classifier plus the specialist agents under it) to handle something, exactly as if it had arrived as a real inbound message — the workflow's own classifier decides which of its agents actually takes it, not you.";
  if (workflows.length === 0) {
    return `${base} No workflows are currently available to invoke — do not call this tool.`;
  }
  const list = workflows
    .map((w) => `- id: ${w.id} — ${w.name}: ${w.description}`)
    .join("\n");
  return `${base}\n\nWorkflows you may currently invoke:\n${list}`;
}

/**
 * The workflow-level counterpart to invoke_agent — the piece invoke_agent
 * itself flagged as "left for later" when it only supported agents.
 * Lets chat go *through* a department (its classifier picks the actual
 * handler) instead of only ever addressing one specific worker directly.
 * Both remain valid: invoke_agent for "I know exactly which agent should
 * do this," invoke_workflow for "let the department figure out who
 * should."
 *
 * Same shape as invoke_agent: the available-workflows list passed in by
 * the caller (lib/mcp/server.ts) does double duty as this tool's own
 * description and its enforcement set, so the two can't drift apart.
 */
export function createInvokeWorkflowTool(
  organisationId: string,
  invocationDepth = 0,
  // The AIProvider the calling run is already using — reused rather than
  // re-resolved, same reasoning as invoke_agent's own `provider` param.
  provider?: AIProvider,
  invokableWorkflows: InvokableWorkflowSummary[] = [],
) {
  return {
    name: TOOL_NAME,
    description: buildDescription(invokableWorkflows),
    inputSchema,
    outputSchema,
    handler: async ({
      workflowId,
      input,
    }: {
      workflowId: string;
      input: string;
    }) => {
      if (invocationDepth >= MAX_INVOCATION_DEPTH) {
        return toolError(
          `Reached the maximum agent-invocation depth (${MAX_INVOCATION_DEPTH}). This usually means an agent and a workflow (or two workflows) are set up to invoke each other.`,
        );
      }

      const isInvokable = invokableWorkflows.some((w) => w.id === workflowId);
      if (!isInvokable) {
        return toolError(
          `"${workflowId}" is not a workflow this orchestrator may currently invoke — it may not exist, or may not be active.`,
        );
      }

      const result = await dispatchToWorkflowById(
        organisationId,
        workflowId,
        input,
        invocationDepth,
        provider,
      );

      if (!result.matched) {
        if (result.reason === "not_found" || result.reason === "inactive") {
          return toolError(
            `Workflow "${workflowId}" is ${result.reason === "not_found" ? "not found" : "not active"}.`,
          );
        }
        // no_workflow (misconfigured — no classifier or no active handler)
        // and no_match (nothing under it clearly fit) are both legitimate
        // outcomes worth reasoning about, not tool-call failures.
        return toolSuccess({
          status: "no_match",
          handledBy: null,
          response: null,
          runId: null,
        });
      }

      const finishedRun = await runRepository.findRunById(
        organisationId,
        result.run.runId,
      );
      const response = finishedRun?.steps.at(-1)?.detail ?? null;

      return toolSuccess({
        status: STATUS_MAP[result.run.status] ?? "failed",
        handledBy: result.agentName,
        response,
        runId: result.run.runId,
      });
    },
  };
}
