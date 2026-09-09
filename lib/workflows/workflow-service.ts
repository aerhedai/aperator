import * as agentRepository from "@/lib/agents/agent-repository";
import {
  Prisma,
  type WorkflowAgentRole,
  type WorkflowTriggerType,
} from "@/lib/generated/prisma/client";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import { EMAIL_TRIGGER_PROVIDERS } from "@/lib/workflows/email-trigger-providers";
import type { WorkflowInput } from "@/lib/workflows/schemas";
import * as workflowRepository from "@/lib/workflows/workflow-repository";

// Which Integration.provider(s) a trigger's bound account may be —
// enforced here (not in the Zod schema) because it needs a DB lookup to
// check. WEBHOOK has no generic fallback (there's no non-account-specific
// webhook URL), so it's required; EMAIL still allows null (the org-wide
// default email account, today's only behavior for email-triggered
// workflows).
const TRIGGER_INTEGRATION_PROVIDERS: Record<WorkflowTriggerType, string[]> = {
  EMAIL: [...EMAIL_TRIGGER_PROVIDERS],
  WEBHOOK: ["webhook"],
  // No connected account is ever valid here — a MANUAL workflow (only
  // ever created by installWorkflowTemplate) is reached by id, never by
  // an inbound account-bound event.
  MANUAL: [],
};
const TRIGGERS_REQUIRING_ACCOUNT: WorkflowTriggerType[] = ["WEBHOOK"];

async function validateTriggerIntegration(
  organisationId: string,
  trigger: WorkflowTriggerType,
  triggerIntegrationId: string | null | undefined,
) {
  if (!triggerIntegrationId) {
    if (TRIGGERS_REQUIRING_ACCOUNT.includes(trigger)) {
      throw new Error(
        `A ${trigger} workflow must be bound to a specific connected account`,
      );
    }
    return;
  }

  const integration = await integrationRepository.findIntegrationById(
    organisationId,
    triggerIntegrationId,
  );
  if (!integration) {
    throw new Error("Connected account not found");
  }
  const allowedProviders = TRIGGER_INTEGRATION_PROVIDERS[trigger];
  if (!allowedProviders.includes(integration.provider)) {
    throw new Error(
      `A ${trigger} workflow must be bound to a ${allowedProviders.join(" or ")} account, not a ${integration.provider} one`,
    );
  }
}

// Used by the workflow detail page to warn before activating: "this will
// deactivate <name>" is a much clearer moment to learn about the
// one-active-workflow-per-(trigger,account) rule than discovering it after
// the fact.
export function findActiveWorkflowForTrigger(
  organisationId: string,
  trigger: Parameters<typeof workflowRepository.findActiveWorkflowByTrigger>[1],
  triggerIntegrationId: string | null = null,
) {
  return workflowRepository.findActiveWorkflowByTrigger(
    organisationId,
    trigger,
    triggerIntegrationId,
  );
}

/**
 * Dispatch-time lookup — unlike findActiveWorkflowForTrigger (an exact
 * one-slot check used only to warn before activation), this is about
 * routing real inbound traffic to *something* that handles it: prefers a
 * workflow bound to the exact account the message arrived on, but falls
 * back to the org-wide generic workflow (triggerIntegrationId: null) if
 * none is bound to that specific account. This is what keeps a
 * single-account organisation's existing generic EMAIL workflow working
 * unchanged now that checkInboxAction resolves and passes its Gmail
 * integration id through — without this fallback, every pre-existing
 * null-bound workflow would stop matching the instant a real account id
 * is passed. Harmless no-op for WEBHOOK: a null-bound ACTIVE WEBHOOK
 * workflow can never exist (createWorkflow requires an account for
 * WEBHOOK), so the fallback query there always finds nothing.
 */
export async function findActiveWorkflowForDispatch(
  organisationId: string,
  trigger: Parameters<typeof workflowRepository.findActiveWorkflowByTrigger>[1],
  triggerIntegrationId: string | null,
) {
  const specific = await workflowRepository.findActiveWorkflowByTrigger(
    organisationId,
    trigger,
    triggerIntegrationId,
  );
  if (specific || !triggerIntegrationId) {
    return specific;
  }
  return workflowRepository.findActiveWorkflowByTrigger(
    organisationId,
    trigger,
    null,
  );
}

export function listWorkflows(organisationId: string) {
  return workflowRepository.findWorkflowsByOrganisation(organisationId);
}

export function getWorkflow(organisationId: string, id: string) {
  return workflowRepository.findWorkflowById(organisationId, id);
}

/**
 * Both the workflow and the agent are re-looked-up scoped to
 * organisationId here, not trusted from the caller's ids alone — the only
 * thing standing between this and attaching another organisation's agent
 * to your workflow (or vice versa) is this check.
 */
export async function addMember(
  organisationId: string,
  workflowId: string,
  agentId: string,
  role: WorkflowAgentRole,
) {
  const workflow = await workflowRepository.findWorkflowById(
    organisationId,
    workflowId,
  );
  if (!workflow) {
    throw new Error("Workflow not found");
  }
  const agent = await agentRepository.findAgentById(organisationId, agentId);
  if (!agent) {
    throw new Error("Agent not found");
  }
  return workflowRepository.addWorkflowMember(workflowId, agentId, role);
}

// Removes the membership row only — never touches the agent itself. An
// agent stays exactly as configured and can be re-added to this or any
// other workflow later; this is the "wrong workflow, not wrong agent"
// fix that deleting the agent (a separate, unrelated action) isn't.
export async function removeMember(
  organisationId: string,
  workflowId: string,
  agentId: string,
): Promise<boolean> {
  const { count } = await workflowRepository.removeWorkflowMember(
    organisationId,
    workflowId,
    agentId,
  );
  return count > 0;
}

// Always CUSTOM/DRAFT — a template's workflow only ever comes from
// provision-email-workflow.ts (or a future equivalent), never this path.
// Starting in DRAFT means a business can build a workflow out (add its
// classifier and handlers) without it ever being reachable by real
// inbound traffic until they explicitly activate it.
export async function createWorkflow(
  organisationId: string,
  input: WorkflowInput,
) {
  await validateTriggerIntegration(
    organisationId,
    input.trigger,
    input.triggerIntegrationId,
  );
  return workflowRepository.createWorkflow(organisationId, input);
}

/**
 * At most one workflow per (organisationId, trigger, triggerIntegrationId)
 * may be ACTIVE — dispatchInboundMessage can only ever route to one, so a
 * second ACTIVE workflow on the same trigger+account wouldn't run in
 * parallel, it would just be silently unreachable (see the Workflow.status
 * field comment in schema.prisma). Two workflows on the same trigger but
 * *different* bound accounts don't compete at all. Activating this one
 * demotes whatever else currently holds this trigger+account to DRAFT, in
 * the same call — an explicit swap, not something the caller has to
 * remember to do in two steps.
 */
export async function activateWorkflow(
  organisationId: string,
  workflowId: string,
) {
  const workflow = await workflowRepository.findWorkflowById(
    organisationId,
    workflowId,
  );
  if (!workflow) {
    throw new Error("Workflow not found");
  }

  const hasClassifier = workflow.members.some((m) => m.role === "CLASSIFIER");
  const hasHandler = workflow.members.some((m) => m.role === "HANDLER");
  if (!hasClassifier || !hasHandler) {
    throw new Error(
      "A workflow needs a classifier and at least one handler before it can be activated",
    );
  }

  // MANUAL workflows don't compete for a trigger slot — nothing ever
  // dispatches to them by (trigger, account), only by id (invoke_workflow),
  // so any number of them may be ACTIVE at once. Only EMAIL/WEBHOOK, where
  // a real inbound event needs exactly one deterministic recipient, ever
  // need the swap below.
  if (workflow.trigger !== "MANUAL") {
    await workflowRepository.deactivateOtherWorkflowsForTrigger(
      organisationId,
      workflow.trigger,
      workflow.triggerIntegrationId,
      workflowId,
    );
  }
  return workflowRepository.setWorkflowStatus(workflowId, "ACTIVE");
}

export async function deactivateWorkflow(
  organisationId: string,
  workflowId: string,
) {
  const workflow = await workflowRepository.findWorkflowById(
    organisationId,
    workflowId,
  );
  if (!workflow) {
    throw new Error("Workflow not found");
  }
  return workflowRepository.setWorkflowStatus(workflowId, "DRAFT");
}

export async function deleteWorkflow(
  organisationId: string,
  id: string,
): Promise<boolean> {
  try {
    const { count } = await workflowRepository.deleteWorkflow(
      organisationId,
      id,
    );
    return count > 0;
  } catch (error) {
    // P2003: foreign key constraint failed — this workflow still has
    // WorkflowAgent membership rows (WorkflowAgent.workflow is
    // deliberately not cascaded, see workflow-repository.ts). Removing
    // its members first, or archiving it, both work; deleting it outright
    // while agents are still attached does not.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      throw new Error(
        "This workflow still has agents assigned — remove them first, or archive the workflow instead.",
      );
    }
    throw error;
  }
}
