import type { AIProvider } from "@/lib/ai/provider";
import type { InvokeAgentOutcome } from "@/lib/agents/invoke-agent-directly";
import { dispatchToWorkflowById } from "@/lib/routing/dispatch";
import * as runRepository from "@/lib/runs/run-repository";

export type InvokeWorkflowOutcome = InvokeAgentOutcome | "no_match";

export interface InvokeWorkflowResult {
  status: InvokeWorkflowOutcome;
  handledBy: string | null;
  response: string | null;
  runId: string | null;
}

const STATUS_MAP: Record<string, InvokeAgentOutcome> = {
  COMPLETED: "completed",
  WAITING_FOR_APPROVAL: "waiting_for_approval",
  WAITING_FOR_INPUT: "waiting_for_input",
  FAILED: "failed",
  CANCELLED: "failed",
};

/**
 * Asks a workflow's classifier to pick a handler and runs it to completion
 * (or a pause state) — the shared logic behind both the invoke_workflow
 * tool (lib/mcp/tools/invoke-workflow.ts) and a Task/Routine plan step
 * (lib/tasks/run-task-plan.ts), same pairing as
 * lib/agents/invoke-agent-directly.ts is to invoke_agent.
 *
 * "no_match" (nothing under the workflow clearly fit) and "not_found" /
 * "inactive" (folded into "failed" here) are real, distinct outcomes at
 * the dispatch layer, but a task plan step only needs "did this produce a
 * usable response or not" — the tool keeps the richer detail for its own
 * error messages by checking dispatchToWorkflowById itself rather than
 * going through this wrapper.
 */
export async function invokeWorkflowDirectly(
  organisationId: string,
  workflowId: string,
  input: string,
  invocationDepth = 0,
  provider?: AIProvider,
): Promise<InvokeWorkflowResult> {
  const result = await dispatchToWorkflowById(
    organisationId,
    workflowId,
    input,
    invocationDepth,
    provider,
  );

  if (!result.matched) {
    if (result.reason === "no_match") {
      return {
        status: "no_match",
        handledBy: null,
        response: null,
        runId: null,
      };
    }
    return { status: "failed", handledBy: null, response: null, runId: null };
  }

  const finishedRun = await runRepository.findRunById(
    organisationId,
    result.run.runId,
  );
  const response = finishedRun?.steps.at(-1)?.detail ?? null;

  return {
    status: STATUS_MAP[result.run.status] ?? "failed",
    handledBy: result.agentName,
    response,
    runId: result.run.runId,
  };
}
