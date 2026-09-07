import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import * as approvalRepository from "@/lib/approvals/approval-repository";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requiresApprovalBeforeExecution } from "@/lib/policies/policy-engine";
import * as runRepository from "@/lib/runs/run-repository";

export interface ToolExecutionResult {
  isError: boolean;
  structuredContent: Record<string, unknown> | undefined;
  toolCallId: string;
}

function firstErrorText(content: unknown): string {
  if (!Array.isArray(content)) return "Tool call failed.";
  const textBlock = content.find(
    (block): block is { type: "text"; text: string } =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text",
  );
  return textBlock?.text ?? "Tool call failed.";
}

/**
 * Executes one tool call and records it (ToolCall + TOOL_CALL step). This
 * is the one place a real MCP tool call happens — shared by the free-form
 * loop (lib/runtime/agent-runtime.ts) and every harness pipeline (lib/
 * harness/) so recording/error-handling can't drift between the two
 * execution modes.
 */
export async function executeAndRecordTool(
  runId: string,
  mcpClient: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const result = await mcpClient.callTool({ name, arguments: args });
  const isError = result.isError === true;
  const structuredContent = result.structuredContent as
    Record<string, unknown> | undefined;

  const toolCall = await runRepository.createToolCall(
    runId,
    name,
    args,
    structuredContent,
    isError ? "FAILED" : "SUCCESS",
    isError ? firstErrorText(result.content) : undefined,
  );
  await runRepository.addRunStep(runId, "TOOL_CALL", name, toolCall.id);

  return { isError, structuredContent, toolCallId: toolCall.id };
}

/**
 * Records a tool call the agent isn't permitted to use as a failed call —
 * without ever reaching the MCP server (CLAUDE.md #9 step 3: "check the
 * agent has access to the tool"). Both execution modes must check this
 * before executeAndRecordTool, never bypass it.
 */
export async function recordDisallowedTool(
  runId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ error: string }> {
  const error = `This agent does not have access to the "${name}" tool.`;
  const toolCall = await runRepository.createToolCall(
    runId,
    name,
    args,
    undefined,
    "FAILED",
    error,
  );
  await runRepository.addRunStep(runId, "TOOL_CALL", name, toolCall.id);
  return { error };
}

export type GatedToolResult =
  | {
      status: "executed";
      isError: boolean;
      structuredContent: Record<string, unknown> | undefined;
    }
  | { status: "paused" }
  | { status: "disallowed"; error: string };

/**
 * The single deterministic gate every tool call passes through, in either
 * execution mode: is the agent allowed to use this tool at all, and if so,
 * does it require human approval before it runs (CLAUDE.md #14 — the LLM
 * recommends, this decides). Approval-gated calls are held back entirely,
 * not executed-then-checked — approving after the fact can't un-send an
 * email.
 */
export async function gateAndExecuteTool(params: {
  runId: string;
  organisationId: string;
  mcpClient: Client;
  allowedTools: Set<string>;
  callId: string;
  name: string;
  args: Record<string, unknown>;
}): Promise<GatedToolResult> {
  const { runId, organisationId, mcpClient, allowedTools, callId, name, args } =
    params;

  if (!allowedTools.has(name)) {
    const { error } = await recordDisallowedTool(runId, name, args);
    return { status: "disallowed", error };
  }

  if (await requiresApprovalBeforeExecution(name, organisationId)) {
    const reason = `${name} requires human approval before it runs.`;
    await runRepository.markRunStatus(runId, "WAITING_FOR_APPROVAL");
    await runRepository.addRunStep(runId, "APPROVAL_REQUESTED", reason);
    await approvalRepository.createApproval(
      organisationId,
      runId,
      name,
      reason,
      args as Prisma.InputJsonValue,
      callId,
    );
    return { status: "paused" };
  }

  const { isError, structuredContent } = await executeAndRecordTool(
    runId,
    mcpClient,
    name,
    args,
  );
  return { status: "executed", isError, structuredContent };
}
