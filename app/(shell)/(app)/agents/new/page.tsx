import { createAgentAction } from "@/app/(shell)/(app)/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import * as templateService from "@/lib/agents/template-service";
import * as integrationService from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function NewAgentPage({
  searchParams,
}: PageProps<"/agents/new">) {
  const { template: templateId } = await searchParams;
  const organisation = await getCurrentOrganisation();
  const [templates, gmailIntegrations, mcpIntegrations, allIntegrations] =
    await Promise.all([
      templateService.listTemplates(organisation.id),
      integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
      integrationService.listIntegrationsByProvider(organisation.id, "mcp"),
      integrationService.listIntegrations(organisation.id),
    ]);

  // Arriving from the standalone /templates page with a template already
  // chosen (?template=<id>) — resolved against this organisation's own
  // list, the same one the in-form picker uses, so a stale or
  // wrong-organisation id just falls through to no preselection rather
  // than erroring.
  const preselectedTemplate =
    typeof templateId === "string"
      ? templates.find((t) => t.id === templateId)
      : undefined;

  const mcpConnections = mcpIntegrations.map((integration) => ({
    id: integration.id,
    label: integration.name,
    tools: (integration.config as { tools?: DiscoveredMcpTool[] }).tools ?? [],
  }));

  // Scope-based tool availability (docs/provider-specific-tools-design.md)
  // needs every connected account's provider and granted scopes, not just
  // Gmail's — mcp connections are excluded since their tools are handled
  // entirely separately, via mcpConnections above.
  const connectedIntegrations = allIntegrations
    .filter((i) => i.provider !== integrationService.MCP_PROVIDER)
    .map((i) => ({
      provider: i.provider,
      grantedScopes:
        (i.config as { grantedScopes?: string[] } | null)?.grantedScopes ?? [],
    }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Create agent</h1>
      <AgentForm
        action={createAgentAction}
        submitLabel="Create agent"
        templates={templates}
        preselectedTemplate={preselectedTemplate}
        gmailIntegrations={gmailIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
        connectedIntegrations={connectedIntegrations}
        mcpConnections={mcpConnections}
      />
    </div>
  );
}
