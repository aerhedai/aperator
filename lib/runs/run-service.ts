import type { RunStatus } from "@/lib/generated/prisma/client";
import * as runRepository from "@/lib/runs/run-repository";

export function getRun(organisationId: string, runId: string) {
  return runRepository.findRunById(organisationId, runId);
}

export function listRunsForAgent(organisationId: string, agentId: string) {
  return runRepository.findRunsByAgent(organisationId, agentId);
}

export function listRunsForAgents(
  organisationId: string,
  agentIds: string[],
  take = 10,
) {
  return runRepository.findRunsByAgentIds(organisationId, agentIds, take);
}

const RUNS_PAGE_SIZE = 25;

export interface RunWithTokens {
  id: string;
  agentId: string;
  agentName: string;
  status: RunStatus;
  input: string;
  createdAt: Date;
  completedAt: Date | null;
  promptTokens: number;
  completionTokens: number;
}

export interface RunsPage {
  runs: RunWithTokens[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

/**
 * The org-wide, paginated "all runs" view behind /runs — merges each
 * run's token totals in via a single groupBy aggregate
 * (sumTokensByRunIds), not an N+1 fetch of every run's full step history.
 */
export async function listRunsForOrganisation(
  organisationId: string,
  page = 1,
  filters: runRepository.RunFilters = {},
): Promise<RunsPage> {
  const safePage = Math.max(1, page);
  const [runs, totalCount] = await Promise.all([
    runRepository.findRunsByOrganisation(
      organisationId,
      { skip: (safePage - 1) * RUNS_PAGE_SIZE, take: RUNS_PAGE_SIZE },
      filters,
    ),
    runRepository.countRunsByOrganisation(organisationId, filters),
  ]);

  const tokenTotals = await runRepository.sumTokensByRunIds(
    runs.map((r) => r.id),
  );

  return {
    runs: runs.map((run) => {
      const tokens = tokenTotals.get(run.id);
      return {
        id: run.id,
        agentId: run.agentId,
        agentName: run.agent.name,
        status: run.status,
        input: run.input,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        promptTokens: tokens?.promptTokens ?? 0,
        completionTokens: tokens?.completionTokens ?? 0,
      };
    }),
    page: safePage,
    pageSize: RUNS_PAGE_SIZE,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / RUNS_PAGE_SIZE)),
  };
}
