import type {
  AgentStatus,
  WorkflowAgentRole,
  WorkflowTriggerType,
} from "@/lib/generated/prisma/client";
import { EMAIL_TRIGGER_PROVIDERS } from "@/lib/workflows/email-trigger-providers";

// Pure, read-only diagnostics — no schema change, no write path. Exists
// because an ACTIVE workflow can silently do nothing at all (no connected
// account for its trigger, no classifier, no active handler) with
// nothing in the UI ever saying so — the exact failure mode that left a
// real workflow inert for an entire session before anyone noticed. This
// is checked at read time (workflow list/detail pages), not enforced at
// activation time, since a workflow that passed activation can still
// decay into this state later (e.g. its only handler gets archived, or
// its bound account gets disconnected).
export function getWorkflowWarnings(
  workflow: {
    status: AgentStatus;
    trigger: WorkflowTriggerType;
    triggerIntegrationId: string | null;
    members: {
      role: WorkflowAgentRole;
      agent: { status: AgentStatus };
    }[];
  },
  connectedProviders: Set<string>,
): string[] {
  if (workflow.status !== "ACTIVE") {
    return [];
  }

  const warnings: string[] = [];

  const hasClassifier = workflow.members.some((m) => m.role === "CLASSIFIER");
  if (!hasClassifier) {
    warnings.push(
      "No classifier is assigned — this department can never route anything.",
    );
  }

  const hasActiveHandler = workflow.members.some(
    (m) => m.role === "HANDLER" && m.agent.status === "ACTIVE",
  );
  if (!hasActiveHandler) {
    warnings.push(
      "No active handler worker — even a matched message has nothing to run.",
    );
  }

  if (
    workflow.trigger === "EMAIL" &&
    !workflow.triggerIntegrationId &&
    !EMAIL_TRIGGER_PROVIDERS.some((p) => connectedProviders.has(p))
  ) {
    warnings.push(
      "No Gmail or Outlook account is connected — this department can never receive real email.",
    );
  }

  return warnings;
}
