import Link from "next/link";

import { AgentList } from "@/components/agents/agent-list";
import { Button } from "@/components/ui/button";
import * as agentService from "@/lib/agents/agent-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

// Always show live data; this must never be a stale build-time snapshot.
export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const organisation = await getCurrentOrganisation();
  const agents = await agentService.listAgents(organisation.id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Agents</h1>
        <Button nativeButton={false} render={<Link href="/agents/new" />}>
          Create agent
        </Button>
      </div>

      <AgentList agents={agents} />
    </div>
  );
}
