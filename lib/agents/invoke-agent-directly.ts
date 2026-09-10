import type { AIProvider } from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import * as agentRepository from "@/lib/agents/agent-repository";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import * as runRepository from "@/lib/runs/run-repository";
import { runAgent } from "@/lib/runtime/agent-runtime";

export type InvokeAgentOutcome =
  "completed" | "waiting_for_approval" | "waiting_for_input" | "failed";

export interface InvokeAgentResult {
  status: InvokeAgentOutcome;
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
 * Runs one existing agent to completion (or to a pause state) and returns
 * its final text response — the shared "resolve agent, pick harness vs.
 * loop, run it, extract the reply" logic behind both the invoke_agent tool
 * (lib/mcp/tools/invoke-agent.ts) and a Task/Routine plan step
 * (lib/tasks/run-task-plan.ts). Extracted so those two callers can't drift:
 * before this existed, invoke-agent.ts had this inline and the task-plan
 * executor would otherwise have needed its own copy.
 *
 * Deliberately does not check chatInvokable or any invocation-grant list —
 * that enforcement stays with each caller, since what counts as "allowed to
 * invoke this" differs (invoke_agent's tool-call grant list vs. a task
 * plan's targetId already having been validated against list_invokable's
 * output when the plan was created).
 */
export async function invokeAgentDirectly(
  organisationId: string,
  agentId: string,
  input: string,
  invocationDepth = 0,
  provider?: AIProvider,
): Promise<InvokeAgentResult> {
  const targetAgent = await agentRepository.findAgentById(
    organisationId,
    agentId,
  );
  if (!targetAgent) {
    return { status: "failed", response: null, runId: null };
  }

  const resolvedProvider = provider ?? (await getAIProvider(organisationId));

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

  return {
    status: STATUS_MAP[result.status] ?? "failed",
    response,
    runId: result.runId,
  };
}
