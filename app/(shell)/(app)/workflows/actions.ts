"use server";

import { redirect } from "next/navigation";

import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import { workflowInputSchema } from "@/lib/workflows/schemas";
import * as workflowService from "@/lib/workflows/workflow-service";

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
