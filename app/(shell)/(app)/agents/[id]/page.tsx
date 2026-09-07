import Link from "next/link";
import { notFound } from "next/navigation";

import {
  runAgentAction,
  updateAgentStatusAction,
} from "@/app/(shell)/(app)/agents/[id]/actions";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { DeleteAgentDialog } from "@/components/agents/delete-agent-dialog";
import { RunAgentForm } from "@/components/agents/run-agent-form";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as agentToolRepository from "@/lib/agents/agent-tool-repository";
import * as agentService from "@/lib/agents/agent-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({
  params,
}: PageProps<"/agents/[id]">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const agent = await agentService.getAgent(organisation.id, id);

  if (!agent) {
    notFound();
  }

  const [runs, toolNames] = await Promise.all([
    runService.listRunsForAgent(organisation.id, agent.id),
    agentToolRepository.findToolNamesForAgent(agent.id),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          <AgentStatusBadge status={agent.status} />
        </div>
        <div className="flex items-center gap-2">
          {agent.status === "ACTIVE" ? (
            <form
              action={updateAgentStatusAction.bind(null, agent.id, "ARCHIVED")}
            >
              <Button type="submit" variant="outline">
                Archive
              </Button>
            </form>
          ) : (
            <form
              action={updateAgentStatusAction.bind(null, agent.id, "ACTIVE")}
            >
              <Button type="submit" variant="outline">
                Activate
              </Button>
            </form>
          )}
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href={`/agents/${agent.id}/edit`} />}
          >
            Edit
          </Button>
          {runs.length === 0 && (
            <DeleteAgentDialog id={agent.id} name={agent.name} />
          )}
        </div>
      </div>
      {runs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          This agent has run history, so it can&rsquo;t be deleted — archive it
          instead to keep it out of workflow dispatch.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p>{agent.description}</p>
          <p className="text-sm text-muted-foreground">
            Model: <span className="font-mono">{agent.model}</span> · Version{" "}
            {agent.version}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Instructions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap">{agent.instructions}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {toolNames.length > 0
              ? toolNames.join(", ")
              : "No tools assigned — this agent can only reply with plain text."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Run agent
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RunAgentForm action={runAgentAction.bind(null, agent.id)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="flex items-center justify-between text-sm hover:underline"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      #{run.id.slice(-8)}
                    </span>
                    <span className="truncate px-2">{run.input}</span>
                    <RunStatusBadge status={run.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
