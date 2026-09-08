import { installAgentSpec } from "@/lib/agents/agent-spec-install";
import * as agentService from "@/lib/agents/agent-service";
import type { CategoryType } from "@/lib/agents/schemas";
import { prisma } from "@/lib/db/prisma";
import { seedStarterRecordTypes } from "@/lib/records/starter-record-type-service";
import { BUILT_IN_WORKFLOW_TEMPLATES } from "@/lib/workflows/built-in-workflow-templates";
import * as workflowRepository from "@/lib/workflows/workflow-repository";
import type {
  WorkflowTemplateHandler,
  WorkflowTemplateSummary,
} from "@/lib/workflows/workflow-template-types";

/**
 * Workflow templates: a department (a classifier plus its handler agents)
 * installed together as one real, ACTIVE Workflow — the multi-agent
 * counterpart to template-service.ts's lone-agent AgentTemplate.
 *
 * Two sources, one list, same rule as AgentTemplate: built-ins
 * (organisationId null) plus a business's own. Unlike a lone template
 * (which installs as a DRAFT agent nothing points at yet), installing one
 * of these produces a complete, self-contained unit whose only way to do
 * anything consequential is still through the normal tool grant + policy
 * gate — so it's installed and activated immediately, reachable from chat
 * via invoke_workflow the moment it's installed (CLAUDE.md §14: a
 * half-configured setup should be visible, not the default outcome of
 * "install").
 */

function rowToSummary(row: {
  id: string;
  organisationId: string | null;
  name: string;
  description: string;
  classifierInstructions: string;
  handlers: unknown;
  recordTypes: string[];
}): WorkflowTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    classifierInstructions: row.classifierInstructions,
    handlers: row.handlers as WorkflowTemplateHandler[],
    recordTypes: row.recordTypes,
    builtIn: row.organisationId === null,
  };
}

export async function listWorkflowTemplates(
  organisationId: string,
): Promise<WorkflowTemplateSummary[]> {
  // Seeded on every read, same reasoning as template-service.ts's
  // listTemplates — the definitions live in code, so this is what keeps a
  // shipped template's content fix reaching every database without a
  // migration.
  await seedBuiltInWorkflowTemplates();

  const rows = await prisma.workflowTemplate.findMany({
    where: { OR: [{ organisationId: null }, { organisationId }] },
    orderBy: [{ organisationId: "asc" }, { name: "asc" }],
  });
  return rows.map(rowToSummary);
}

export async function getWorkflowTemplate(
  organisationId: string,
  id: string,
): Promise<WorkflowTemplateSummary | null> {
  const row = await prisma.workflowTemplate.findFirst({
    where: { id, OR: [{ organisationId: null }, { organisationId }] },
  });
  return row ? rowToSummary(row) : null;
}

export type InstallWorkflowTemplateResult =
  | { ok: true; workflowId: string; workflowName: string }
  | { ok: false; error: string };

/**
 * Installs a WorkflowTemplate: seeds any Record Types its handlers need,
 * creates a classifier and each handler through the exact same
 * installAgentSpec path a lone template uses, wires them into a new
 * Workflow, and activates all of it immediately — a department is only
 * useful to try if it actually works the moment it's installed, unlike a
 * lone agent (which stays DRAFT for review, since nothing is wired to it
 * yet).
 *
 * trigger is always MANUAL (see schema.prisma's WorkflowTriggerType
 * comment) — this workflow is reached by id via invoke_workflow, never by
 * a real inbound event, so it never competes with a business's real
 * EMAIL/WEBHOOK workflows for the one-ACTIVE-per-trigger slot.
 *
 * The classifier is created chatInvokable: false — its job is routing
 * within this department, not being a standalone thing chat addresses
 * directly (that's what its handlers, and invoke_workflow itself, are
 * for).
 *
 * Not wrapped in a database transaction: agentService.createAgent already
 * does its own multi-step writes (agent row + tool grants) outside any
 * transaction context this function could join. A failure partway through
 * (in practice, only ever a suggested tool that's since stopped existing)
 * leaves whatever agents were already created as ordinary orphaned DRAFT
 * agents — inert until a human attaches or deletes them, not a corrupt
 * state — rather than risking a half-open transaction across an
 * arbitrarily long handler list.
 */
export async function installWorkflowTemplate(
  organisationId: string,
  templateId: string,
): Promise<InstallWorkflowTemplateResult> {
  const template = await getWorkflowTemplate(organisationId, templateId);
  if (!template) {
    return { ok: false, error: "Template not found." };
  }

  if (template.recordTypes.length > 0) {
    await seedStarterRecordTypes(organisationId, template.recordTypes);
  }

  const classifierResult = await installAgentSpec(organisationId, {
    name: `${template.name} Classifier`,
    description: `Classifies requests for the "${template.name}" department and routes them to the right specialist — not a handler itself.`,
    instructions: template.classifierInstructions,
    categoryType: "loop",
    suggestedTools: [],
  });
  if (!classifierResult.ok) {
    return { ok: false, error: classifierResult.error };
  }
  await agentService.updateAgentStatus(
    organisationId,
    classifierResult.agentId,
    "ACTIVE",
  );
  await prisma.agent.update({
    where: { id: classifierResult.agentId },
    data: { chatInvokable: false },
  });

  const handlerIds: string[] = [];
  for (const handler of template.handlers) {
    const handlerResult = await installAgentSpec(organisationId, {
      name: handler.name,
      description: handler.description,
      instructions: handler.instructions,
      categoryType: handler.categoryType as CategoryType,
      suggestedTools: handler.suggestedTools,
      steps: handler.steps,
      keywords: handler.keywords,
      extractionFields: handler.extractionFields,
      guardrailKeywords: handler.guardrailKeywords,
    });
    if (!handlerResult.ok) {
      return { ok: false, error: handlerResult.error };
    }
    await agentService.updateAgentStatus(
      organisationId,
      handlerResult.agentId,
      "ACTIVE",
    );
    handlerIds.push(handlerResult.agentId);
  }

  const workflow = await prisma.workflow.create({
    data: {
      organisationId,
      name: template.name,
      description: template.description,
      trigger: "MANUAL",
      status: "ACTIVE",
      source: "TEMPLATE",
      templateKey: template.id,
    },
  });

  await workflowRepository.addWorkflowMember(
    workflow.id,
    classifierResult.agentId,
    "CLASSIFIER",
  );
  for (const handlerId of handlerIds) {
    await workflowRepository.addWorkflowMember(
      workflow.id,
      handlerId,
      "HANDLER",
    );
  }

  return { ok: true, workflowId: workflow.id, workflowName: workflow.name };
}

/**
 * Seeds the built-in workflow templates, idempotently — matched by name
 * among the null-organisation rows, same convergent-update pattern as
 * template-service.ts's seedBuiltInTemplates.
 */
export async function seedBuiltInWorkflowTemplates(): Promise<number> {
  let written = 0;
  for (const template of BUILT_IN_WORKFLOW_TEMPLATES) {
    const existing = await prisma.workflowTemplate.findFirst({
      where: { organisationId: null, name: template.name },
    });
    const data = {
      name: template.name,
      description: template.description,
      classifierInstructions: template.classifierInstructions,
      handlers: template.handlers as object,
      recordTypes: template.recordTypes,
    };
    if (existing) {
      await prisma.workflowTemplate.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.workflowTemplate.create({
        data: { ...data, organisationId: null },
      });
    }
    written += 1;
  }
  return written;
}
