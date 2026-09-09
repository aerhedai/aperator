import { notFound } from "next/navigation";

import { updateAgentAction } from "@/app/(shell)/(app)/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import * as agentService from "@/lib/agents/agent-service";
import * as templateService from "@/lib/agents/template-service";
import * as integrationService from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({
  params,
}: PageProps<"/agents/[id]/edit">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const [
    agent,
    templates,
    gmailIntegrations,
    mcpIntegrations,
    allIntegrations,
  ] = await Promise.all([
    agentService.getAgent(organisation.id, id),
    templateService.listTemplates(organisation.id),
    integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
    integrationService.listIntegrationsByProvider(organisation.id, "mcp"),
    integrationService.listIntegrations(organisation.id),
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
        connectedIntegrations={connectedIntegrations}
        initialStepsConfig={initialStepsConfig}
        mcpConnections={mcpConnections}
      />
    </div>
  );
}
