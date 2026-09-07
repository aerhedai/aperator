import { createServer, type Server } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";

const TEST_TOKEN = "test-bearer-token";

// Builds a fresh McpServer for each incoming HTTP request. Required by
// stateless mode (sessionIdGenerator: undefined): the SDK's own reference
// example (dist/.../examples/server/simpleStatelessStreamableHttp.js)
// creates a new McpServer + StreamableHTTPServerTransport per request and
// closes both when the response ends. A single transport instance shared
// across a whole test server's lifetime corrupts every request that
// follows the first on the same keep-alive connection (see Task 2's
// tests/integration/external-mcp-client.test.ts, where this was found).
function buildTestMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "test-external-server",
    version: "0.1.0",
  });
  mcpServer.registerTool(
    "search",
    {
      description: "Searches for something.",
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => ({
      content: [{ type: "text" as const, text: query }],
      structuredContent: { query },
    }),
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

describe("mcp integration service", () => {
  const organisationId = "test-org-mcp-integration-service";
  let testServer: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "MCP Integration Service Test Org",
      },
    });
    testServer = await startTestMcpServer();
  });

  afterAll(async () => {
    await testServer.close();
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
  });

  it("connects, validates via a live listTools call, and caches the tool list", async () => {
    const integration = await integrationService.connectMcpServer(
      organisationId,
      { label: "Test Server", url: testServer.url, token: TEST_TOKEN },
    );

    expect(integration.provider).toBe("mcp");
    const config = integration.config as { tools: { name: string }[] };
    expect(config.tools.map((t) => t.name)).toEqual(["search"]);
  });

  it("refuses to connect with a bad token, saving nothing", async () => {
    await expect(
      integrationService.connectMcpServer(organisationId, {
        label: "Bad Token Server",
        url: testServer.url,
        token: "wrong-token",
      }),
    ).rejects.toThrow();

    const saved = await prisma.integration.findMany({
      where: { organisationId, provider: "mcp" },
    });
    expect(saved).toHaveLength(0);
  });

  it("refreshTools re-fetches and replaces the cached tool list", async () => {
    const integration = await integrationService.connectMcpServer(
      organisationId,
      { label: "Test Server", url: testServer.url, token: TEST_TOKEN },
    );

    await integrationService.refreshMcpServerTools(
      organisationId,
      integration.id,
    );

    const refreshed = await integrationService.getIntegration(
      organisationId,
      integration.id,
    );
    const config = refreshed?.config as { tools: { name: string }[] };
    expect(config.tools.map((t) => t.name)).toEqual(["search"]);
  });

  it("findMcpTool finds a real tool by integration and remote name", async () => {
    const integration = await integrationService.connectMcpServer(
      organisationId,
      { label: "Test Server", url: testServer.url, token: TEST_TOKEN },
    );

    const found = await integrationService.findMcpTool(
      organisationId,
      integration.id,
      "search",
    );
    expect(found).toMatchObject({ name: "search", readOnlyHint: true });

    const notFound = await integrationService.findMcpTool(
      organisationId,
      integration.id,
      "nonexistent",
    );
    expect(notFound).toBeNull();
  });

  it("findMcpTool returns null for a different organisation's integration", async () => {
    const integration = await integrationService.connectMcpServer(
      organisationId,
      { label: "Test Server", url: testServer.url, token: TEST_TOKEN },
    );

    const found = await integrationService.findMcpTool(
      "a-different-org",
      integration.id,
      "search",
    );
    expect(found).toBeNull();
  });
});
