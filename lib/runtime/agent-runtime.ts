import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import type {
  AIMessage,
  AIProvider,
  AIToolCallRequest,
  AIToolDefinition,
} from "@/lib/ai/provider";
import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import * as approvalRepository from "@/lib/approvals/approval-repository";
import { prisma } from "@/lib/db/prisma";
import type { Agent, Prisma } from "@/lib/generated/prisma/client";
import { connectMcpClient } from "@/lib/mcp/client";
import {
  evaluatePolicy,
  requiresApprovalBeforeExecution,
} from "@/lib/policies/policy-engine";
import * as runRepository from "@/lib/runs/run-repository";
import {
  executeAndRecordTool,
  recordDisallowedTool,
} from "@/lib/runtime/tool-execution";

// Configurable safeguard against infinite agent loops (CLAUDE.md #10).
const MAX_AGENT_STEPS = 20;

export interface RunResult {
  runId: string;
  status:
    | "COMPLETED"
    | "FAILED"
    | "WAITING_FOR_APPROVAL"
    | "WAITING_FOR_INPUT"
    | "CANCELLED";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detects when the model wrote its intended tool call(s) as plain text
 * instead of using the provider's actual tool-calling mechanism — observed
 * live in three different shapes so far, in order discovered: (1) a single
 * clean JSON object, `{"name": "send_email", "arguments": {...}}`; (2) one
 * or more fragments wrapped in literal `<tool_call>...</tool_call>` tags
 * (Qwen's own chat-template token, leaked into `content` when Ollama's
 * parsing of it breaks down); (3) garbled/non-ASCII text, a stray comma,
 * *then* a clean JSON object — no tags, doesn't start with "{". All three
 * read as "no more action needed" via an empty `toolCalls` array, which
 * used to mark the run COMPLETED with nothing actually done.
 *
 * Shape (3) is why this doesn't require the *whole* content to be valid
 * JSON (an earlier version of this check did, and missed it) — instead it
 * searches for the tool-call shape anywhere in the text: an `"arguments"`
 * key together with a `"name"` key naming one of *this agent's own* real
 * tools. That pair is specific enough that an ordinary reply won't produce
 * it by accident, regardless of what garbage surrounds it.
 */
function looksLikeAbortedToolCall(
  content: string,
  tools: AIToolDefinition[],
): boolean {
  if (/<\/?tool_call>/i.test(content)) return true;
  if (!/"arguments"\s*:/i.test(content)) return false;

  return tools.some((tool) =>
    new RegExp(`"name"\\s*:\\s*"${escapeRegExp(tool.name)}"`, "i").test(
      content,
    ),
  );
}

export async function loadTools(
  mcpClient: Client,
  allowedTools: Set<string>,
): Promise<AIToolDefinition[]> {
  const { tools: mcpTools } = await mcpClient.listTools();
  return mcpTools
    .filter((tool) => allowedTools.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      parameters: (tool.inputSchema ?? {
        type: "object",
        properties: {},
      }) as Record<string, unknown>,
    }));
}

interface LoopContext {
  runId: string;
  organisationId: string;
  agentModel: string;
  messages: AIMessage[];
  tools: AIToolDefinition[];
  allowedTools: Set<string>;
  provider: AIProvider;
  mcpClient: Client;
  // CHAT-mode agents don't have a "finished" state reachable by a plain
  // text reply — a text-only response means "waiting for the human's next
  // message," not "done." Everything else about the loop (tool calls,
  // grants, policy checks) is identical either way.
  pauseOnTextResponse?: boolean;
}

/**
 * Executes one already-allowed, non-gated tool call within the loop and
 * appends its result to the conversation — the messages bookkeeping is
 * loop-specific (the harness doesn't maintain a chat history), so this
 * wraps the shared executeAndRecordTool rather than being shared itself.
 */
async function executeToolCall(
  runId: string,
  mcpClient: Client,
  call: AIToolCallRequest,
  messages: AIMessage[],
): Promise<{
  isError: boolean;
  structuredContent: Record<string, unknown> | undefined;
}> {
  const { isError, structuredContent } = await executeAndRecordTool(
    runId,
    mcpClient,
    call.name,
    call.arguments,
  );
  messages.push({
    role: "tool",
    content: JSON.stringify(structuredContent ?? {}),
    toolCallId: call.id,
  });
  return { isError, structuredContent };
}

/**
 * The core loop: input -> LLM -> tool call -> policy check -> result -> LLM
 * -> ... -> complete (CLAUDE.md #10). Shared by runAgent (fresh start) and
 * resumeRun (continuing from a persisted message snapshot after approval),
 * so pausing/resuming can't drift into two different implementations. This
 * is the "LOOP" execution mode — see lib/harness/ for "HARNESS", where tool
 * sequencing is deterministic code instead of a model decision each turn.
 */
async function runLoop(context: LoopContext): Promise<RunResult> {
  const {
    runId,
    organisationId,
    agentModel,
    messages,
    tools,
    allowedTools,
    provider,
    mcpClient,
    pauseOnTextResponse,
  } = context;

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const response = await provider.generateResponse({
      model: agentModel,
      messages,
      tools,
    });
    await runRepository.addRunStep(
      runId,
      "AGENT_DECISION",
      response.content || undefined,
      undefined,
      response.usage,
    );

    if (!response.toolCalls || response.toolCalls.length === 0) {
      if (looksLikeAbortedToolCall(response.content, tools)) {
        // Never claim success when the intended action never actually
        // ran — this is a visible failure a human can retry, not a
        // silent no-op dressed up as COMPLETED.
        await runRepository.markRunStatus(runId, "FAILED", {
          completedAt: new Date(),
        });
        await runRepository.addRunStep(
          runId,
          "RUN_FAILED",
          "The model wrote its intended tool call as plain text instead of a real tool call, so nothing was actually executed. Try running this input again.",
        );
        return { runId, status: "FAILED" };
      }

      if (pauseOnTextResponse) {
        messages.push({ role: "assistant", content: response.content });
        await runRepository.saveMessages(
          runId,
          messages as unknown as Prisma.InputJsonValue,
        );
        await runRepository.markRunStatus(runId, "WAITING_FOR_INPUT");
        await runRepository.addRunStep(
          runId,
          "AWAITING_INPUT",
          response.content,
        );
        return { runId, status: "WAITING_FOR_INPUT" };
      }

      await runRepository.markRunStatus(runId, "COMPLETED", {
        completedAt: new Date(),
      });
      await runRepository.addRunStep(runId, "RUN_COMPLETED", response.content);
      return { runId, status: "COMPLETED" };
    }

    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      if (!allowedTools.has(call.name)) {
        const { error } = await recordDisallowedTool(
          runId,
          call.name,
          call.arguments,
        );
        messages.push({
          role: "tool",
          content: JSON.stringify({ error }),
          toolCallId: call.id,
        });
        continue;
      }

      if (await requiresApprovalBeforeExecution(call.name, organisationId)) {
        // Gated *before* execution — this tool mutates external,
        // customer-visible state, and approving after the fact can't
        // un-send an email. The assistant message above already recorded
        // this call's proposed arguments in `messages`, so the resume path
        // has everything it needs to execute exactly this call once
        // approved (see resumeRun).
        await runRepository.saveMessages(
          runId,
          messages as unknown as Prisma.InputJsonValue,
        );
        await runRepository.markRunStatus(runId, "WAITING_FOR_APPROVAL");
        const reason = `${call.name} requires human approval before it runs.`;
        await runRepository.addRunStep(runId, "APPROVAL_REQUESTED", reason);
        await approvalRepository.createApproval(
          organisationId,
          runId,
          call.name,
          reason,
          call.arguments as Prisma.InputJsonValue,
          call.id,
        );
        return { runId, status: "WAITING_FOR_APPROVAL" };
      }

      const { isError, structuredContent } = await executeToolCall(
        runId,
        mcpClient,
        call,
        messages,
      );

      if (!isError) {
        const policy = evaluatePolicy({
          toolName: call.name,
          toolOutput: structuredContent ?? {},
        });

        if (policy.decision === "REQUIRE_APPROVAL") {
          await runRepository.saveMessages(
            runId,
            messages as unknown as Prisma.InputJsonValue,
          );
          await runRepository.markRunStatus(runId, "WAITING_FOR_APPROVAL");
          await runRepository.addRunStep(
            runId,
            "APPROVAL_REQUESTED",
            policy.reason,
          );
          await approvalRepository.createApproval(
            organisationId,
            runId,
            call.name,
            policy.reason,
          );
          return { runId, status: "WAITING_FOR_APPROVAL" };
        }

        if (policy.decision === "DENY") {
          await runRepository.markRunStatus(runId, "FAILED", {
            completedAt: new Date(),
          });
          await runRepository.addRunStep(
            runId,
            "RUN_FAILED",
            `Denied by policy: ${policy.reason}`,
          );
          return { runId, status: "FAILED" };
        }
      }
    }
  }

  await runRepository.markRunStatus(runId, "FAILED", {
    completedAt: new Date(),
  });
  await runRepository.addRunStep(
    runId,
    "RUN_FAILED",
    `Exceeded the maximum of ${MAX_AGENT_STEPS} steps without completing.`,
  );
  return { runId, status: "FAILED" };
}

export async function runAgent(
  agent: Agent,
  input: string,
  provider: AIProvider,
  // How many invoke_agent hops deep this run is — 0 for a normal top-level
  // run, incremented by the invoke_agent tool itself for a delegated one.
  // See lib/mcp/tools/invoke-agent.ts's MAX_INVOCATION_DEPTH.
  invocationDepth = 0,
): Promise<RunResult> {
  const run = await runRepository.createRun(
    agent.organisationId,
    agent.id,
    input,
  );
  await runRepository.markRunStatus(run.id, "RUNNING", {
    startedAt: new Date(),
  });
  await runRepository.addRunStep(run.id, "INPUT_RECEIVED", input);

  const mcpClient = await connectMcpClient(
    agent.organisationId,
    agent.actionIntegrationId,
    agent.id,
    invocationDepth,
    provider,
  );

  try {
    const allowedTools = new Set(
      await agentToolRepository.findToolNamesForAgent(agent.id),
    );
    const tools = await loadTools(mcpClient, allowedTools);
    const messages: AIMessage[] = [
      { role: "system", content: agent.instructions },
      { role: "user", content: input },
    ];

    return await runLoop({
      runId: run.id,
      organisationId: agent.organisationId,
      agentModel: agent.model,
      messages,
      tools,
      allowedTools,
      provider,
      mcpClient,
      pauseOnTextResponse: agent.executionMode === "CHAT",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await runRepository.markRunStatus(run.id, "FAILED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(run.id, "RUN_FAILED", message);
    return { runId: run.id, status: "FAILED" };
  } finally {
    await mcpClient.close();
  }
}

export async function loadSnapshotMessages(
  runId: string,
): Promise<AIMessage[]> {
  return ((await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } }))
    .messages ?? []) as unknown as AIMessage[];
}

/**
 * Resumes a run that's WAITING_FOR_APPROVAL after a human decision.
 * Rejecting cancels the run outright; approving continues from wherever the
 * run paused. LOOP-mode runs continue the conversation from the exact
 * snapshot saved when they paused; HARNESS-mode runs have nothing further
 * to decide once the approved call executes (the pipeline had already
 * finished its own work before proposing it) — see lib/harness/. The step
 * counter resets on resume for LOOP mode — a resumed run gets its own
 * fresh MAX_AGENT_STEPS budget, a deliberate V1 simplification.
 */
export async function resumeRun(
  runId: string,
  organisationId: string,
  decision: "APPROVED" | "REJECTED",
  approverId: string,
  // Optional, unlike runAgent's — REJECTED and a HARNESS-mode APPROVED
  // both return before ever needing one (see the LOOP-continuation branch
  // below, the only place it's actually used). Requiring it unconditionally
  // would force every reject click to have an AI provider configured for
  // no reason. Resolved lazily, only if execution actually reaches that
  // branch and the caller didn't already supply one (tests inject a
  // scripted provider directly; real callers rely on this fallback).
  provider?: AIProvider,
): Promise<RunResult> {
  const run = await runRepository.findRunById(organisationId, runId);
  if (!run || run.status !== "WAITING_FOR_APPROVAL") {
    throw new Error("This run is not waiting for approval.");
  }

  const approval = await approvalRepository.findPendingApprovalForRun(runId);

  if (decision === "REJECTED") {
    if (approval) {
      await approvalRepository.decideApproval(
        approval.id,
        "REJECTED",
        approverId,
      );
    }
    await runRepository.markRunStatus(runId, "CANCELLED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(
      runId,
      "RUN_CANCELLED",
      "Rejected by approver.",
    );
    return { runId, status: "CANCELLED" };
  }

  if (approval) {
    await approvalRepository.decideApproval(
      approval.id,
      "APPROVED",
      approverId,
    );
  }
  await runRepository.addRunStep(
    runId,
    "APPROVAL_GRANTED",
    "Approved — resuming.",
  );
  await runRepository.markRunStatus(runId, "RUNNING");

  const mcpClient = await connectMcpClient(
    organisationId,
    run.agent.actionIntegrationId,
    run.agent.id,
    0,
    provider,
  );

  try {
    // Now that a human has approved it, actually run the call that was
    // held back before it could execute (see requiresApprovalBeforeExecution
    // above). A tool-level failure here is handled the same way as any
    // other tool error — recorded, not fatal — so a LOOP agent's next turn
    // can react to it; only an explicit DENY stops the run outright.
    let heldBackFailed = false;
    if (approval?.proposedInput && approval.proposedToolCallId) {
      const { isError, structuredContent } = await executeAndRecordTool(
        runId,
        mcpClient,
        approval.requestedAction,
        approval.proposedInput as Record<string, unknown>,
      );
      heldBackFailed = isError;

      if (!isError) {
        const policy = evaluatePolicy({
          toolName: approval.requestedAction,
          toolOutput: structuredContent ?? {},
        });
        if (policy.decision === "DENY") {
          await runRepository.markRunStatus(runId, "FAILED", {
            completedAt: new Date(),
          });
          await runRepository.addRunStep(
            runId,
            "RUN_FAILED",
            `Denied by policy: ${policy.reason}`,
          );
          return { runId, status: "FAILED" };
        }
      }
    }

    if (run.agent.executionMode === "HARNESS") {
      // The pipeline already did all its work before proposing this call
      // (see lib/harness/) — there's no further LLM turn to take, the
      // held-back call executing (or not) is the last step.
      const status = heldBackFailed ? "FAILED" : "COMPLETED";
      await runRepository.markRunStatus(runId, status, {
        completedAt: new Date(),
      });
      await runRepository.addRunStep(
        runId,
        heldBackFailed ? "RUN_FAILED" : "RUN_COMPLETED",
        heldBackFailed
          ? "The approved action failed to execute."
          : "Approved action sent.",
      );
      return { runId, status };
    }

    const allowedTools = new Set(
      await agentToolRepository.findToolNamesForAgent(run.agent.id),
    );
    const tools = await loadTools(mcpClient, allowedTools);
    const messages = await loadSnapshotMessages(runId);

    return await runLoop({
      runId,
      organisationId,
      agentModel: run.agent.model,
      messages,
      tools,
      allowedTools,
      provider: provider ?? (await getAIProvider(organisationId)),
      mcpClient,
      pauseOnTextResponse: run.agent.executionMode === "CHAT",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await runRepository.markRunStatus(runId, "FAILED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(runId, "RUN_FAILED", message);
    return { runId, status: "FAILED" };
  } finally {
    await mcpClient.close();
  }
}

/**
 * The synchronous half of resuming a WAITING_FOR_INPUT run: validates,
 * echoes the human's message into the audit trail, and marks the run
 * RUNNING — split out from continueChatRun so a caller that wants to defer
 * the actual model turn (see runChatTurn) can still make the human's own
 * message and the RUNNING status visible to a client immediately, before
 * the slower part even starts.
 */
export async function recordChatTurnStart(
  organisationId: string,
  runId: string,
  humanMessage: string,
): Promise<Agent> {
  const run = await runRepository.findRunById(organisationId, runId);
  if (!run || run.status !== "WAITING_FOR_INPUT") {
    throw new Error("This chat is not waiting for a message.");
  }
  if (run.agent.executionMode !== "CHAT") {
    throw new Error("This agent is not a chat agent.");
  }

  await runRepository.addRunStep(runId, "INPUT_RECEIVED", humanMessage);
  await runRepository.markRunStatus(runId, "RUNNING");
  return run.agent;
}

/**
 * Runs a CHAT-mode agent's turn against an already-RUNNING run and an
 * explicit message array — the one piece shared by starting a brand new
 * chat (messages = [system, user]) and continuing a paused one (messages =
 * the reloaded snapshot with the new human turn appended, see
 * continueChatRun). Always pauses on a text-only reply rather than
 * completing (pauseOnTextResponse: true) — a CHAT-mode run's only other
 * exits are FAILED/CANCELLED, never COMPLETED.
 */
export async function runChatTurn(
  organisationId: string,
  runId: string,
  agent: Agent,
  messages: AIMessage[],
  provider?: AIProvider,
): Promise<RunResult> {
  const mcpClient = await connectMcpClient(
    organisationId,
    agent.actionIntegrationId,
    agent.id,
    0,
    provider,
  );

  try {
    const allowedTools = new Set(
      await agentToolRepository.findToolNamesForAgent(agent.id),
    );
    const tools = await loadTools(mcpClient, allowedTools);

    return await runLoop({
      runId,
      organisationId,
      agentModel: agent.model,
      messages,
      tools,
      allowedTools,
      provider: provider ?? (await getAIProvider(organisationId)),
      mcpClient,
      pauseOnTextResponse: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    await runRepository.markRunStatus(runId, "FAILED", {
      completedAt: new Date(),
    });
    await runRepository.addRunStep(runId, "RUN_FAILED", message);
    return { runId, status: "FAILED" };
  } finally {
    await mcpClient.close();
  }
}

/**
 * Creates a brand new CHAT-mode run and records its first human message —
 * the "starting a chat" analogue of recordChatTurnStart, used the same way:
 * a caller that wants to defer the model turn (see runChatTurn) can make
 * the new run visible to a client immediately, before the slower part
 * starts.
 */
export async function beginNewChatRun(
  agent: Agent,
  input: string,
): Promise<string> {
  const run = await runRepository.createRun(
    agent.organisationId,
    agent.id,
    input,
  );
  await runRepository.markRunStatus(run.id, "RUNNING", {
    startedAt: new Date(),
  });
  await runRepository.addRunStep(run.id, "INPUT_RECEIVED", input);
  return run.id;
}

/**
 * Resumes a CHAT-mode run that's WAITING_FOR_INPUT after the human sends
 * their next message — the chat analogue of resumeRun's approval-decision
 * path, but there's no approval to decide and no held-back tool call to
 * execute first: the snapshot is reloaded, the new message appended, and
 * the loop re-entered directly with a fresh step budget (same "resumed runs
 * get their own MAX_AGENT_STEPS" simplification as resumeRun). Composes
 * recordChatTurnStart + runChatTurn — callers that need the two halves on
 * different sides of a response boundary (see app/(shell)/chat/actions.ts)
 * call those directly instead.
 */
export async function continueChatRun(
  organisationId: string,
  runId: string,
  humanMessage: string,
  provider?: AIProvider,
): Promise<RunResult> {
  const agent = await recordChatTurnStart(organisationId, runId, humanMessage);
  const messages = await loadSnapshotMessages(runId);
  messages.push({ role: "user", content: humanMessage });
  return runChatTurn(organisationId, runId, agent, messages, provider);
}
