import Link from "next/link";

import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import * as agentService from "@/lib/agents/agent-service";
import type { RunStatus } from "@/lib/generated/prisma/client";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";
import * as runService from "@/lib/runs/run-service";

export const dynamic = "force-dynamic";

const RUN_STATUSES: RunStatus[] = [
  "PENDING",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "WAITING_FOR_INPUT",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

function formatTokens(promptTokens: number, completionTokens: number): string {
  const total = promptTokens + completionTokens;
  if (total === 0) return "—";
  return `${total.toLocaleString()} (${promptTokens.toLocaleString()} + ${completionTokens.toLocaleString()})`;
}

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  const {
    page: pageParam,
    status: statusParam,
    agentId: agentIdParam,
    q: qParam,
  } = await searchParams;
  const page = typeof pageParam === "string" ? parseInt(pageParam, 10) || 1 : 1;
  const status =
    typeof statusParam === "string" &&
    RUN_STATUSES.includes(statusParam as RunStatus)
      ? (statusParam as RunStatus)
      : undefined;
  const agentId = typeof agentIdParam === "string" ? agentIdParam : undefined;
  const q = typeof qParam === "string" ? qParam : undefined;

  const organisation = await getCurrentOrganisation();
  const [{ runs, totalCount, totalPages }, agents] = await Promise.all([
    runService.listRunsForOrganisation(organisation.id, page, {
      status,
      agentId,
      q,
    }),
    agentService.listAgents(organisation.id),
  ]);

  // Pagination links need to carry the active filters forward, or clicking
  // "Next" would silently drop them back to an unfiltered view.
  const filterParams = new URLSearchParams();
  if (status) filterParams.set("status", status);
  if (agentId) filterParams.set("agentId", agentId);
  if (q) filterParams.set("q", q);
  const filterQuery = filterParams.toString();
  const pageHref = (targetPage: number) =>
    `/runs?${new URLSearchParams({ ...Object.fromEntries(filterParams), page: String(targetPage) })}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Every run across every worker in this organisation, most recent
            first — {totalCount.toLocaleString()} total.
          </p>
        </div>
      </div>

      <form
        action="/runs"
        className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3"
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-xs text-muted-foreground">
            Search input
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="e.g. Acme Widget"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">Any status</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="agentId" className="text-xs text-muted-foreground">
            Worker
          </label>
          <select
            id="agentId"
            name="agentId"
            defaultValue={agentId ?? ""}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          >
            <option value="">Any worker</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filterQuery && (
          <Link
            href="/runs"
            className="text-sm text-muted-foreground hover:underline"
          >
            Clear
          </Link>
        )}
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            All activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No activity yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Activity</th>
                    <th className="px-4 py-2 font-medium">Worker</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Input</th>
                    <th className="px-4 py-2 font-medium">
                      Tokens (prompt + completion)
                    </th>
                    <th className="px-4 py-2 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-4 py-2">
                        <Link
                          href={`/runs/${run.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          #{run.id.slice(-8)}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/agents/${run.agentId}`}
                          className="hover:underline"
                        >
                          {run.agentName}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <RunStatusBadge status={run.status} />
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 text-muted-foreground">
                        {run.input}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums">
                        {formatTokens(run.promptTokens, run.completionTokens)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                        {run.createdAt.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Link href={pageHref(Math.max(1, page - 1))}>
              <Button type="button" variant="outline" disabled={page <= 1}>
                Previous
              </Button>
            </Link>
            <Link href={pageHref(Math.min(totalPages, page + 1))}>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
              >
                Next
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
