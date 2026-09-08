"use server";

import { redirect } from "next/navigation";

import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import { workflowInputSchema } from "@/lib/workflows/schemas";
import * as workflowService from "@/lib/workflows/workflow-service";
import * as workflowTemplateService from "@/lib/workflows/workflow-template-service";

export type WorkflowFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

export async function createWorkflowAction(
  _prevState: WorkflowFormState,
  formData: FormData,
): Promise<WorkflowFormState> {
  const rawTriggerIntegrationId = formData.get("triggerIntegrationId");
  const parsed = workflowInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    trigger: formData.get("trigger"),
    triggerIntegrationId:
      typeof rawTriggerIntegrationId === "string" &&
      rawTriggerIntegrationId.length > 0
        ? rawTriggerIntegrationId
        : null,
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const organisation = await getCurrentOrganisation();
  let workflow;
  try {
    workflow = await workflowService.createWorkflow(
      organisation.id,
      parsed.data,
    );
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Failed to create workflow.",
    };
  }
  redirect(`/workflows/${workflow.id}`);
}

/**
 * Installs a WorkflowTemplate (a whole department) and redirects to it.
 * The actual work lives in workflowTemplateService.installWorkflowTemplate,
 * shared with the install_workflow_template tool so a human clicking this
 * button and chat acting on its own initiative go through identical logic.
 * Unlike installAgentTemplateAction (agents/actions.ts), the result is
 * already ACTIVE — there's no draft-review step for a whole department.
 */
export async function installWorkflowTemplateAction(
  templateId: string,
): Promise<void> {
  const organisation = await getCurrentOrganisation();
  const result = await workflowTemplateService.installWorkflowTemplate(
    organisation.id,
    templateId,
  );
  if (!result.ok) {
    redirect(`/templates?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/workflows/${result.workflowId}`);
}
