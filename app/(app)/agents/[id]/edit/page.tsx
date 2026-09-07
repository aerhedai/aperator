import { notFound } from "next/navigation";

import { updateAgentAction } from "@/app/(app)/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import * as agentService from "@/lib/agents/agent-service";
import * as templateService from "@/lib/agents/template-service";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({
  params,
}: PageProps<"/agents/[id]/edit">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const [agent, templates, gmailIntegrations] = await Promise.all([
    agentService.getAgent(organisation.id, id),
    templateService.listTemplates(organisation.id),
    integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
  ]);

  if (!agent) {
    notFound();
  }

  // Passed through raw rather than schema-parsed: the step editor
  // round-trips JSON, and pre-filling with exactly what's stored — even if
  // it no longer validates — is what lets someone repair a broken
  // programme instead of losing it.
  const initialStepsConfig =
    agent.pipelineKey === "steps" &&
    agent.pipelineConfig &&
    typeof agent.pipelineConfig === "object" &&
    !Array.isArray(agent.pipelineConfig)
      ? (agent.pipelineConfig as Record<string, unknown>)
      : undefined;

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Edit {agent.name}</h1>
      <AgentForm
        action={updateAgentAction.bind(null, agent.id)}
        agent={{
          ...agent,
          toolNames: agent.tools.map((t) => t.toolName),
        }}
        submitLabel="Save changes"
        templates={templates}
        gmailIntegrations={gmailIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
        initialStepsConfig={initialStepsConfig}
      />
    </div>
  );
}
