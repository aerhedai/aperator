import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { createMcpServer } from "@/lib/mcp/server";

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

// create_task is chat's entry point for a trackable, possibly multi-step
// piece of work — these tests exercise it through the real MCP surface
// (like invoke-agent-tool.test.ts does for invoke_agent) rather than
// calling the tool factory directly, so the grant-check/registration path
// is covered too.

describe("create_task tool", () => {
  const organisationId = "test-org-create-task";
  let chatAgent: Agent;
  let targetAgent: Agent;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Create Task Test Org",
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
    await prisma.toolCall.deleteMany({
      where: { agentRunId: { in: runs.map((r) => r.id) } },
    });
    await prisma.runStep.deleteMany({
      where: { agentRunId: { in: runs.map((r) => r.id) } },
    });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.taskRun.deleteMany({ where: { task: { organisationId } } });
    await prisma.task.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  async function connectClient(provider?: AIProvider) {
    const server = await createMcpServer(
      organisationId,
      undefined,
      chatAgent.id,
      0,
      provider,
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

  it("creates and runs a one-step task, returning a real taskId and taskRunId", async () => {
    const client = await connectClient(
      scriptedProvider([{ content: "Hello!" }]),
    );

    const result = await client.callTool({
      name: "create_task",
      arguments: {
        title: "Say hello",
        instruction: "Ask the worker to say hello.",
        steps: [
          {
            targetType: "agent",
            targetId: targetAgent.id,
            instructionTemplate: "Say hello",
          },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    const output = result.structuredContent as {
      taskId: string;
      taskRunId: string;
      status: string;
    };
    expect(output.status).toBe("completed");

    const task = await prisma.task.findUnique({ where: { id: output.taskId } });
    expect(task).toMatchObject({
      title: "Say hello",
      status: "COMPLETED",
      schedulePreset: null,
    });

    await client.close();
  });

  it("rejects a step targeting an agent that isn't currently invokable", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "create_task",
      arguments: {
        title: "Bad task",
        instruction: "Target something that doesn't exist.",
        steps: [
          {
            targetType: "agent",
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
        text: expect.stringContaining("not a currently invokable agent"),
      },
    ]);

    await client.close();
  });

  it("rejects a plan step referencing a later step's result", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "create_task",
      arguments: {
        title: "Bad reference",
        instruction: "Reference the future.",
        steps: [
          {
            targetType: "agent",
            targetId: targetAgent.id,
            instructionTemplate: "Use {{steps.1.response}}",
          },
          {
            targetType: "agent",
            targetId: targetAgent.id,
            instructionTemplate: "Do it",
          },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("hasn't run yet"),
      },
    ]);

    await client.close();
  });
});
