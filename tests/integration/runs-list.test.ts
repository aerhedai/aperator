import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import * as runService from "@/lib/runs/run-service";

describe("listRunsForOrganisation", () => {
  const organisationId = "test-org-runs-list";
  let agentId: string;
  let otherAgentId: string;
  const runIds: string[] = [];

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Runs List Org",
      },
    });
    const agent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Test Agent",
        description: "d",
        instructions: "i",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    agentId = agent.id;
    const otherAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Other Agent",
        description: "d",
        instructions: "i",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    otherAgentId = otherAgent.id;

    // 3 runs, decreasing tokens, so ordering + aggregation are both
    // provably correct rather than accidentally right on symmetric data.
    for (const [promptTokens, completionTokens] of [
      [300, 100],
      [200, 50],
      [100, 25],
    ]) {
      const run = await prisma.agentRun.create({
        data: { organisationId, agentId, input: "test", status: "COMPLETED" },
      });
      runIds.push(run.id);
      await prisma.runStep.create({
        data: {
          agentRunId: run.id,
          stepType: "AGENT_DECISION",
          detail: "x",
          promptTokens,
          completionTokens,
        },
      });
      // A second LLM-backed step on the same run, to prove per-run
      // summing across multiple steps, not just reading the first one.
      await prisma.runStep.create({
        data: {
          agentRunId: run.id,
          stepType: "AGENT_DECISION",
          detail: "y",
          promptTokens: 10,
          completionTokens: 5,
        },
      });
    }

    // One more run, on the other agent, FAILED, with a distinctive input —
    // the target for the filter tests below (status/agentId/q).
    const failedRun = await prisma.agentRun.create({
      data: {
        organisationId,
        agentId: otherAgentId,
        input: "Quote request from Acme Widget Co",
        status: "FAILED",
      },
    });
    runIds.push(failedRun.id);
  });

  afterAll(async () => {
    await prisma.toolCall.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.customEntityType.deleteMany({
      where: { organisationId: organisationId },
    });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("sums tokens across every step of a run, per run, not just the first step", async () => {
    // Scoped to this agent's 3 runs specifically — the org also has a 4th,
    // unrelated run (on a different agent) added for the filter tests below.
    const result = await runService.listRunsForOrganisation(organisationId, 1, {
      agentId,
    });

    expect(result.totalCount).toBe(3);
    // Most recent first — the third run created has the smallest token
    // counts (100+10 prompt, 25+5 completion).
    expect(result.runs[0]).toMatchObject({
      promptTokens: 110,
      completionTokens: 30,
    });
    expect(result.runs[2]).toMatchObject({
      promptTokens: 310,
      completionTokens: 105,
    });
  });

  it("includes the agent name for display without a separate lookup", async () => {
    const result = await runService.listRunsForOrganisation(organisationId, 1, {
      agentId,
    });
    expect(result.runs.every((r) => r.agentName === "Test Agent")).toBe(true);
  });

  it("filters by status", async () => {
    const result = await runService.listRunsForOrganisation(organisationId, 1, {
      status: "FAILED",
    });
    expect(result.totalCount).toBe(1);
    expect(result.runs[0]?.status).toBe("FAILED");
  });

  it("filters by agent", async () => {
    const result = await runService.listRunsForOrganisation(organisationId, 1, {
      agentId: otherAgentId,
    });
    expect(result.totalCount).toBe(1);
    expect(result.runs[0]?.agentName).toBe("Other Agent");
  });

  it("filters by a case-insensitive match on the run's input", async () => {
    const result = await runService.listRunsForOrganisation(organisationId, 1, {
      q: "acme widget",
    });
    expect(result.totalCount).toBe(1);
    expect(result.runs[0]?.input).toContain("Acme Widget");
  });

  it("combining filters that match nothing returns an empty page, not an error", async () => {
    const result = await runService.listRunsForOrganisation(organisationId, 1, {
      status: "COMPLETED",
      agentId: otherAgentId,
    });
    expect(result.totalCount).toBe(0);
    expect(result.runs).toHaveLength(0);
  });
});
