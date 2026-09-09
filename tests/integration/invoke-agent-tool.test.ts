import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import { createMcpServer } from "@/lib/mcp/server";
import { runAgent } from "@/lib/runtime/agent-runtime";

// Proves invoke_agent's own contract, most importantly the one that
// matters most (CLAUDE.md's non-negotiable): an invoked agent still goes
// through the exact same grant-checking and policy-gating any top-level
// run does. Delegation must never be a way to bypass either.

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

describe("invoke_agent tool", () => {
  const organisationId = "test-org-invoke-agent";
  let orchestrator: Agent;
  let excludedTarget: Agent;
  let grantedTarget: Agent;
  let sendEmailTarget: Agent;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Invoke Agent Test Org",
      },
    });

    orchestrator = await prisma.agent.create({
      data: {
        organisationId,
        name: "Orchestrator",
        description: "Delegates to other agents.",
        instructions: "Delegate tasks to other agents when useful.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    await prisma.agentTool.create({
      data: { agentId: orchestrator.id, toolName: "invoke_agent" },
    });

    // Explicitly excluded — Agent.chatInvokable defaults to true, so this
    // is the one target that has to opt *out* to prove the deny path still
    // works under the new default-allow model.
    excludedTarget = await prisma.agent.create({
      data: {
        organisationId,
        name: "Excluded Target",
        description: "Explicitly excluded from invocation.",
        instructions: "n/a",
        model: "test-model",
        status: "ACTIVE",
        chatInvokable: false,
      },
    });

    // No explicit grant needed any more — chatInvokable defaults to true,
    // so this agent is invokable the moment it exists.
    grantedTarget = await prisma.agent.create({
      data: {
        organisationId,
        name: "Granted Target",
        description: "Invokable by default.",
        instructions: "Answer briefly.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

    sendEmailTarget = await prisma.agent.create({
      data: {
        organisationId,
        name: "Send Email Target",
        description:
          "Has its own GMAIL_SEND_EMAIL grant, always approval-gated.",
        instructions: "Send emails when asked.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    await prisma.agentTool.create({
      data: { agentId: sendEmailTarget.id, toolName: "GMAIL_SEND_EMAIL" },
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
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("denies invoking an agent explicitly excluded from invocation, without ever running it", async () => {
    const provider = scriptedProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "call_0",
            name: "invoke_agent",
            arguments: { agentId: excludedTarget.id, input: "Do something" },
          },
        ],
      },
      { content: "I wasn't able to delegate that." },
    ]);

    const result = await runAgent(
      orchestrator,
      "Ask the excluded agent",
      provider,
    );

    expect(result.status).toBe("COMPLETED");

    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId },
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolName: "invoke_agent",
      status: "FAILED",
    });
    expect(toolCalls[0]?.error).toMatch(/may currently invoke/i);

    const targetRuns = await prisma.agentRun.count({
      where: { agentId: excludedTarget.id },
    });
    expect(targetRuns).toBe(0);
  });

  it("invokes an agent (invokable by default) and surfaces its final reply", async () => {
    const provider = scriptedProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "call_0",
            name: "invoke_agent",
            arguments: { agentId: grantedTarget.id, input: "What is 2 + 2?" },
          },
        ],
      },
      // Consumed by the invoked target's own nested run.
      { content: "It's 4." },
      // Consumed by the orchestrator's next turn, after seeing the result.
      { content: "The other agent says it's 4." },
    ]);

    const result = await runAgent(
      orchestrator,
      "Ask the granted agent",
      provider,
    );

    expect(result.status).toBe("COMPLETED");

    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId },
    });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      toolName: "invoke_agent",
      status: "SUCCESS",
    });
    expect(toolCalls[0]?.output).toMatchObject({
      status: "completed",
      response: "It's 4.",
    });

    const targetRun = await prisma.agentRun.findFirst({
      where: { agentId: grantedTarget.id },
    });
    expect(targetRun).toMatchObject({
      status: "COMPLETED",
      input: "What is 2 + 2?",
    });
  });

  it("the invoked agent's own tool grants and policy still apply — GMAIL_SEND_EMAIL still pauses for approval, never executes", async () => {
    const provider = scriptedProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "call_0",
            name: "invoke_agent",
            arguments: {
              agentId: sendEmailTarget.id,
              input: "Email customer@example.test saying hello",
            },
          },
        ],
      },
      // Consumed by the invoked target's own nested run — it asks to send
      // an email, exactly like it would if triggered directly.
      {
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "GMAIL_SEND_EMAIL",
            arguments: {
              to: "customer@example.test",
              subject: "Hello",
              body: "Hello there.",
            },
          },
        ],
      },
      // Consumed by the orchestrator's next turn.
      { content: "That email needs approval before it sends." },
    ]);

    const result = await runAgent(
      orchestrator,
      "Ask the email agent",
      provider,
    );

    expect(result.status).toBe("COMPLETED");

    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId },
    });
    expect(toolCalls[0]).toMatchObject({
      toolName: "invoke_agent",
      status: "SUCCESS",
    });
    expect(toolCalls[0]?.output).toMatchObject({
      status: "waiting_for_approval",
    });

    const targetRun = await prisma.agentRun.findFirst({
      where: { agentId: sendEmailTarget.id },
    });
    expect(targetRun?.status).toBe("WAITING_FOR_APPROVAL");

    // Delegation must not be a way around the gate — GMAIL_SEND_EMAIL must never
    // have actually executed, exactly as if this run had been triggered
    // directly rather than via invoke_agent.
    const sendEmailCalls = await prisma.toolCall.findMany({
      where: { agentRunId: targetRun?.id, toolName: "GMAIL_SEND_EMAIL" },
    });
    expect(sendEmailCalls).toHaveLength(0);

    const approval = await prisma.approval.findFirst({
      where: { agentRunId: targetRun?.id },
    });
    expect(approval).toMatchObject({
      status: "PENDING",
      requestedAction: "GMAIL_SEND_EMAIL",
    });
  });

  it("refuses to invoke past the maximum invocation depth without running anything", async () => {
    const runsBefore = await prisma.agentRun.count({
      where: { agentId: grantedTarget.id },
    });

    const server = await createMcpServer(
      organisationId,
      undefined,
      orchestrator.id,
      3,
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "invoke_agent",
      arguments: { agentId: grantedTarget.id, input: "Should never run" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("maximum agent-invocation depth"),
      },
    ]);

    const runsAfter = await prisma.agentRun.count({
      where: { agentId: grantedTarget.id },
    });
    expect(runsAfter).toBe(runsBefore);

    await client.close();
  });
});
