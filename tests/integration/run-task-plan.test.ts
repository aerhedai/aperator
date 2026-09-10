import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { runTaskPlan } from "@/lib/tasks/run-task-plan";
import * as taskRepository from "@/lib/tasks/task-repository";

// run-task-plan.ts is what both create_task (immediately) and the cron
// sweep (later, on a schedule) call to actually execute a Task/Routine's
// stored plan — these tests exercise it directly, independent of either
// caller, so a bug here is caught once rather than twice.

function scriptedProvider(responses: AIResponse[]): AIProvider {
  let call = 0;
  return {
    generateResponse: async () => {
      const response = responses[call];
      call += 1;
      if (!response) throw new Error("scriptedProvider ran out of responses");
      return response;
    },
  };
}

describe("runTaskPlan", () => {
  const organisationId = "test-org-run-task-plan";
  let draftAgent: Agent;
  let postAgent: Agent;
  let emailAgent: Agent;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Run Task Plan Test Org",
      },
    });

    draftAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Drafter",
        description: "Drafts things.",
        instructions: "Draft what's asked.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

    postAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Poster",
        description: "Posts things.",
        instructions: "Post what's asked.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

    emailAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Emailer",
        description: "Sends email, always approval-gated.",
        instructions: "Send email when asked.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    await prisma.agentTool.create({
      data: { agentId: emailAgent.id, toolName: "GMAIL_SEND_EMAIL" },
    });
  });

  afterAll(async () => {
    const runs = await prisma.agentRun.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    await prisma.approval.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.toolCall.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { agentRunId: { in: runIds } } });
    const taskRuns = await prisma.taskRun.findMany({
      where: { task: { organisationId } },
      select: { id: true },
    });
    await prisma.agentRun.updateMany({
      where: { taskRunId: { in: taskRuns.map((t) => t.id) } },
      data: { taskRunId: null },
    });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.taskRun.deleteMany({ where: { task: { organisationId } } });
    await prisma.task.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("runs a two-step plan in order, threading step 0's response into step 1's input", async () => {
    const task = await taskRepository.createTask(
      organisationId,
      "Draft then post",
      "Draft a summary, then post it.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: draftAgent.id,
            instructionTemplate: "Draft a summary",
          },
          {
            targetType: "agent",
            targetId: postAgent.id,
            instructionTemplate: "Post this: {{steps.0.response}}",
          },
        ],
      },
      null,
    );

    const provider = scriptedProvider([
      { content: "Draft: sales are up." },
      { content: "Posted." },
    ]);

    const result = await runTaskPlan(organisationId, task, provider);
    expect(result.status).toBe("completed");

    const taskRun = await taskRepository.findTaskRunById(result.taskRunId);
    expect(taskRun?.status).toBe("COMPLETED");
    expect(taskRun?.agentRuns).toHaveLength(2);

    const [step0, step1] = taskRun!.agentRuns.sort(
      (a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0),
    );
    expect(step0).toMatchObject({ agentId: draftAgent.id, stepIndex: 0 });
    expect(step1).toMatchObject({
      agentId: postAgent.id,
      stepIndex: 1,
      input: "Post this: Draft: sales are up.",
    });

    const updatedTask = await taskRepository.findTaskById(
      organisationId,
      task.id,
    );
    expect(updatedTask?.status).toBe("COMPLETED");
  });

  it("stops the plan and leaves the TaskRun WAITING_FOR_APPROVAL when a step pauses for approval", async () => {
    const task = await taskRepository.createTask(
      organisationId,
      "Email something",
      "Send an email.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: emailAgent.id,
            instructionTemplate: "Email customer@example.test saying hello",
          },
          {
            targetType: "agent",
            targetId: postAgent.id,
            instructionTemplate: "This should never run",
          },
        ],
      },
      null,
    );

    const provider = scriptedProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "call_0",
            name: "GMAIL_SEND_EMAIL",
            arguments: {
              to: "customer@example.test",
              subject: "Hello",
              body: "Hi there.",
            },
          },
        ],
      },
    ]);

    const result = await runTaskPlan(organisationId, task, provider);
    expect(result.status).toBe("waiting_for_approval");

    const taskRun = await taskRepository.findTaskRunById(result.taskRunId);
    expect(taskRun?.status).toBe("WAITING_FOR_APPROVAL");
    // Only the paused first step ever ran — the second step must not have
    // been reached.
    expect(taskRun?.agentRuns).toHaveLength(1);

    const postRuns = await prisma.agentRun.count({
      where: { agentId: postAgent.id, taskRunId: result.taskRunId },
    });
    expect(postRuns).toBe(0);
  });

  it("a Routine's Task status stays ACTIVE regardless of how a firing went", async () => {
    const task = await taskRepository.createTask(
      organisationId,
      "Daily summary",
      "Post a daily summary.",
      {
        steps: [
          {
            targetType: "agent",
            targetId: postAgent.id,
            instructionTemplate: "Post the daily summary",
          },
        ],
      },
      "DAILY_9AM",
    );
    expect(task.status).toBe("ACTIVE");

    const provider = scriptedProvider([{ content: "Posted." }]);
    await runTaskPlan(organisationId, task, provider);

    const updatedTask = await taskRepository.findTaskById(
      organisationId,
      task.id,
    );
    expect(updatedTask?.status).toBe("ACTIVE");
  });
});
