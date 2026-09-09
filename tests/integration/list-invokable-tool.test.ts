import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

// The bug this exists to catch: invoke_agent/invoke_workflow embed "what's
// currently invokable" in their own tool *description* text, computed once
// when createMcpServer builds the server (lib/mcp/server.ts) and never
// re-evaluated for the rest of that server's lifetime — in the real
// runtime, that lifetime is one whole chat turn (lib/runtime/agent-
// runtime.ts's loadTools reads the tool list exactly once per turn). If a
// tool call installs something new mid-turn, those two tools' descriptions
// stay stale for the rest of that same turn. list_invokable's handler
// queries live at call time instead, so — unlike the two invoke tools —
// it must reflect an install that happened earlier in the very same
// connection, not just on a fresh one. This test proves exactly that,
// using one continuous MCP client connection for both calls, the same way
// one continuous agent turn would.

describe("list_invokable tool", () => {
  const organisationId = "test-org-list-invokable";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "List Invokable Test Org",
        currency: "GBP",
      },
    });
  });

  afterEach(async () => {
    const workflows = await prisma.workflow.findMany({
      where: { organisationId },
      select: { id: true },
    });
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

  it("reflects a workflow installed earlier in the same connection — not just on a fresh one", async () => {
    const orchestrator = await prisma.agent.create({
      data: {
        organisationId,
        name: "Assistant",
        description: "Chats with the team.",
        instructions: "Help out.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "CHAT",
      },
    });

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

    const before = await client.callTool({
      name: "list_invokable",
      arguments: {},
    });
    expect(before.isError).toBeFalsy();
    expect(
      (before.structuredContent as { workflows: { name: string }[] }).workflows,
    ).toEqual([]);

    const listed = await client.callTool({
      name: "list_templates",
      arguments: {},
    });
    const templates = (
      listed.structuredContent as { templates: { id: string; name: string }[] }
    ).templates;
    const supportTemplate = templates.find(
      (t) => t.name === "Customer Support",
    );
    if (!supportTemplate) throw new Error("fixture template not found");

    const installed = await client.callTool({
      name: "install_workflow_template",
      arguments: { templateId: supportTemplate.id },
    });
    expect(installed.isError).toBeFalsy();

    // Same client, same connection, same underlying McpServer instance —
    // no reconnect — proving this doesn't depend on a fresh turn.
    const after = await client.callTool({
      name: "list_invokable",
      arguments: {},
    });
    expect(after.isError).toBeFalsy();
    const workflowNames = (
      after.structuredContent as { workflows: { name: string }[] }
    ).workflows.map((w) => w.name);
    expect(workflowNames).toEqual(["Customer Support"]);

    await client.close();
  });

  it("excludes the caller itself and CHAT-mode agents from the agents list", async () => {
    const orchestrator = await prisma.agent.create({
      data: {
        organisationId,
        name: "Assistant",
        description: "Chats with the team.",
        instructions: "Help out.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "CHAT",
      },
    });
    await prisma.agent.create({
      data: {
        organisationId,
        name: "Worker",
        description: "Does a narrow task.",
        instructions: "Do the task.",
        model: "test-model",
        status: "ACTIVE",
      },
    });

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
      name: "list_invokable",
      arguments: {},
    });
    const agentNames = (
      result.structuredContent as { agents: { name: string }[] }
    ).agents.map((a) => a.name);
    expect(agentNames).toEqual(["Worker"]);

    await client.close();
  });
});
