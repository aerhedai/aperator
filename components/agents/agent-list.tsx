"use client";

import { LayoutGrid, List, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useStoredView } from "@/lib/hooks/use-stored-view";
import { cn } from "@/lib/utils";
import type * as agentService from "@/lib/agents/agent-service";

type Agent = Awaited<ReturnType<typeof agentService.listAgents>>[number];

const VIEWS = ["list", "tile"] as const;
const VIEW_STORAGE_KEY = "aperator-agents-view";

export function AgentList({ agents }: { agents: Agent[] }) {
  const [query, setQuery] = useState("");
  const [view, changeView] = useStoredView(VIEW_STORAGE_KEY, "list", VIEWS);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q),
    );
  }, [agents, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search workers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
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
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query
            ? "No workers match your search."
            : "No workers yet. Create one to get started."}
        </p>
      ) : view === "list" ? (
        <div className="flex flex-col gap-3">
          {filtered.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{agent.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {agent.description}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      {agent._count.runs}{" "}
                      {agent._count.runs === 1 ? "activity" : "activities"}
                    </span>
                    <AgentStatusBadge status={agent.status} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="flex h-full flex-col gap-3 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{agent.name}</span>
                    <AgentStatusBadge status={agent.status} />
                  </div>
                  <p className="flex-1 text-sm text-muted-foreground">
                    {agent.description}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {agent._count.runs}{" "}
                    {agent._count.runs === 1 ? "activity" : "activities"}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
