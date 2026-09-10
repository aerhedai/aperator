import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import * as taskRepository from "@/lib/tasks/task-repository";

// The cron sweep is what turns a persisted schedulePreset into an actual
// firing — these tests exercise the real route handler (not just
// isPresetDue/runTaskPlan in isolation) so the wiring between "find due
// routines" and "execute them" is covered too.
//
// getAIProvider is mocked rather than given a real Ollama/Gemini
// Integration fixture: the route resolves it itself (not injectable the
// way runTaskPlan's own `provider` parameter is), and a real one would
// mean this test making an actual network call to an LLM.
vi.mock("@/lib/ai/organisation-ai-provider", () => ({
  getAIProvider: async () => ({
    generateResponse: async () => ({ content: "Hello!" }),
  }),
}));

const { GET } = await import("@/app/api/cron/run-due-tasks/route");

describe("GET /api/cron/run-due-tasks", () => {
  const organisationId = "test-org-run-due-tasks-cron";
  let agent: Agent;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Cron Test Org",
      },
    });
    agent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Worker",
        description: "Does work.",
        instructions: "Do what's asked.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    const taskRuns = await prisma.taskRun.findMany({
      where: { task: { organisationId } },
      select: { id: true },
    });
    await prisma.agentRun.updateMany({
      where: { taskRunId: { in: taskRuns.map((t) => t.id) } },
      data: { taskRunId: null },
    });
    const runs = await prisma.agentRun.findMany({
      where: { organisationId },
      select: { id: true },
    });
    await prisma.runStep.deleteMany({
      where: { agentRunId: { in: runs.map((r) => r.id) } },
    });
    await prisma.toolCall.deleteMany({
      where: { agentRunId: { in: runs.map((r) => r.id) } },
    });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.taskRun.deleteMany({ where: { task: { organisationId } } });
    await prisma.task.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("rejects a request with the wrong bearer secret when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "the-real-secret");

    const request = new Request("http://localhost/api/cron/run-due-tasks", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("accepts any request when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");

    const request = new Request("http://localhost/api/cron/run-due-tasks");
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it("fires an ACTIVE routine whose preset is due, and leaves an inactive/paused one alone", async () => {
    // HOURLY with no prior run is always due, regardless of current time —
    // avoids this test being sensitive to when it happens to run.
    const dueRoutine = await taskRepository.createTask(
      organisationId,
      "Due routine",
      "Runs every hour.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: agent.id,
            instructionTemplate: "Say hello",
          },
        ],
      },
      "HOURLY",
    );

    const pausedRoutine = await taskRepository.createTask(
      organisationId,
      "Paused routine",
      "Also runs every hour, but paused.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: agent.id,
            instructionTemplate: "Should never run",
          },
        ],
      },
      "HOURLY",
    );
    await taskRepository.updateTaskStatus(pausedRoutine.id, "PAUSED");

    const request = new Request("http://localhost/api/cron/run-due-tasks");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      checked: number;
      fired: number;
      results: { taskId: string; fired: boolean }[];
    };

    const dueResult = body.results.find((r) => r.taskId === dueRoutine.id);
    expect(dueResult?.fired).toBe(true);

    const pausedResult = body.results.find(
      (r) => r.taskId === pausedRoutine.id,
    );
    expect(pausedResult).toBeUndefined();

    const dueRuns = await prisma.taskRun.count({
      where: { taskId: dueRoutine.id },
    });
    expect(dueRuns).toBe(1);

    const pausedRuns = await prisma.taskRun.count({
      where: { taskId: pausedRoutine.id },
    });
    expect(pausedRuns).toBe(0);
  });
});
