import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent, Workflow } from "@/lib/generated/prisma/client";
import { createMcpServer } from "@/lib/mcp/server";
import {
  dispatchToWorkflowById,
  type DispatchToWorkflowResult,
} from "@/lib/routing/dispatch";

// invoke_workflow's own contract: chat can ask a *department* to handle
// something and let its classifier pick the actual handler, rather than
// always having to name one specific agent (invoke_agent's job). Handlers
// here are HARNESS agents with a trivial step programme so the dispatch
// path itself is exercised end to end with no real AI provider involved —
// the one multi-handler case that does need a classifier decision scripts
// a fake provider instead of hitting a real model.

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

const trivialStepsConfig = {
  steps: [
    {
      kind: "compute",
      as: "noted",
      operation: "template",
      operands: ["handled"],
    },
  ],
} as never;

describe("dispatchToWorkflowById", () => {
  const organisationId = "test-org-invoke-workflow-dispatch";
  let classifier: Agent;
  let onlyHandler: Agent;
  let activeWorkflow: Workflow;
  let inactiveWorkflow: Workflow;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Invoke Workflow Dispatch Test Org",
      },
    });

    classifier = await prisma.agent.create({
      data: {
        organisationId,
        name: "Classifier",
        description: "Routes inbound messages.",
        instructions: "Decide which agent should handle this message.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

    onlyHandler = await prisma.agent.create({
      data: {
        organisationId,
        name: "Only Handler",
        description: "Handles everything.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "steps",
        keywords: [],
        pipelineConfig: trivialStepsConfig,
      },
    });

    activeWorkflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Support",
        description: "Active department.",
        trigger: "WEBHOOK",
        status: "ACTIVE",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        {
          workflowId: activeWorkflow.id,
          agentId: classifier.id,
          role: "CLASSIFIER",
        },
        {
          workflowId: activeWorkflow.id,
          agentId: onlyHandler.id,
          role: "HANDLER",
        },
      ],
    });

    inactiveWorkflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Not Yet Live",
        description: "Still a draft.",
        trigger: "WEBHOOK",
        status: "DRAFT",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        {
          workflowId: inactiveWorkflow.id,
          agentId: classifier.id,
          role: "CLASSIFIER",
        },
        {
          workflowId: inactiveWorkflow.id,
          agentId: onlyHandler.id,
          role: "HANDLER",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.toolCall.deleteMany({
      where: { agentRun: { organisationId } },
    });
    await prisma.runStep.deleteMany({
      where: { agentRun: { organisationId } },
    });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.workflowAgent.deleteMany({
      where: { workflow: { organisationId } },
    });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("returns not_found for a workflow id that doesn't exist", async () => {
    const result = await dispatchToWorkflowById(
      organisationId,
      "nonexistent-workflow-id",
      "Anything",
      0,
    );
    expect(result).toEqual<DispatchToWorkflowResult>({
      matched: false,
      reason: "not_found",
    });
  });

  it("returns inactive for a workflow that exists but isn't ACTIVE", async () => {
    const result = await dispatchToWorkflowById(
      organisationId,
      inactiveWorkflow.id,
      "Anything",
      0,
    );
    expect(result).toEqual<DispatchToWorkflowResult>({
      matched: false,
      reason: "inactive",
    });
  });

  it("dispatches to the workflow's single handler with no LLM call", async () => {
    // scriptedProvider([]) throws the moment anything asks the model, so
    // this passing proves the single-handler shortcut skipped the LLM.
    const result = await dispatchToWorkflowById(
      organisationId,
      activeWorkflow.id,
      "Anything at all",
      0,
      scriptedProvider([]),
    );

    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.agentId).toBe(onlyHandler.id);
      expect(result.run.status).toBe("COMPLETED");
    }
  });

  it("returns no_match when the classifier finds nothing that clearly fits", async () => {
    const secondHandler = await prisma.agent.create({
      data: {
        organisationId,
        name: "Second Handler",
        description: "Also handles some things.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "steps",
        keywords: [],
        pipelineConfig: trivialStepsConfig,
      },
    });
    await prisma.workflowAgent.create({
      data: {
        workflowId: activeWorkflow.id,
        agentId: secondHandler.id,
        role: "HANDLER",
      },
    });

    try {
      const provider = scriptedProvider([{ content: '{"agentId": null}' }]);
      const result = await dispatchToWorkflowById(
        organisationId,
        activeWorkflow.id,
        "Something ambiguous",
        0,
        provider,
      );
      expect(result).toEqual<DispatchToWorkflowResult>({
        matched: false,
        reason: "no_match",
      });
    } finally {
      await prisma.workflowAgent.deleteMany({
        where: { workflowId: activeWorkflow.id, agentId: secondHandler.id },
      });
      await prisma.agent.delete({ where: { id: secondHandler.id } });
    }
  });
});

describe("invoke_workflow tool", () => {
  const organisationId = "test-org-invoke-workflow-tool";
  let orchestrator: Agent;
  let handler: Agent;
  let activeWorkflow: Workflow;
  let inactiveWorkflow: Workflow;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Invoke Workflow Tool Test Org",
      },
    });

    orchestrator = await prisma.agent.create({
      data: {
        organisationId,
        name: "Orchestrator",
        description: "Delegates to departments.",
        instructions: "Delegate tasks to workflows when useful.",
        model: "test-model",
        status: "ACTIVE",
      },
    });
    await prisma.agentTool.create({
      data: { agentId: orchestrator.id, toolName: "invoke_workflow" },
    });

    const classifier = await prisma.agent.create({
      data: {
        organisationId,
        name: "Department Classifier",
        description: "Routes inbound messages.",
        instructions: "Decide which agent should handle this message.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

    handler = await prisma.agent.create({
      data: {
        organisationId,
        name: "Department Handler",
        description: "Handles everything for this department.",
        instructions: "Handle it.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "HARNESS",
        pipelineKey: "steps",
        keywords: [],
        pipelineConfig: trivialStepsConfig,
      },
    });

    activeWorkflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Support Department",
        description: "Handles support requests.",
        trigger: "WEBHOOK",
        status: "ACTIVE",
      },
    });
    await prisma.workflowAgent.createMany({
      data: [
        {
          workflowId: activeWorkflow.id,
          agentId: classifier.id,
          role: "CLASSIFIER",
        },
        { workflowId: activeWorkflow.id, agentId: handler.id, role: "HANDLER" },
      ],
    });

    inactiveWorkflow = await prisma.workflow.create({
      data: {
        organisationId,
        name: "Retired Department",
        description: "No longer live.",
        trigger: "WEBHOOK",
        status: "ARCHIVED",
      },
    });
  });

  afterAll(async () => {
    await prisma.toolCall.deleteMany({
      where: { agentRun: { organisationId } },
    });
    await prisma.runStep.deleteMany({
      where: { agentRun: { organisationId } },
    });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.workflowAgent.deleteMany({
      where: { workflow: { organisationId } },
    });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("refuses to invoke a workflow that isn't active, without ever running it", async () => {
    const server = await createMcpServer(
      organisationId,
      undefined,
      orchestrator.id,
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "invoke_workflow",
      arguments: { workflowId: inactiveWorkflow.id, input: "Do something" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("may currently invoke"),
      },
    ]);

    const runs = await prisma.agentRun.count({
      where: { agentId: handler.id },
    });
    expect(runs).toBe(0);

    await client.close();
  });

  it("invokes an active workflow and surfaces which handler took it", async () => {
    // scriptedProvider([]) throws the moment anything asks the model — the
    // single-handler shortcut in selectHandler means this test proves no
    // LLM call happened, same as dispatchToWorkflowById's own direct test
    // above. Passed as the server's own aiProvider (as a real caller's run
    // would) since invoke_workflow reuses it rather than resolving one
    // itself.
    const server = await createMcpServer(
      organisationId,
      undefined,
      orchestrator.id,
      0,
      scriptedProvider([]),
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "invoke_workflow",
      arguments: {
        workflowId: activeWorkflow.id,
        input: "Something for support",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "completed",
      handledBy: handler.name,
    });

    const targetRun = await prisma.agentRun.findFirst({
      where: { agentId: handler.id },
    });
    expect(targetRun).toMatchObject({ status: "COMPLETED" });

    await client.close();
  });

  it("refuses to invoke past the maximum invocation depth without running anything", async () => {
    const runsBefore = await prisma.agentRun.count({
      where: { agentId: handler.id },
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
      name: "invoke_workflow",
      arguments: { workflowId: activeWorkflow.id, input: "Should never run" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("maximum agent-invocation depth"),
      },
    ]);

    const runsAfter = await prisma.agentRun.count({
      where: { agentId: handler.id },
    });
    expect(runsAfter).toBe(runsBefore);

    await client.close();
  });
});
