import Link from "next/link";

import { WorkflowList } from "@/components/workflows/workflow-list";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as workflowService from "@/lib/workflows/workflow-service";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const organisation = await getCurrentOrganisation();
  const [workflows, integrations] = await Promise.all([
    workflowService.listWorkflows(organisation.id),
    integrationService.listIntegrations(organisation.id),
  ]);
  const connectedProviders = new Set(integrations.map((i) => i.provider));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <div className="flex items-center gap-4">
          <Link
            href="/workflows/new"
            className="text-sm font-medium text-primary hover:underline"
          >
            Create workflow
          </Link>
          <Link
            href="/agents"
            className="text-sm font-medium text-primary hover:underline"
          >
            All agents →
          </Link>
        </div>
      </div>

      <WorkflowList
        workflows={workflows}
        connectedProviders={connectedProviders}
      />
    </div>
  );
}
