import { createServer, type Server } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { AIProvider, AIResponse } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/prisma";
import type { Agent } from "@/lib/generated/prisma/client";
import * as integrationService from "@/lib/integrations/integration-service";
import { buildMcpToolName } from "@/lib/integrations/mcp/tool-naming";
import { runAgent } from "@/lib/runtime/agent-runtime";

// Proves the design spec's own most-important test (see the Testing
// section of docs/superpowers/specs/2026-09-07-external-mcp-connections-design.md):
// a discovered MCP tool with no readOnlyHint: true annotation must pause
// for real human approval *before* ever reaching the remote server — not
// just pause the run, but genuinely never call the remote tool. Mirrors
// tests/integration/invoke-agent-tool.test.ts's own "send_email still
// pauses for approval, never executes" test, but drives a *discovered*
// tool through the exact same enforcement chain
// (agent-runtime.ts's runLoop → requiresApprovalBeforeExecution).
//
// Uses a real local MCP server (not a seeded row with no server behind it)
// specifically so "never executes" can be proven directly — the server's
// own tool handler increments a counter every time it's actually invoked,
// so if the approval gate were ever broken and the call slipped through,
// this test would catch it by that counter being nonzero, not just by a
// run status.

let deleteCallCount = 0;

const TEST_TOKEN = "test-bearer-token";

function buildTestMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "test-approval-gate-server",
    version: "0.1.0",
  });
  // Deliberately no `annotations` at all — readOnlyHint absent, not just
  // false — the design spec is explicit that an absent hint is gated
  // exactly the same as an explicit `false`.
  mcpServer.registerTool(
    "delete_thing",
    {
      description: "Deletes a thing — not read-only, no annotations at all.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      deleteCallCount += 1;
      return {
        content: [{ type: "text" as const, text: `deleted ${id}` }],
        structuredContent: { deleted: id },
      };
    },
  );
  return mcpServer;
}

async function startTestMcpServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const httpServer: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }

    void (async () => {
      const mcpServer = buildTestMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await mcpServer.connect(transport);

      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        void transport.handleRequest(
          req,
          res,
          body.length > 0 ? JSON.parse(body) : undefined,
        );
      });
    })();
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

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

describe("discovered mcp tool approval gate", () => {
  const organisationId = "test-org-mcp-approval-gate";
  let testServer: { url: string; close: () => Promise<void> };
  let agent: Agent;
  let discoveredToolName: string;

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "MCP Approval Gate Test Org",
      },
    });

    testServer = await startTestMcpServer();

    const integration = await integrationService.connectMcpServer(
      organisationId,
      { label: "Approval Gate Server", url: testServer.url, token: TEST_TOKEN },
    );
    discoveredToolName = buildMcpToolName(integration.id, "delete_thing");

    agent = await prisma.agent.create({
      data: {
        organisationId,
        name: "Deleter",
        description: "Granted a discovered, non-read-only mcp tool.",
        instructions: "Delete things when asked.",
        model: "test-model",
        status: "ACTIVE",
        executionMode: "LOOP",
      },
    });
    await prisma.agentTool.create({
      data: { agentId: agent.id, toolName: discoveredToolName },
    });
  });

  afterAll(async () => {
    await testServer.close();
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
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  it("pauses for approval, records a real Approval row, and never actually calls the remote tool", async () => {
    expect(deleteCallCount).toBe(0);

    const provider = scriptedProvider([
      {
        content: "",
        toolCalls: [
          {
            id: "call_0",
            name: discoveredToolName,
            arguments: { id: "widget-1" },
          },
        ],
      },
    ]);

    const result = await runAgent(agent, "Delete widget-1", provider);

    expect(result.status).toBe("WAITING_FOR_APPROVAL");

    const run = await prisma.agentRun.findUniqueOrThrow({
      where: { id: result.runId },
    });
    expect(run.status).toBe("WAITING_FOR_APPROVAL");

    const approval = await prisma.approval.findFirst({
      where: { agentRunId: result.runId },
    });
    expect(approval).toMatchObject({
      status: "PENDING",
      requestedAction: discoveredToolName,
    });

    // No ToolCall row exists for this call at all — gateAndExecuteTool's
    // (and runLoop's) approval-pause path returns before ever reaching
    // executeAndRecordTool, which is the only place a ToolCall row for a
    // successful/failed call gets created.
    const toolCalls = await prisma.toolCall.findMany({
      where: { agentRunId: result.runId, toolName: discoveredToolName },
    });
    expect(toolCalls).toHaveLength(0);

    // The decisive assertion: the real remote server's own tool handler
    // was never invoked. If the approval gate were broken and the call
    // slipped through to callExternalMcpTool, this would be nonzero.
    expect(deleteCallCount).toBe(0);
  });
});
