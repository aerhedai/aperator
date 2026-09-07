import { createAgentAction } from "@/app/(app)/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import * as templateService from "@/lib/agents/template-service";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const organisation = await getCurrentOrganisation();
  const [templates, gmailIntegrations] = await Promise.all([
    templateService.listTemplates(organisation.id),
    integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
  ]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Create agent</h1>
      <AgentForm
        action={createAgentAction}
        submitLabel="Create agent"
        templates={templates}
        gmailIntegrations={gmailIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
      />
    </div>
  );
}
