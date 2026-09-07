"use server";

import { redirect } from "next/navigation";

import * as agentService from "@/lib/agents/agent-service";
import {
  parsePipelineConfigForm,
  resolveCategoryType,
  validatePipelineConfig,
} from "@/lib/agents/pipeline-config-form";
import { agentInputSchema, type CategoryType } from "@/lib/agents/schemas";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export type AgentFormState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

function parseCommaSeparated(formData: FormData, field: string): string[] {
  const raw = formData.get(field);
  return typeof raw === "string"
    ? raw
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    : [];
}

function parseAgentForm(formData: FormData) {
  // Two parallel arrays, zipped by index — the extraction-fields builder
  // (components/agents/agent-form.tsx) renders one name+description input
  // pair per row, always in the same relative order, so index-matching is
  // reliable as long as rows are only added/removed, never reordered.
  const fieldNames = formData.getAll("extractionFieldName");
  const fieldDescriptions = formData.getAll("extractionFieldDescription");
  const fieldLookupEntityTypes = formData.getAll(
    "extractionFieldLookupEntityType",
  );
  const extractionFields = fieldNames.map((name, i) => {
    const lookupEntityType = fieldLookupEntityTypes[i];
    return {
      name: typeof name === "string" ? name : "",
      description:
        typeof fieldDescriptions[i] === "string"
          ? (fieldDescriptions[i] as string)
          : "",
      ...(typeof lookupEntityType === "string" &&
        lookupEntityType.length > 0 && { lookupEntityType }),
    };
  });

  const categoryType = resolveCategoryType(formData);

  return agentInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    instructions: formData.get("instructions"),
    model: formData.get("model"),
    categoryType,
    replySubjectTemplate: formData.get("replySubjectTemplate"),
    keywords: parseCommaSeparated(formData, "keywords"),
    toolNames: formData.getAll("toolNames"),
    extractionFields,
    guardrailKeywords: parseCommaSeparated(formData, "guardrailKeywords"),
    actionIntegrationId: formData.get("actionIntegrationId"),
    pipelineConfig: parsePipelineConfigForm(categoryType, formData),
  });
}

export async function createAgentAction(
  _prevState: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const parsed = parseAgentForm(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const validated = validatePipelineConfig(
    resolveCategoryType(formData) as CategoryType,
    parsed.data.pipelineConfig,
  );
  if ("error" in validated) {
    return { fieldErrors: { pipelineConfig: [validated.error] } };
  }

  const organisation = await getCurrentOrganisation();
  await agentService.createAgent(organisation.id, {
    ...parsed.data,
    pipelineConfig: validated.config,
  });
  redirect("/agents");
}

export async function updateAgentAction(
  agentId: string,
  _prevState: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const parsed = parseAgentForm(formData);
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const validated = validatePipelineConfig(
    resolveCategoryType(formData) as CategoryType,
    parsed.data.pipelineConfig,
  );
  if ("error" in validated) {
    return { fieldErrors: { pipelineConfig: [validated.error] } };
  }

  const organisation = await getCurrentOrganisation();
  try {
    await agentService.updateAgent(organisation.id, agentId, {
      ...parsed.data,
      pipelineConfig: validated.config,
    });
  } catch {
    return { error: "Agent not found." };
  }
  redirect(`/agents/${agentId}`);
}
