"use client";

import { LayoutGrid, List, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WorkflowFlowDiagram } from "@/components/workflows/workflow-flow-diagram";
import { useStoredView } from "@/lib/hooks/use-stored-view";
import { cn } from "@/lib/utils";
import type * as workflowService from "@/lib/workflows/workflow-service";
import { getWorkflowWarnings } from "@/lib/workflows/workflow-health";

type Workflow = Awaited<
  ReturnType<typeof workflowService.listWorkflows>
>[number];

const VIEWS = ["tile", "list"] as const;
const VIEW_STORAGE_KEY = "aperator-workflows-view";

export function WorkflowList({
  workflows,
  connectedProviders,
}: {
  workflows: Workflow[];
  connectedProviders: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [view, changeView] = useStoredView(VIEW_STORAGE_KEY, "tile", VIEWS);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter(
      (workflow) =>
        workflow.name.toLowerCase().includes(q) ||
        workflow.description.toLowerCase().includes(q),
    );
  }, [workflows, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search workflows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
          <button
            type="button"
            aria-label="Tile view"
            aria-pressed={view === "tile"}
            onClick={() => changeView("tile")}
            className={cn(
              "rounded-sm p-1.5 text-muted-foreground transition-colors",
              view === "tile" && "bg-secondary text-foreground",
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => changeView("list")}
            className={cn(
              "rounded-sm p-1.5 text-muted-foreground transition-colors",
              view === "list" && "bg-secondary text-foreground",
            )}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query
            ? "No workflows match your search."
            : "No workflows yet — a workflow ties a classifier agent to the handler agents it can route to."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((workflow) => {
            const classifierMember = workflow.members.find(
              (m) => m.role === "CLASSIFIER",
            );
            const handlerMembers = workflow.members.filter(
              (m) => m.role === "HANDLER",
            );
            const warnings = getWorkflowWarnings(workflow, connectedProviders);

            if (view === "list") {
              return (
                <Link key={workflow.id} href={`/workflows/${workflow.id}`}>
                  <Card className="transition-colors hover:border-primary/40">
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{workflow.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {workflow.description}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {workflow.members.length} agent
                          {workflow.members.length === 1 ? "" : "s"}
                        </span>
                        <Badge variant="outline">{workflow.trigger}</Badge>
                        <AgentStatusBadge status={workflow.status} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            }

            return (
              <Card key={workflow.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/workflows/${workflow.id}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <CardTitle className="text-base">
                        {workflow.name}
                      </CardTitle>
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          workflow.source === "TEMPLATE"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {workflow.source === "TEMPLATE" ? "Template" : "Custom"}
                      </Badge>
                      <Badge variant="outline">{workflow.trigger}</Badge>
                      <AgentStatusBadge status={workflow.status} />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {workflow.description}
                  </p>
                  {warnings.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 p-2">
                      {warnings.map((warning) => (
                        <p key={warning} className="text-xs text-destructive">
                          Warning: {warning}
                        </p>
                      ))}
                    </div>
                  )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
