import { prisma } from "@/lib/db/prisma";
import type {
  TaskSchedulePreset,
  WorkflowAgentRole,
  WorkflowTriggerType,
} from "@/lib/generated/prisma/client";

/**
 * triggerIntegrationId narrows to a workflow bound to that *specific*
 * connected account (e.g. exactly which webhook URL/secret received the
 * request) — pass null (the default) for "the generic workflow for this
 * trigger type," today's only behavior and still correct for triggers
 * with no natural per-account binding yet. This is a direct match, not a
 * fallback chain: a webhook request always knows its own integrationId
 * (it's in the URL), so there's no "specific, then fall back to generic"
 * case to handle — if nothing is bound to this exact account, that's a
 * real "no workflow configured for this," not a reason to guess at one.
 */
export function findActiveWorkflowByTrigger(
  organisationId: string,
  trigger: WorkflowTriggerType,
  triggerIntegrationId: string | null = null,
) {
  return prisma.workflow.findFirst({
    where: { organisationId, trigger, triggerIntegrationId, status: "ACTIVE" },
    include: {
      members: { include: { agent: true } },
    },
  });
}

export function findWorkflowsByOrganisation(organisationId: string) {
  return prisma.workflow.findMany({
    where: { organisationId },
    orderBy: { createdAt: "desc" },
    include: {
      members: { include: { agent: { include: { tools: true } } } },
    },
  });
}

export function findWorkflowById(organisationId: string, id: string) {
  return prisma.workflow.findFirst({
    where: { id, organisationId },
    include: {
      members: {
        include: {
          agent: {
            include: { tools: true, _count: { select: { runs: true } } },
          },
        },
      },
    },
  });
}

// Idempotent (upsert on the workflowId+agentId unique constraint) — adding
// an already-attached agent just updates its role rather than erroring,
// same pattern as provisionEmailWorkflow's own membership upserts.
export function addWorkflowMember(
  workflowId: string,
  agentId: string,
  role: WorkflowAgentRole,
) {
  return prisma.workflowAgent.upsert({
    where: { workflowId_agentId: { workflowId, agentId } },
    update: { role },
    create: { workflowId, agentId, role },
  });
}

// Scoped via the workflow's own organisationId, not trusted from the
// workflowId/agentId pair alone — the join is what stops one org's
// request from touching another org's membership row.
export function removeWorkflowMember(
  organisationId: string,
  workflowId: string,
  agentId: string,
) {
  return prisma.workflowAgent.deleteMany({
    where: { workflowId, agentId, workflow: { organisationId } },
  });
}

export function createWorkflow(
  organisationId: string,
  input: {
    name: string;
    description: string;
    trigger: WorkflowTriggerType;
    triggerIntegrationId?: string | null;
    schedulePreset?: TaskSchedulePreset | null;
    scheduledPrompt?: string | null;
  },
) {
  return prisma.workflow.create({
    data: { ...input, organisationId, source: "CUSTOM", status: "DRAFT" },
  });
}

export function setWorkflowStatus(
  workflowId: string,
  status: "ACTIVE" | "DRAFT",
) {
  return prisma.workflow.update({
    where: { id: workflowId },
    data: { status },
  });
}

export function deleteWorkflow(organisationId: string, id: string) {
  return prisma.workflow.deleteMany({ where: { id, organisationId } });
}

// The cron sweep's own candidate list (app/api/cron/run-due-tasks) —
// mirrors taskRepository.listActiveRoutines's shape, "due" itself is
// checked in application code (isPresetDue) since it depends on comparing
// each preset's cadence against that workflow's own lastScheduledFireAt,
// not expressible as a single where clause across every preset shape.
// Same members-with-agent include as findActiveWorkflowByTrigger, since
// both feed the same selectHandler (lib/routing/dispatch.ts).
export function findActiveScheduledWorkflows() {
  return prisma.workflow.findMany({
    where: { status: "ACTIVE", trigger: "SCHEDULE" },
    include: { members: { include: { agent: true } } },
  });
}

// Set at the start of a fire attempt, not on success — see
// Workflow.lastScheduledFireAt's schema.prisma comment for why.
export function markWorkflowScheduledFire(workflowId: string, firedAt: Date) {
  return prisma.workflow.update({
    where: { id: workflowId },
    data: { lastScheduledFireAt: firedAt },
  });
}

// Everything else already ACTIVE on this org+trigger+account, demoted to
// DRAFT — the other half of activateWorkflow's swap (workflow-service.ts).
// Scoped to triggerIntegrationId too, not just trigger: two workflows on
// the same trigger type but *different* bound accounts (e.g. two separate
// webhook URLs) don't compete for exclusivity at all — each account's
// traffic is its own, so activating one must never deactivate the other.
export function deactivateOtherWorkflowsForTrigger(
  organisationId: string,
  trigger: WorkflowTriggerType,
  triggerIntegrationId: string | null,
  excludeWorkflowId: string,
) {
  return prisma.workflow.updateMany({
    where: {
      organisationId,
      trigger,
      triggerIntegrationId,
      status: "ACTIVE",
      id: { not: excludeWorkflowId },
    },
    data: { status: "DRAFT" },
  });
}
