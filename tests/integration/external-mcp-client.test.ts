import { createServer, type Server } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  callExternalMcpTool,
  connectExternalMcpClient,
  listExternalMcpTools,
} from "@/lib/integrations/mcp/external-client";

const TEST_TOKEN = "test-bearer-token";

// Builds a fresh McpServer for each incoming HTTP request. Required by
// stateless mode (sessionIdGenerator: undefined): the SDK's own reference
// example (dist/.../examples/server/simpleStatelessStreamableHttp.js)
// creates a new McpServer + StreamableHTTPServerTransport per request and
// closes both when the response ends. A single transport instance shared
// across a whole test server's lifetime — as an earlier draft of this
// fixture did — leaves the first request's SSE stream open and corrupts
// every request that follows it on the same keep-alive connection (they
// come back as a bodiless 500 with no application-level error anywhere).
function buildTestMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "test-external-server",
    version: "0.1.0",
  });
  mcpServer.registerTool(
    "echo",
    {
      description: "Echoes back the message it's given.",
      inputSchema: { message: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ message }) => ({
      content: [{ type: "text" as const, text: message }],
      structuredContent: { message },
    }),
  );
  mcpServer.registerTool(
    "delete_thing",
    {
      description: "Deletes a thing — not read-only.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => ({
      content: [{ type: "text" as const, text: `deleted ${id}` }],
      structuredContent: { deleted: id },
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

describe("external MCP client", () => {
  let server: { url: string; close: () => Promise<void> } | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it("connects and lists tools with their annotations", async () => {
    server = await startTestMcpServer();

    const tools = await listExternalMcpTools(server.url, TEST_TOKEN);

    expect(tools).toHaveLength(2);
    const echo = tools.find((t) => t.name === "echo");
    expect(echo).toMatchObject({ readOnlyHint: true });
    const del = tools.find((t) => t.name === "delete_thing");
    expect(del).toMatchObject({ readOnlyHint: null });
  });

  it("calls a tool and returns its structured content", async () => {
    server = await startTestMcpServer();

    const result = await callExternalMcpTool(server.url, TEST_TOKEN, "echo", {
      message: "hello",
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ message: "hello" });
  });

  it("rejects a bad token", async () => {
    server = await startTestMcpServer();

    await expect(
      connectExternalMcpClient(server.url, "wrong-token"),
    ).rejects.toThrow();
  });

  it("rejects an unreachable URL", async () => {
    await expect(
      connectExternalMcpClient("http://127.0.0.1:1/mcp", TEST_TOKEN),
    ).rejects.toThrow();
  });
});
