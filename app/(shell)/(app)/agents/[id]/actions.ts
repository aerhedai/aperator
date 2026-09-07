"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import * as agentService from "@/lib/agents/agent-service";
import {
  AIProviderNotConfiguredError,
  getAIProvider,
} from "@/lib/ai/organisation-ai-provider";
import type { AgentStatus } from "@/lib/generated/prisma/client";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import { runAgentByExecutionMode } from "@/lib/runtime/run-agent-by-mode";

export type RunAgentFormState = {
  error?: string;
};

export async function runAgentAction(
  agentId: string,
  _prevState: RunAgentFormState,
  formData: FormData,
): Promise<RunAgentFormState> {
  const input = formData.get("input");
  if (typeof input !== "string" || input.trim().length === 0) {
    return { error: "Enter some input for the agent to process." };
  }

  const organisation = await getCurrentOrganisation();
  const agent = await agentService.getAgent(organisation.id, agentId);
  if (!agent) {
    notFound();
  }

  let provider;
  try {
    provider = await getAIProvider(organisation.id);
  } catch (error) {
    if (error instanceof AIProviderNotConfiguredError) {
      return { error: error.message };
    }
    throw error;
  }

  const result = await runAgentByExecutionMode(agent, input.trim(), provider);
  redirect(`/runs/${result.runId}`);
}

// A workflow's dispatcher only ever routes to an ACTIVE handler
// (lib/routing/dispatch.ts) — DRAFT is the default so a half-configured
// agent can never receive real traffic by accident; this is the one place
// that moves it out of DRAFT once it's ready.
export async function updateAgentStatusAction(
  agentId: string,
  status: AgentStatus,
) {
  const organisation = await getCurrentOrganisation();
  try {
    await agentService.updateAgentStatus(organisation.id, agentId, status);
  } catch {
    notFound();
  }
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/agents");
}

// Only offered in the UI when the agent has zero runs (see
// app/(app)/agents/[id]/page.tsx) — deleting one with real run history
// throws (agent-service.ts), archiving is the only removal path for those.
export async function deleteAgentAction(agentId: string) {
  const organisation = await getCurrentOrganisation();
  const deleted = await agentService.deleteAgent(organisation.id, agentId);
  if (!deleted) {
    notFound();
  }
  revalidatePath("/agents");
  redirect("/agents");
}
