import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import type { AIProvider } from "@/lib/ai/provider";
import type { WorkflowTriggerType } from "@/lib/generated/prisma/client";
import type { ResolvedAttachment } from "@/lib/harness/types";
import { runHarnessPipeline } from "@/lib/harness/run-harness-pipeline";
import { classifyIntent } from "@/lib/routing/classify-intent";
import { deterministicClassify } from "@/lib/routing/deterministic-classify";
import type { RunResult } from "@/lib/runtime/agent-runtime";
import { runAgent } from "@/lib/runtime/agent-runtime";
import { runAgentByExecutionMode } from "@/lib/runtime/run-agent-by-mode";
import * as workflowService from "@/lib/workflows/workflow-service";

export type DispatchResult =
  | { matched: true; agentId: string; agentName: string; run: RunResult }
  | { matched: false; reason: "no_workflow" | "no_match" };

// The narrower of the two shapes findActiveWorkflowForDispatch and
// getWorkflow actually return (the latter's `agent` also carries
// tools/_count) — a structural type rather than either query's exact
// inferred type, so both call sites below can hand their own richer
// result to the same classification logic with no casting.
type DispatchableWorkflow = NonNullable<
  Awaited<ReturnType<typeof workflowService.findActiveWorkflowForDispatch>>
>;

type HandlerSelection =
  | {
      ok: true;
      handlerAgent: DispatchableWorkflow["members"][number]["agent"];
      resolvedProvider: AIProvider;
    }
  | { ok: false; reason: "no_workflow" | "no_match" };

/**
 * The part of dispatch that's genuinely shared between "a real inbound
 * trigger fired" (dispatchInboundMessage) and "chat asked this workflow
 * directly" (dispatchToWorkflowById): which handler, if any, a workflow's
 * classifier would pick for this input. Deliberately stops short of
 * running anything — the two callers run their chosen handler through
 * different execution paths (see their own doc comments for why), so
 * unifying that part too would either regress the trigger-driven path's
 * depth semantics or silently skip them for the chat-driven one.
 */
async function selectHandler(
  workflow: DispatchableWorkflow,
  input: string,
  provider?: AIProvider,
): Promise<HandlerSelection> {
  const classifierMember = workflow.members.find(
    (m) => m.role === "CLASSIFIER",
  );
  const handlerMembers = workflow.members.filter(
    (m) => m.role === "HANDLER" && m.agent.status === "ACTIVE",
  );
  if (!classifierMember || handlerMembers.length === 0) {
    return { ok: false, reason: "no_workflow" };
  }

  const resolvedProvider =
    provider ?? (await getAIProvider(workflow.organisationId));

  const matchedAgentId =
    (handlerMembers.length === 1
      ? (handlerMembers[0]?.agent.id ?? null)
      : null) ??
    deterministicClassify(
      input,
      handlerMembers.map((m) => ({
        id: m.agent.id,
        keywords: m.agent.keywords,
      })),
    ) ??
    (await classifyIntent(
      {
        model: classifierMember.agent.model,
        instructions: classifierMember.agent.instructions,
      },
      input,
      handlerMembers.map((m) => ({
        id: m.agent.id,
        name: m.agent.name,
        description: m.agent.description,
      })),
      resolvedProvider,
    ));

  if (!matchedAgentId) {
    return { ok: false, reason: "no_match" };
  }

  const handler = handlerMembers.find((m) => m.agent.id === matchedAgentId);
  if (!handler) {
    return { ok: false, reason: "no_match" };
  }

  return { ok: true, handlerAgent: handler.agent, resolvedProvider };
}

/**
 * Runs a Workflow's classifier against an inbound message and, if it picks
 * a handler, runs that handler — through its own configured execution mode
 * (lib/harness/ for HARNESS, lib/runtime/agent-runtime.ts for LOOP) — this
 * only decides *which* agent gets called and *how much it costs to decide
 * that*, never how the chosen agent executes once picked. Runs nothing if
 * no agent's scope clearly fits (CLAUDE.md #14 — no agent acting outside
 * its stated scope, not even a best guess).
 *
 * `input` should be the message's actual content (subject + body) only —
 * never the sender's address. Both the keyword fast path and the LLM
 * classifier match/reason over `input` directly, and a customer's own
 * email address can accidentally collide with a keyword (found live: an
 * address containing "price" silently routed every message to the Quote
 * Agent, regardless of content). The sender goes through `senderEmail`
 * instead, used only for identification (customer lookup / reply-to) by the
 * harness pipelines — it never influences what a message is classified as
 * or what gets extracted from it.
 *
 * triggerIntegrationId narrows the workflow lookup to one bound to that
 * specific connected account (see Workflow.triggerIntegrationId's
 * schema.prisma comment) — null (the default) matches the generic
 * org-wide workflow for this trigger type, today's only behavior for
 * triggers with no natural per-account binding (e.g. EMAIL).
 */
export async function dispatchInboundMessage(
  organisationId: string,
  trigger: WorkflowTriggerType,
  input: string,
  // Optional, resolved lazily below — an org with no active workflow at
  // all (or one whose keyword fast path always resolves routing, and
  // whose matched handler runs a zero-LLM HARNESS pipeline) never touches
  // AI provider configuration. Requiring it unconditionally would make
  // "no workflow configured" indistinguishable from "no AI provider
  // configured", two different setup gaps a business needs to fix in a
  // different order. Same reasoning as resumeRun's own optional provider.
  provider?: AIProvider,
  senderEmail: string | null = null,
  triggerIntegrationId: string | null = null,
  getAttachments?: () => Promise<ResolvedAttachment[]>,
): Promise<DispatchResult> {
  const workflow = await workflowService.findActiveWorkflowForDispatch(
    organisationId,
    trigger,
    triggerIntegrationId,
  );
  if (!workflow) {
    return { matched: false, reason: "no_workflow" };
  }

  const selection = await selectHandler(workflow, input, provider);
  if (!selection.ok) {
    return { matched: false, reason: selection.reason };
  }

  const run = await runAgentByExecutionMode(
    selection.handlerAgent,
    input,
    selection.resolvedProvider,
    senderEmail,
    getAttachments,
  );

  return {
    matched: true,
    agentId: selection.handlerAgent.id,
    agentName: selection.handlerAgent.name,
    run,
  };
}

export type DispatchToWorkflowResult =
  | { matched: true; agentId: string; agentName: string; run: RunResult }
  | {
      matched: false;
      reason: "not_found" | "inactive" | "no_workflow" | "no_match";
    };

/**
 * The chat-initiated counterpart to dispatchInboundMessage — looked up by
 * workflow id directly rather than "the active workflow for this
 * trigger," since chat is naming a specific department, not simulating a
 * real inbound trigger. Everything from here on reuses the exact same
 * classification logic (selectHandler) a real trigger would go through,
 * so a workflow behaves identically whether an email arrived or chat
 * asked it directly.
 *
 * Deliberately does *not* go through runAgentByExecutionMode: that
 * helper always runs at depth 0 (correct for a real trigger, which is
 * always the root of a run), but a workflow invoked by chat is itself
 * one hop into a call chain that already has a depth — mirrors
 * invoke_agent's own tool handler, which calls runAgent/runHarnessPipeline
 * directly for the same reason. HARNESS handlers don't receive
 * invocationDepth at all (same as invoke_agent's target dispatch): a step
 * programme has no step kind that itself invokes an agent or a workflow,
 * so it cannot recurse regardless.
 */
export async function dispatchToWorkflowById(
  organisationId: string,
  workflowId: string,
  input: string,
  invocationDepth: number,
  provider?: AIProvider,
): Promise<DispatchToWorkflowResult> {
  const workflow = await workflowService.getWorkflow(
    organisationId,
    workflowId,
  );
  if (!workflow) {
    return { matched: false, reason: "not_found" };
  }
  if (workflow.status !== "ACTIVE") {
    return { matched: false, reason: "inactive" };
  }

  const selection = await selectHandler(workflow, input, provider);
  if (!selection.ok) {
    return { matched: false, reason: selection.reason };
  }

  const run =
    selection.handlerAgent.executionMode === "HARNESS"
      ? await runHarnessPipeline(
          selection.handlerAgent,
          input,
          selection.resolvedProvider,
        )
      : await runAgent(
          selection.handlerAgent,
          input,
          selection.resolvedProvider,
          invocationDepth + 1,
        );

  return {
    matched: true,
    agentId: selection.handlerAgent.id,
    agentName: selection.handlerAgent.name,
    run,
  };
}
