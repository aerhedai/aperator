import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

// The full chat-facing contract: chat discovers a department via
// list_templates, installs it with install_workflow_template, and the
// result is immediately usable via invoke_workflow in the same
// organisation — no separate activation step, unlike a lone agent
// template. This is what makes "install and try it right now" real rather
// than aspirational.

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

async function connectClient(organisationId: string, aiProvider?: AIProvider) {
  const server = await createMcpServer(
    organisationId,
    undefined,
    undefined,
    0,
    aiProvider,
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

describe("install_workflow_template tool", () => {
  const organisationId = "test-org-install-workflow-template";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Install Workflow Template Test Org",
        currency: "GBP",
      },
    });
  });

  afterEach(async () => {
    const workflows = await prisma.workflow.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const runs = await prisma.agentRun.findMany({
      where: { organisationId },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    await prisma.approval.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.toolCall.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { agentRunId: { in: runIds } } });
    await prisma.agentRun.deleteMany({ where: { organisationId } });
    await prisma.workflowAgent.deleteMany({
      where: { workflowId: { in: workflows.map((w) => w.id) } },
    });
    await prisma.workflow.deleteMany({ where: { organisationId } });
    await prisma.agentTool.deleteMany({ where: { agent: { organisationId } } });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.customEntityRecord.deleteMany({ where: { organisationId } });
    await prisma.customEntityType.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("list_templates includes workflow templates alongside agent templates", async () => {
    const client = await connectClient(organisationId);
    const result = await client.callTool({
      name: "list_templates",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const templates = (
      result.structuredContent as {
        templates: { name: string; kind: "agent" | "workflow" }[];
      }
    ).templates;
    expect(
      templates.find((t) => t.name === "Scheduling & Bookings"),
    ).toMatchObject({ kind: "workflow" });
    expect(templates.find((t) => t.name === "Look up and quote")).toMatchObject(
      { kind: "agent" },
    );

    await client.close();
  });

  it("errors clearly for an unknown workflow template id", async () => {
    const client = await connectClient(organisationId);
    const result = await client.callTool({
      name: "install_workflow_template",
      arguments: { templateId: "nonexistent-id" },
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("not found") },
    ]);

    await client.close();
  });

  it("installs a department and it is immediately invokable via invoke_workflow", async () => {
    const setupClient = await connectClient(organisationId);
    const listed = await setupClient.callTool({
      name: "list_templates",
      arguments: {},
    });
    const templates = (
      listed.structuredContent as { templates: { id: string; name: string }[] }
    ).templates;
    const schedulingTemplate = templates.find(
      (t) => t.name === "Scheduling & Bookings",
    );
    if (!schedulingTemplate) throw new Error("fixture template not found");

    const installed = await setupClient.callTool({
      name: "install_workflow_template",
      arguments: { templateId: schedulingTemplate.id },
    });
    expect(installed.isError).toBeFalsy();
    const { workflowId } = installed.structuredContent as {
      workflowId: string;
      workflowName: string;
    };
    await setupClient.close();

    // A fresh server/client, the way a real new chat turn would connect —
    // invokableWorkflows is computed fresh per server build, so this
    // proves the just-installed department is discoverable without any
    // separate activation step, not just present in the database.
    const provider = scriptedProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "call_0",
            name: "OUTLOOK_CREATE_CALENDAR_EVENT",
            arguments: {
              subject: "Intro call",
              start: "2026-10-01T10:00:00Z",
              end: "2026-10-01T10:30:00Z",
              attendees: ["customer@example.test"],
            },
          },
        ],
      },
    ]);
    const client = await connectClient(organisationId, provider);

    const result = await client.callTool({
      name: "invoke_workflow",
      arguments: {
        workflowId,
        input: "Can we set up an intro call for next week?",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "waiting_for_approval",
      handledBy: "Meeting Scheduler",
    });

    const approval = await prisma.approval.findFirst({
      where: { requestedAction: "OUTLOOK_CREATE_CALENDAR_EVENT" },
    });
    expect(approval?.status).toBe("PENDING");

    await client.close();
  });
});
