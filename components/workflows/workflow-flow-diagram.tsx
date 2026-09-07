import Link from "next/link";

import { removeWorkflowMemberAction } from "@/app/(shell)/(app)/workflows/[id]/actions";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AgentStatus } from "@/lib/generated/prisma/client";

export interface FlowAgent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  toolCount: number;
}

function AgentNode({
  agent,
  kind,
  workflowId,
}: {
  agent: FlowAgent;
  kind: "classifier" | "handler";
  // Omitted: read-only node, no remove control (not currently used, kept
  // optional in case a future caller wants a non-editable view).
  workflowId?: string;
}) {
  return (
    <div className="flex w-56 shrink-0 flex-col gap-1">
      <Link href={`/agents/${agent.id}`} className="block">
        <Card className="gap-2 px-4 transition-colors hover:border-primary/40">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
              {kind === "classifier" ? "Classifier" : "Handler"}
            </span>
            <AgentStatusBadge status={agent.status} />
          </div>
          <p className="text-sm font-medium">{agent.name}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {agent.description}
          </p>
          <p className="text-xs text-muted-foreground">
            {agent.toolCount} tool{agent.toolCount === 1 ? "" : "s"}
          </p>
        </Card>
      </Link>
      {workflowId && (
        <form
          action={removeWorkflowMemberAction.bind(null, workflowId, agent.id)}
          className="self-center"
        >
          <Button type="submit" variant="outline" size="sm">
            Remove from workflow
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * A deliberately simple flow chart (plain divs + borders, no diagramming
 * library — CLAUDE.md #4 says not to build a complex visual editor): one
 * classifier fanning out to its handler agents, each node linking through
 * to that agent's own detail page. "Remove from workflow" only ever
 * removes the membership row (WorkflowAgent) — the agent itself is
 * untouched and can be re-added here or attached to a different workflow.
 */
export function WorkflowFlowDiagram({
  workflowId,
  classifier,
  handlers,
}: {
  workflowId: string;
  classifier: FlowAgent | null;
  handlers: FlowAgent[];
}) {
  if (!classifier) {
    return (
      <p className="text-sm text-muted-foreground">
        This workflow has no classifier agent assigned.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center overflow-x-auto py-2">
      <AgentNode agent={classifier} kind="classifier" workflowId={workflowId} />

      {handlers.length > 0 && (
        <>
          <div className="h-6 w-px bg-border" />
          <div className="flex gap-6 border-t border-border pt-6">
            {handlers.map((handler) => (
              <div
                key={handler.id}
                className="-mt-6 flex flex-col items-center gap-2"
              >
                <div className="h-6 w-px bg-border" />
                <AgentNode
                  agent={handler}
                  kind="handler"
                  workflowId={workflowId}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
