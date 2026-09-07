import { createServer, type Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";
import { createMcpServer } from "@/lib/mcp/server";

const TEST_TOKEN = "test-bearer-token";

// Builds a fresh McpServer for each incoming HTTP request — required by
// stateless mode (sessionIdGenerator: undefined). A single shared instance
// built once (an earlier draft's approach) leaves the first request's SSE
// stream open and corrupts every request after it on the same keep-alive
// connection. See tests/integration/external-mcp-client.test.ts, the
// fixture this one copies exactly.
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
      content: [{ type: "text" as const, text: `results for ${query}` }],
      structuredContent: { query, results: [] },
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

async function connectInProcessClient(organisationId: string) {
  const server = await createMcpServer(organisationId);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("mcp proxy tools", () => {
  const organisationId = "test-org-mcp-proxy-tools";
  let testServer: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "MCP Proxy Tools Test Org",
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

  it("registers a connected server's tools, namespaced, and proxies a real call", async () => {
    const integration = await integrationService.connectMcpServer(
      organisationId,
      { label: "Test Server", url: testServer.url, token: TEST_TOKEN },
    );

    const client = await connectInProcessClient(organisationId);
    try {
      const { tools } = await client.listTools();
      const proxied = tools.find((t) =>
        t.name.startsWith(`mcp:${integration.id}:`),
      );
      expect(proxied?.name).toBe(`mcp:${integration.id}:search`);

      const result = await client.callTool({
        name: `mcp:${integration.id}:search`,
        arguments: { query: "widgets" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        query: "widgets",
        results: [],
      });
    } finally {
      await client.close();
    }
  });

  it("skips only a malformed connection's tools, leaving built-in tools and other connections intact", async () => {
    const goodConnection = await integrationService.connectMcpServer(
      organisationId,
      { label: "Test Server", url: testServer.url, token: TEST_TOKEN },
    );
    // Registration reads each connection's *cached* tool list (never a
    // live network call — see the Global Constraints), so the failure
    // this guards against is a malformed cache row, not a server that
    // happens to be unreachable right now. This row has a real-looking
    // token — so the registration loop's `if (!token) continue;` short
    // circuit does NOT fire for it — but its `config` has no `tools` key
    // at all (predates this feature's expected config shape, or
    // corrupted), so `for (const remoteTool of config.tools)` throws
    // `TypeError: config.tools is not iterable` for this connection only,
    // which is what the surrounding try/catch in
    // lib/mcp/server.ts's registration loop actually guards against.
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "mcp",
        name: "Malformed Connection",
        config: { url: "https://example.test/mcp" },
        // Must be genuinely decryptable — integrationRepository decrypts
        // every row's credentials unconditionally when reading it back, so
        // a raw plaintext object here would throw before the code under
        // test (the registration loop's own try/catch) is ever reached.
        credentials: encryptToken(JSON.stringify({ token: "x" })),
      },
    });

    const client = await connectInProcessClient(organisationId);
    try {
      const { tools } = await client.listTools();
      expect(tools.some((t) => t.name === "find_record")).toBe(true);
      expect(
        tools.some((t) => t.name === `mcp:${goodConnection.id}:search`),
      ).toBe(true);
    } finally {
      await client.close();
    }
  });
});
