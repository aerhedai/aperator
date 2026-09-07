import Link from "next/link";
import { notFound } from "next/navigation";

import {
  activateWorkflowAction,
  addWorkflowMemberAction,
  deactivateWorkflowAction,
} from "@/app/(shell)/(app)/workflows/[id]/actions";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteWorkflowDialog } from "@/components/workflows/delete-workflow-dialog";
import { WorkflowFlowDiagram } from "@/components/workflows/workflow-flow-diagram";
import * as agentService from "@/lib/agents/agent-service";
import * as integrationService from "@/lib/integrations/integration-service";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";
import { getWorkflowWarnings } from "@/lib/workflows/workflow-health";
import * as workflowService from "@/lib/workflows/workflow-service";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailPage({
  params,
  searchParams,
}: PageProps<"/workflows/[id]">) {
  const { id } = await params;
  const { activation_error: activationError } = await searchParams;
  const organisation = await getCurrentOrganisation();
  const workflow = await workflowService.getWorkflow(organisation.id, id);

  if (!workflow) {
    notFound();
  }

  const classifierMember = workflow.members.find(
    (m) => m.role === "CLASSIFIER",
  );
  const handlerMembers = workflow.members.filter((m) => m.role === "HANDLER");

  const runs = await runService.listRunsForAgents(
    organisation.id,
    handlerMembers.map((m) => m.agent.id),
    10,
  );

  const memberAgentIds = new Set(workflow.members.map((m) => m.agent.id));
  const allAgents = await agentService.listAgents(organisation.id);
  const unattachedAgents = allAgents.filter((a) => !memberAgentIds.has(a.id));

  const integrations = await integrationService.listIntegrations(
    organisation.id,
  );
  const connectedProviders = new Set(integrations.map((i) => i.provider));
  const warnings = getWorkflowWarnings(workflow, connectedProviders);

  const triggerIntegration = workflow.triggerIntegrationId
    ? await integrationService.getIntegration(
        organisation.id,
        workflow.triggerIntegrationId,
      )
    : null;

  const otherActiveWorkflow =
    workflow.status !== "ACTIVE"
      ? await workflowService.findActiveWorkflowForTrigger(
          organisation.id,
          workflow.trigger,
          workflow.triggerIntegrationId,
        )
      : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {typeof activationError === "string" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {activationError}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm font-medium text-destructive">
            This workflow is ACTIVE but misconfigured:
          </p>
          {warnings.map((warning) => (
            <p key={warning} className="text-sm text-destructive">
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{workflow.name}</h1>
          <AgentStatusBadge status={workflow.status} />
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={workflow.source === "TEMPLATE" ? "secondary" : "outline"}
          >
            {workflow.source === "TEMPLATE" ? "Template" : "Custom"}
          </Badge>
          <Badge variant="outline">{workflow.trigger}</Badge>
          {workflow.members.length === 0 && (
            <DeleteWorkflowDialog id={workflow.id} name={workflow.name} />
          )}
        </div>
      </div>
      {workflow.members.length > 0 && (
        <p className="-mt-4 text-xs text-muted-foreground">
          This workflow has agents assigned, so it can&rsquo;t be deleted —
          remove them below, or archive the workflow instead.
        </p>
      )}

      {triggerIntegration && (
        <p className="-mt-4 text-sm text-muted-foreground">
          Bound to {triggerIntegration.name}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Status
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {workflow.status === "ACTIVE" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Live — this is the workflow real{" "}
                {workflow.trigger.toLowerCase()} traffic for this organisation
                is routed through.
              </p>
              <form action={deactivateWorkflowAction.bind(null, workflow.id)}>
                <Button type="submit" variant="outline">
                  Deactivate
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Draft — not reachable by real {workflow.trigger.toLowerCase()}{" "}
                traffic yet.
                {otherActiveWorkflow &&
                  ` Activating this will deactivate "${otherActiveWorkflow.name}", which currently holds this trigger — only one workflow per trigger can be active at a time.`}
              </p>
              <form action={activateWorkflowAction.bind(null, workflow.id)}>
                <Button type="submit">Activate</Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>{workflow.description}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowFlowDiagram
            workflowId={workflow.id}
            classifier={
              classifierMember
                ? {
                    id: classifierMember.agent.id,
                    name: classifierMember.agent.name,
                    description: classifierMember.agent.description,
                    status: classifierMember.agent.status,
                    toolCount: classifierMember.agent.tools.length,
                  }
                : null
            }
            handlers={handlerMembers.map((m) => ({
              id: m.agent.id,
              name: m.agent.name,
              description: m.agent.description,
              status: m.agent.status,
              toolCount: m.agent.tools.length,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Add agent to this workflow
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unattachedAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every agent in your organisation is already part of this workflow.{" "}
              <Link href="/agents/new" className="text-primary hover:underline">
                Create a new one
              </Link>{" "}
              to add another category.
            </p>
          ) : (
            <form
              action={addWorkflowMemberAction.bind(null, workflow.id)}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="flex flex-1 flex-col gap-1">
                <label
                  htmlFor="agentId"
                  className="text-xs text-muted-foreground"
                >
                  Agent
                </label>
                <select
                  id="agentId"
                  name="agentId"
                  required
                  className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
                >
                  {unattachedAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="role" className="text-xs text-muted-foreground">
                  Role
                </label>
                <select
                  id="role"
                  name="role"
                  defaultValue="HANDLER"
                  className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
                >
                  <option value="HANDLER">Handler</option>
                  <option value="CLASSIFIER">Classifier</option>
                </select>
              </div>
              <Button type="submit">Add to workflow</Button>
            </form>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            A workflow has one classifier and any number of handlers — adding a
            second classifier replaces routing for this workflow rather than
            running two in parallel.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent runs
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
                    className="flex items-center justify-between gap-3 text-sm hover:underline"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      #{run.id.slice(-8)}
                    </span>
                    <span className="w-28 shrink-0 text-xs text-muted-foreground">
                      {run.agent.name}
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
