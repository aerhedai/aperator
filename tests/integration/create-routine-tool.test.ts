import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { createMcpServer } from "@/lib/mcp/server";

// create_routine persists a plan and a schedule but never executes it
// itself — the cron sweep does that later. These tests check exactly that
// boundary: a Task row is created, ACTIVE, with no TaskRun yet.

describe("create_routine tool", () => {
  const organisationId = "test-org-create-routine";
  let chatAgent: Agent;
  let targetAgent: Agent;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Create Routine Test Org",
      },
    });

    chatAgent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Assistant",
        description: "Chat assistant.",
        instructions: "Help.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "CHAT",
      },
    });

    targetAgent = await prisma.agent.create({
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

  afterAll(async () => {
    await prisma.taskRun.deleteMany({ where: { task: { organisationId } } });
    await prisma.task.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  async function connectClient() {
    const server = await createMcpServer(
      organisationId,
      undefined,
      chatAgent.id,
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    return client;
  }

  it("persists an ACTIVE routine with no TaskRun yet — it doesn't execute at creation time", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "create_routine",
      arguments: {
        title: "Weekly summary",
        instruction: "Post a weekly summary every Monday.",
        schedulePreset: "WEEKLY_MONDAY_9AM",
        steps: [
          {
            targetType: "agent",
            targetId: targetAgent.id,
            instructionTemplate: "Post the weekly summary",
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent as {
      taskId: string;
      schedulePreset: string;
    };
    expect(output.schedulePreset).toBe("WEEKLY_MONDAY_9AM");

    const task = await prisma.task.findUnique({
      where: { id: output.taskId },
      include: { runs: true },
    });
    expect(task).toMatchObject({
      status: "ACTIVE",
      schedulePreset: "WEEKLY_MONDAY_9AM",
    });
    expect(task?.runs).toHaveLength(0);

    await client.close();
  });

  it("rejects a step targeting a workflow that isn't currently active", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "create_routine",
      arguments: {
        title: "Bad routine",
        instruction: "Target a nonexistent workflow.",
        schedulePreset: "DAILY_9AM",
        steps: [
          {
            targetType: "workflow",
            targetId: "does-not-exist",
            instructionTemplate: "Do it",
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("not a currently invokable workflow"),
      },
    ]);

    await client.close();
  });
});
