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
    vi.useRealTimers();
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
    // The real route reads the wall clock (new Date()) internally, so the
    // clock is frozen at a time DAILY_9AM is actually due — otherwise this
    // test would only pass if it happened to run during the 9am UTC hour.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T09:00:00Z"));

    const dueRoutine = await taskRepository.createTask(
      organisationId,
      "Due routine",
      "Runs every day.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: agent.id,
            instructionTemplate: "Say hello",
          },
        ],
      },
      "DAILY_9AM",
    );

    const pausedRoutine = await taskRepository.createTask(
      organisationId,
      "Paused routine",
      "Also runs every day, but paused.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: agent.id,
            instructionTemplate: "Should never run",
          },
        ],
      },
      "DAILY_9AM",
    );
    await taskRepository.updateTaskStatus(pausedRoutine.id, "PAUSED");

    const request = new Request("http://localhost/api/cron/run-due-tasks");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      tasks: { results: { taskId: string; fired: boolean }[] };
    };

    const dueResult = body.tasks.results.find(
      (r) => r.taskId === dueRoutine.id,
    );
    expect(dueResult?.fired).toBe(true);

    const pausedResult = body.tasks.results.find(
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

  it("fires an ACTIVE SCHEDULE workflow whose preset is due, dispatching through the same classify path a real trigger uses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T09:00:00Z"));

    const classifier = await prisma.agent.create({
      data: {
        organisationId,
        name: "Scheduled Classifier",
        description: "Decides what needs doing.",
        instructions: "Decide which worker should handle this.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const handler = await prisma.agent.create({
      data: {
        organisationId,
        name: "Scheduled Handler",
        description: "Does the actual check.",
        instructions: "Check state and act.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const workflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Scheduled Department",
        description: "Checks something daily.",
        trigger: "SCHEDULE",
        status: "ACTIVE",
        schedulePreset: "DAILY_9AM",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: workflow.id, agentId: classifier.id, role: "CLASSIFIER" },
        { workflowId: workflow.id, agentId: handler.id, role: "HANDLER" },
      ],
    });

    try {
      const request = new Request("http://localhost/api/cron/run-due-tasks");
      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        workflows: {
          results: { workflowId: string; fired: boolean; matched?: boolean }[];
        };
      };
      const result = body.workflows.results.find(
        (r) => r.workflowId === workflow.id,
      );
      expect(result).toMatchObject({ fired: true, matched: true });

      const updated = await prisma.workflow.findUniqueOrThrow({
        where: { id: workflow.id },
      });
      expect(updated.lastScheduledFireAt).not.toBeNull();
    } finally {
      await prisma.workflowAgent.deleteMany({
        where: { workflowId: workflow.id },
      });
      await prisma.workflow.deleteMany({ where: { id: workflow.id } });
    }
  });

  it("does not re-fire a SCHEDULE workflow already fired today", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T09:00:00Z"));

    const classifier = await prisma.agent.create({
      data: {
        organisationId,
        name: "Already Fired Classifier",
        description: "Decides what needs doing.",
        instructions: "Decide which worker should handle this.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const handler = await prisma.agent.create({
      data: {
        organisationId,
        name: "Already Fired Handler",
        description: "Does the actual check.",
        instructions: "Check state and act.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    const workflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Already Fired Department",
        description: "Checks something daily.",
        trigger: "SCHEDULE",
        status: "ACTIVE",
        schedulePreset: "DAILY_9AM",
        lastScheduledFireAt: new Date("2026-09-14T09:00:00Z"),
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        { workflowId: workflow.id, agentId: classifier.id, role: "CLASSIFIER" },
        { workflowId: workflow.id, agentId: handler.id, role: "HANDLER" },
      ],
    });

    try {
      const request = new Request("http://localhost/api/cron/run-due-tasks");
      const response = await GET(request);

      const body = (await response.json()) as {
        workflows: { results: { workflowId: string; fired: boolean }[] };
      };
      const result = body.workflows.results.find(
        (r) => r.workflowId === workflow.id,
      );
      expect(result).toEqual({ workflowId: workflow.id, fired: false });
    } finally {
      await prisma.workflowAgent.deleteMany({
        where: { workflowId: workflow.id },
      });
      await prisma.workflow.deleteMany({ where: { id: workflow.id } });
    }
  });
});
