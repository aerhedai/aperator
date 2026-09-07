import { WorkflowForm } from "@/components/workflows/workflow-form";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export default async function NewWorkflowPage() {
  const organisation = await getCurrentOrganisation();
  const [webhookIntegrations, gmailIntegrations] = await Promise.all([
    integrationService.listIntegrationsByProvider(organisation.id, "webhook"),
    integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Create workflow</h1>
      <p className="text-sm text-muted-foreground">
        A custom workflow for a process this business needs that isn&rsquo;t one
        of the built-in starters. It&rsquo;s created as a draft — add a
        classifier and handler agents on the next page, then activate it.
      </p>
      <WorkflowForm
        webhookIntegrations={webhookIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
        gmailIntegrations={gmailIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
      />
    </div>
  );
}
