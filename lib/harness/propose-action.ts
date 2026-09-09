import type { PipelineContext } from "@/lib/harness/types";
import { resolveEmailProvider } from "@/lib/integrations/integration-service";
import type { RunResult } from "@/lib/runtime/agent-runtime";
import { gateAndExecuteTool } from "@/lib/runtime/tool-execution";
import * as runRepository from "@/lib/runs/run-repository";

/**
 * "send_email" is the legacy sentinel stored in both Agent.actionTool
 * (every existing HARNESS-pipeline agent — no UI to change it yet, see its
 * schema.prisma comment) and in built-in step-programme templates' `act`
 * steps, from before GMAIL_SEND_EMAIL/OUTLOOK_SEND_EMAIL existed as
 * separate tools. Resolving it here, at the one place both the three
 * pipelines and the step engine's `act` step read a tool name, means
 * neither needed a data migration: "send_email" keeps meaning exactly what
 * it always meant ("send an email via this agent's bound-or-default
 * account"), just translated to whichever concrete tool that account's
 * provider actually needs. Any other tool name is returned as-is —
 * forward-compatible with a real second action-tool kind once one exists
 * (e.g. create_invoice).
 */
export async function resolveActionTool(
  toolName: string,
  organisationId: string,
  actionIntegrationId: string | null | undefined,
): Promise<string> {
  if (toolName !== "send_email") {
    return toolName;
  }
  try {
    const provider = await resolveEmailProvider(
      organisationId,
      actionIntegrationId,
    );
    return provider === "gmail" ? "GMAIL_SEND_EMAIL" : "OUTLOOK_SEND_EMAIL";
  } catch {
    // No email account resolvable yet (none connected at all, or the bound
    // one was since disconnected) — default to Gmail rather than failing
    // the whole run before ever reaching the approval step. This matches
    // the pre-existing timing every other tool already has: the run always
    // reaches WAITING_FOR_APPROVAL first, and a real "not connected" error
    // surfaces only when the approved call actually executes, not before.
    return "GMAIL_SEND_EMAIL";
  }
}

/**
 * The final step of every current pipeline: propose a terminal action
 * through the exact same deterministic gate the LOOP uses
 * (lib/runtime/tool-execution.ts) — approval-gated tools (currently
 * GMAIL_SEND_EMAIL/OUTLOOK_SEND_EMAIL, see policy-engine.ts's
 * REQUIRES_APPROVAL_BEFORE_EXECUTION) are always held for human approval,
 * no exceptions, same as LOOP mode. This is the only place a pipeline
 * finishes, whether that's "paused for approval," "done," or "failed"
 * (disallowed tool, or the call itself errored).
 *
 * Which tool gets called here is resolveActionTool's result, not a
 * hardcoded literal — every pipeline today still only ever builds
 * {to, subject, body}-shaped args (there's no second action-tool shape to
 * generalize against yet), but the gate/status logic itself doesn't assume
 * any specific tool name.
 */
export async function proposeAction(
  context: PipelineContext,
  action: { toolName: string; args: Record<string, unknown> },
): Promise<RunResult> {
  const result = await gateAndExecuteTool({
    runId: context.runId,
    organisationId: context.organisationId,
    mcpClient: context.mcpClient,
    allowedTools: context.allowedTools,
    callId: `harness_${context.runId}_${action.toolName}`,
    name: action.toolName,
    args: action.args,
  });

  if (result.status === "paused") {
    return { runId: context.runId, status: "WAITING_FOR_APPROVAL" };
  }

  if (result.status === "disallowed") {
    await runRepository.markRunStatus(context.runId, "FAILED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(context.runId, "RUN_FAILED", result.error);
    return { runId: context.runId, status: "FAILED" };
  }

  if (result.isError) {
    await runRepository.markRunStatus(context.runId, "FAILED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(
      context.runId,
      "RUN_FAILED",
      `Failed to complete the "${action.toolName}" action.`,
    );
    return { runId: context.runId, status: "FAILED" };
  }

  await runRepository.markRunStatus(context.runId, "COMPLETED", {
    completedAt: new Date(),
  });
  await runRepository.addRunStep(
    context.runId,
    "RUN_COMPLETED",
    `Action "${action.toolName}" completed.`,
  );
  return { runId: context.runId, status: "COMPLETED" };
}
