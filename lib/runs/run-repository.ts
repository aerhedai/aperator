import { prisma } from "@/lib/db/prisma";
import type {
  Prisma,
  RunStatus,
  RunStepType,
} from "@/lib/generated/prisma/client";

export function createRun(
  organisationId: string,
  agentId: string,
  input: string,
) {
  return prisma.agentRun.create({
    data: { organisationId, agentId, input, status: "PENDING" },
  });
}

export function markRunStatus(
  runId: string,
  status: RunStatus,
  timestamps: { startedAt?: Date; completedAt?: Date } = {},
) {
  return prisma.agentRun.update({
    where: { id: runId },
    data: { status, ...timestamps },
  });
}

export function addRunStep(
  runId: string,
  stepType: RunStepType,
  detail?: string,
  toolCallId?: string,
  usage?: { promptTokens: number; completionTokens: number },
) {
  return prisma.runStep.create({
    data: {
      agentRunId: runId,
      stepType,
      detail,
      toolCallId,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    },
  });
}

export function createToolCall(
  runId: string,
  toolName: string,
  input: Record<string, unknown>,
  output: Record<string, unknown> | undefined,
  status: "SUCCESS" | "FAILED",
  error?: string,
) {
  return prisma.toolCall.create({
    data: {
      agentRunId: runId,
      toolName,
      input: input as Prisma.InputJsonValue,
      output: output as Prisma.InputJsonValue | undefined,
      status,
      error,
    },
  });
}

export function saveMessages(runId: string, messages: Prisma.InputJsonValue) {
  return prisma.agentRun.update({
    where: { id: runId },
    data: { messages },
  });
}

export function findRunById(organisationId: string, runId: string) {
  return prisma.agentRun.findFirst({
    where: { id: runId, organisationId },
    include: {
      agent: true,
      steps: { orderBy: { createdAt: "asc" }, include: { toolCall: true } },
    },
  });
}

export function findRunsByAgent(organisationId: string, agentId: string) {
  return prisma.agentRun.findMany({
    where: { organisationId, agentId },
    orderBy: { createdAt: "desc" },
  });
}

export function findRunsByAgentIds(
  organisationId: string,
  agentIds: string[],
  take: number,
) {
  return prisma.agentRun.findMany({
    where: { organisationId, agentId: { in: agentIds } },
    orderBy: { createdAt: "desc" },
    take,
    include: { agent: { select: { name: true } } },
  });
}

// Org-wide, every agent — the data behind /runs, the "highly detailed"
// counterpart to the dashboard's single summary number. Paginated rather
// than a fixed take like the other list functions here: this is the one
// place meant to show *all* runs, not a recent-N preview on another
// page, so it has to scale past however many runs an org accumulates.
export interface RunFilters {
  status?: RunStatus;
  agentId?: string;
  // Matched against input only — the field a business actually recognizes
  // (what was sent in), not an internal id a human wouldn't type.
  q?: string;
}

function runFiltersWhere(organisationId: string, filters: RunFilters = {}) {
  return {
    organisationId,
    ...(filters.status && { status: filters.status }),
    ...(filters.agentId && { agentId: filters.agentId }),
    ...(filters.q && {
      input: { contains: filters.q, mode: "insensitive" as const },
    }),
  };
}

export function findRunsByOrganisation(
  organisationId: string,
  { skip, take }: { skip: number; take: number },
  filters: RunFilters = {},
) {
  return prisma.agentRun.findMany({
    where: runFiltersWhere(organisationId, filters),
    orderBy: { createdAt: "desc" },
    skip,
    take,
    include: { agent: { select: { name: true } } },
  });
}

export function countRunsByOrganisation(
  organisationId: string,
  filters: RunFilters = {},
) {
  return prisma.agentRun.count({
    where: runFiltersWhere(organisationId, filters),
  });
}

// Per-run token totals for a page of runs — a groupBy aggregate, not
// fetching every RunStep's full content just to sum two columns.
export async function sumTokensByRunIds(runIds: string[]) {
  const rows = await prisma.runStep.groupBy({
    by: ["agentRunId"],
    where: { agentRunId: { in: runIds } },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return new Map(
    rows.map((row) => [
      row.agentRunId,
      {
        promptTokens: row._sum.promptTokens ?? 0,
        completionTokens: row._sum.completionTokens ?? 0,
      },
    ]),
  );
}

// The dashboard's one summary number — total tokens across every run this
// organisation has ever had, computed as a single DB aggregate rather
// than summed in application code over however many runs exist.
export async function sumAllTokensForOrganisation(organisationId: string) {
  const result = await prisma.runStep.aggregate({
    where: { agentRun: { organisationId } },
    _sum: { promptTokens: true, completionTokens: true },
  });
  return {
    promptTokens: result._sum.promptTokens ?? 0,
    completionTokens: result._sum.completionTokens ?? 0,
  };
}
