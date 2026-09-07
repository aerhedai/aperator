# External MCP Server Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organisation connect to an external MCP server (label, URL,
bearer token) and immediately make every tool it exposes grantable to
agents — no code written per tool, per provider.

**Architecture:** A connection is an ordinary `Integration` row
(`provider: "mcp"`) with its discovered tool list cached in `config`.
`createMcpServer` proxies each cached tool as a forwarding registration on
Aperator's own in-process `McpServer`, so the existing runtime
(`agent-runtime.ts`, `tool-execution.ts`) — the one place grants and policy
are enforced — needs no changes to _how_ it works, only a few small,
additive hooks. `AgentTool.toolName` and `policy-engine.ts`'s approval gate
both grow a second, dynamically-validated shape (`mcp:<integrationId>:<remoteToolName>`)
alongside the existing fixed one.

**Tech Stack:** `@modelcontextprotocol/sdk` (already a dependency,
`^1.30.0`), Next.js Server Actions, Prisma (no schema migration needed —
both `Integration.provider` and `AgentTool.toolName` are already plain
strings).

**Spec:** `docs/superpowers/specs/2026-09-07-external-mcp-connections-design.md`

## Global Constraints

- v1 auth for external MCP servers is a static bearer token/API key only —
  no OAuth 2.1 dynamic client registration.
- Discovered tools default to approval-gated unless the remote server's
  `tools/list` response marks a tool `annotations.readOnlyHint: true`.
- Proxied tools get a permissive pass-through input schema — the remote
  server is the authoritative validator for its own tool, not Aperator.
- Tool lists are cached on the `Integration` row (refreshed at connect
  time and via a manual "Refresh tools" action) — never re-fetched over
  the network on every agent run.
- One connection unreachable while building an org's tool server must
  never break any other tool, built-in or from a different connection.
- Migrating the 7 existing OAuth-based integrations off their
  hand-written tool files is explicitly out of scope for this plan.

---

## Task 1: MCP tool naming — the shared `mcp:` convention

**Files:**

- Create: `lib/integrations/mcp/tool-naming.ts`
- Test: `tests/unit/mcp-tool-naming.test.ts`

**Interfaces:**

- Produces: `DiscoveredMcpTool` type (`{name: string; description: string;
inputSchema: {type: "object"; properties?: Record<string, unknown>;
required?: string[]}; readOnlyHint: boolean | null}`), `buildMcpToolName(integrationId:
string, remoteToolName: string): string`, `parseMcpToolName(toolName:
string): {integrationId: string; remoteToolName: string} | null`.

This is the one place the `mcp:<integrationId>:<remoteToolName>` string
shape is built and parsed — every other task imports from here rather than
re-deriving the pattern.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/mcp-tool-naming.test.ts
import { describe, expect, it } from "vitest";

import {
  buildMcpToolName,
  parseMcpToolName,
} from "@/lib/integrations/mcp/tool-naming";

describe("buildMcpToolName / parseMcpToolName", () => {
  it("round-trips a simple integration id and tool name", () => {
    const name = buildMcpToolName("clx123abc", "search_pages");
    expect(name).toBe("mcp:clx123abc:search_pages");
    expect(parseMcpToolName(name)).toEqual({
      integrationId: "clx123abc",
      remoteToolName: "search_pages",
    });
  });

  it("preserves a remote tool name that itself contains a colon", () => {
    const name = buildMcpToolName("clx123abc", "namespace:sub_tool");
    expect(parseMcpToolName(name)).toEqual({
      integrationId: "clx123abc",
      remoteToolName: "namespace:sub_tool",
    });
  });

  it("returns null for a name with no mcp: prefix", () => {
    expect(parseMcpToolName("find_record")).toBeNull();
  });

  it("returns null for a malformed mcp: name with no second segment", () => {
    expect(parseMcpToolName("mcp:onlyoneseg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/mcp-tool-naming.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/mcp/tool-naming'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/integrations/mcp/tool-naming.ts

// A tool discovered from an external MCP server's tools/list response —
// cached on the owning Integration row's config.tools. readOnlyHint comes
// straight from the remote server's own (untrusted, per the MCP spec's own
// warning) annotations — used only to relax the approval gate, never to
// grant anything that wasn't already explicitly granted.
export interface DiscoveredMcpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
  readOnlyHint: boolean | null;
}

const PREFIX = "mcp:";

// The namespace exists only so the name is unique inside Aperator's own
// tool list — it is never sent to the remote server, which only ever
// hears its own real tool name (see external-client.ts's callExternalMcpTool).
// remoteToolName may itself contain colons (MCP doesn't forbid it), so
// parsing splits on the first colon after the integration id, not every
// colon in the string.
export function buildMcpToolName(
  integrationId: string,
  remoteToolName: string,
): string {
  return `${PREFIX}${integrationId}:${remoteToolName}`;
}

export function parseMcpToolName(
  toolName: string,
): { integrationId: string; remoteToolName: string } | null {
  if (!toolName.startsWith(PREFIX)) return null;
  const rest = toolName.slice(PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) return null;
  return {
    integrationId: rest.slice(0, separatorIndex),
    remoteToolName: rest.slice(separatorIndex + 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/mcp-tool-naming.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/mcp/tool-naming.ts tests/unit/mcp-tool-naming.test.ts
git commit -m "feat: add the mcp: tool naming convention"
```

---

## Task 2: External MCP client — connect, list, call over real HTTP

**Files:**

- Create: `lib/integrations/mcp/external-client.ts`
- Test: `tests/integration/external-mcp-client.test.ts`

**Interfaces:**

- Consumes: `DiscoveredMcpTool` (Task 1).
- Produces: `connectExternalMcpClient(url: string, token: string):
Promise<Client>` (real `@modelcontextprotocol/sdk` `Client`),
  `listExternalMcpTools(url: string, token: string):
Promise<DiscoveredMcpTool[]>`, `callExternalMcpTool(url: string, token:
string, remoteToolName: string, args: Record<string, unknown>):
Promise<import("@modelcontextprotocol/sdk/types.js").CallToolResult>`.

This is the first genuinely networked MCP client in this codebase (every
existing one uses `InMemoryTransport`) — `StreamableHTTPClientTransport`
from `@modelcontextprotocol/sdk/client/streamableHttp.js`, with the bearer
token attached via its `requestInit.headers`. Each of the three exported
functions opens its own client and closes it when done — no connection
pooling in v1 (a deliberate simplification: session reuse across a whole
run would need lifecycle management this codebase has no precedent for
yet; one connect-handshake per call is simple and correct, just not the
fastest possible).

- [ ] **Step 1: Write the failing test**

This test stands up a _real_ local MCP server over real HTTP (not a mock)
using the SDK's own server-side pieces, exactly the "real protocol
round trip" standard the rest of this codebase's MCP tests already hold to
(see `tests/integration/mcp-tools.test.ts`'s own comment on this).

```typescript
// tests/integration/external-mcp-client.test.ts
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

async function startTestMcpServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);

  const httpServer: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/external-mcp-client.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integrations/mcp/external-client'`

- [ ] **Step 3: Write the implementation**

```typescript
// lib/integrations/mcp/external-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";

/**
 * Opens a real network connection to an external MCP server — the first
 * genuinely networked MCP client in this codebase (every in-process one
 * uses InMemoryTransport). No connection pooling: each call site connects,
 * does its work, and closes — a deliberate v1 simplification, see the
 * design spec.
 */
export async function connectExternalMcpClient(
  url: string,
  token: string,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({
    name: "aperator-external-mcp-client",
    version: "0.1.0",
  });
  await client.connect(transport);
  return client;
}

export async function listExternalMcpTools(
  url: string,
  token: string,
): Promise<DiscoveredMcpTool[]> {
  const client = await connectExternalMcpClient(url, token);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: {
        type: "object",
        properties: tool.inputSchema?.properties as
          Record<string, unknown> | undefined,
        required: tool.inputSchema?.required,
      },
      readOnlyHint: tool.annotations?.readOnlyHint ?? null,
    }));
  } finally {
    await client.close();
  }
}

export async function callExternalMcpTool(
  url: string,
  token: string,
  remoteToolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const client = await connectExternalMcpClient(url, token);
  try {
    return await client.callTool({ name: remoteToolName, arguments: args });
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/external-mcp-client.test.ts`
Expected: PASS (4 tests). If the server fixture's `handleRequest` call
signature doesn't match what's installed (`@modelcontextprotocol/sdk`
version drift), check
`node_modules/@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.d.ts`
for the exact signature and adjust the fixture, not the implementation
under test.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/mcp/external-client.ts tests/integration/external-mcp-client.test.ts
git commit -m "feat: add a real networked MCP client for external servers"
```

---

## Task 3: Connecting a server — registry entry + service functions

**Files:**

- Modify: `lib/integrations/integration-registry.ts`
- Modify: `lib/integrations/integration-service.ts`
- Test: `tests/integration/mcp-integration-service.test.ts`

**Interfaces:**

- Consumes: `listExternalMcpTools` (Task 2), `DiscoveredMcpTool`,
  `buildMcpToolName`, `parseMcpToolName` (Task 1).
- Produces: `MCP_PROVIDER = "mcp"`, `connectMcpServer(organisationId:
string, input: {label: string; url: string; token: string}):
Promise<Integration>` (throws with a specific message on connect
  failure), `refreshMcpServerTools(organisationId: string, integrationId:
string): Promise<void>`, `findMcpTool(organisationId: string,
integrationId: string, remoteToolName: string): Promise<DiscoveredMcpTool
| null>`.

`connectMcpServer` mirrors `connectWebhookAccount`'s existing shape (a
manual, non-OAuth connection written straight through
`integrationRepository.upsertIntegration`) but validates _before_ saving —
a live `listExternalMcpTools` call, matching the design spec's "fails at
connect time with a clear error, not silently at first agent run."

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/mcp-integration-service.test.ts
import { createServer, type Server } from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";

const TEST_TOKEN = "test-bearer-token";

async function startTestMcpServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);

  const httpServer: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/mcp-integration-service.test.ts`
Expected: FAIL — `integrationService.connectMcpServer is not a function`

- [ ] **Step 3: Add the registry entry**

```typescript
// lib/integrations/integration-registry.ts
// Add to the INTEGRATION_REGISTRY array, after the "sharepoint" entry:
  {
    provider: "mcp",
    label: "Custom MCP server",
    description:
      "Connect any external system's own MCP server by URL and bearer token — every tool it exposes becomes grantable to your agents, no code required.",
    connectionMode: "manual",
  },
```

- [ ] **Step 4: Add the service functions**

```typescript
// lib/integrations/integration-service.ts
// Add near connectWebhookAccount:

import { listExternalMcpTools } from "@/lib/integrations/mcp/external-client";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";

export const MCP_PROVIDER = "mcp";

/**
 * Validates via a live listTools() call before saving anything — a broken
 * URL or bad token fails here, at connect time, with a specific error,
 * never silently at first agent run.
 */
export async function connectMcpServer(
  organisationId: string,
  input: { label: string; url: string; token: string },
) {
  const tools = await listExternalMcpTools(input.url, input.token);
  return integrationRepository.upsertIntegration(
    organisationId,
    MCP_PROVIDER,
    input.label,
    {
      config: {
        url: input.url,
        tools,
        toolsRefreshedAt: new Date().toISOString(),
      },
      credentials: { token: input.token },
    },
  );
}

export async function refreshMcpServerTools(
  organisationId: string,
  integrationId: string,
): Promise<void> {
  const integration = await integrationRepository.findIntegrationById(
    organisationId,
    integrationId,
  );
  if (!integration || integration.provider !== MCP_PROVIDER) {
    throw new Error("MCP server connection not found");
  }
  const url = (integration.config as { url: string }).url;
  const token = integration.credentials?.token as string | undefined;
  if (!token) {
    throw new Error("This connection has no saved token");
  }
  const tools = await listExternalMcpTools(url, token);
  await integrationRepository.upsertIntegration(
    organisationId,
    MCP_PROVIDER,
    integration.name,
    {
      config: { url, tools, toolsRefreshedAt: new Date().toISOString() },
      credentials: { token },
    },
  );
}

/**
 * The one place a discovered tool is looked up by (integrationId,
 * remoteToolName) — used by policy-engine.ts's approval-gate check and
 * agent-service.ts's grant validation alike, so both always agree on
 * exactly which tools genuinely exist for this organisation right now.
 * Scoped by organisationId at the repository layer — an id belonging to a
 * different organisation's connection can never match here.
 */
export async function findMcpTool(
  organisationId: string,
  integrationId: string,
  remoteToolName: string,
): Promise<DiscoveredMcpTool | null> {
  const integration = await integrationRepository.findIntegrationById(
    organisationId,
    integrationId,
  );
  if (!integration || integration.provider !== MCP_PROVIDER) return null;
  const tools = (integration.config as { tools?: DiscoveredMcpTool[] }).tools;
  return tools?.find((tool) => tool.name === remoteToolName) ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/mcp-integration-service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full unit+integration suite to confirm no regression**

Run: `pnpm test`
Expected: PASS, same count as before plus the new tests here and from
Tasks 1–2.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/integration-registry.ts lib/integrations/integration-service.ts tests/integration/mcp-integration-service.test.ts
git commit -m "feat: add connectMcpServer/refreshMcpServerTools/findMcpTool"
```

---

## Task 4: Policy engine — approval gate for discovered tools

**Files:**

- Modify: `lib/policies/policy-engine.ts`
- Modify: `lib/runtime/agent-runtime.ts` (the two `requiresApprovalBeforeExecution` call sites)
- Modify: `lib/runtime/tool-execution.ts` (the one `requiresApprovalBeforeExecution` call site)
- Modify: `tests/unit/policy-engine.test.ts`

**Interfaces:**

- Consumes: `findMcpTool`, `parseMcpToolName` (Tasks 1, 3).
- Produces: `requiresApprovalBeforeExecution(toolName: string,
organisationId: string): Promise<boolean>` — **signature change**: was
  synchronous with one parameter, now async with two. Every existing call
  site already runs inside an `async` function with `organisationId` in
  scope.

- [ ] **Step 1: Update the failing test first**

```typescript
// tests/unit/policy-engine.test.ts — replace the existing file's content
import { describe, expect, it, vi } from "vitest";

import * as integrationService from "@/lib/integrations/integration-service";
import { requiresApprovalBeforeExecution } from "@/lib/policies/policy-engine";

const ORG_ID = "test-org";

describe("requiresApprovalBeforeExecution", () => {
  it("requires approval for send_email", async () => {
    expect(await requiresApprovalBeforeExecution("send_email", ORG_ID)).toBe(
      true,
    );
  });

  it("requires approval for create_calendar_event", async () => {
    expect(
      await requiresApprovalBeforeExecution("create_calendar_event", ORG_ID),
    ).toBe(true);
  });

  it("does not require approval for notify_channel", async () => {
    expect(
      await requiresApprovalBeforeExecution("notify_channel", ORG_ID),
    ).toBe(false);
  });

  it("does not require approval for read-only built-in tools", async () => {
    expect(await requiresApprovalBeforeExecution("find_record", ORG_ID)).toBe(
      false,
    );
    expect(
      await requiresApprovalBeforeExecution("search_records", ORG_ID),
    ).toBe(false);
    expect(
      await requiresApprovalBeforeExecution(
        "check_calendar_availability",
        ORG_ID,
      ),
    ).toBe(false);
  });

  it("does not require approval for an mcp tool marked readOnlyHint: true", async () => {
    vi.spyOn(integrationService, "findMcpTool").mockResolvedValueOnce({
      name: "search",
      description: "",
      inputSchema: { type: "object" },
      readOnlyHint: true,
    });

    expect(
      await requiresApprovalBeforeExecution("mcp:int1:search", ORG_ID),
    ).toBe(false);
  });

  it("requires approval for an mcp tool with no readOnlyHint at all", async () => {
    vi.spyOn(integrationService, "findMcpTool").mockResolvedValueOnce({
      name: "delete_page",
      description: "",
      inputSchema: { type: "object" },
      readOnlyHint: null,
    });

    expect(
      await requiresApprovalBeforeExecution("mcp:int1:delete_page", ORG_ID),
    ).toBe(true);
  });

  it("requires approval for an mcp tool whose connection can no longer be found (fail closed)", async () => {
    vi.spyOn(integrationService, "findMcpTool").mockResolvedValueOnce(null);

    expect(
      await requiresApprovalBeforeExecution("mcp:gone:whatever", ORG_ID),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/policy-engine.test.ts`
Expected: FAIL — `requiresApprovalBeforeExecution(...).then is not a
function` (it's still synchronous) or similar

- [ ] **Step 3: Update policy-engine.ts**

```typescript
// lib/policies/policy-engine.ts
// Add this import at the top:
import * as integrationService from "@/lib/integrations/integration-service";
import { parseMcpToolName } from "@/lib/integrations/mcp/tool-naming";

// Replace the existing requiresApprovalBeforeExecution function with:
export async function requiresApprovalBeforeExecution(
  toolName: string,
  organisationId: string,
): Promise<boolean> {
  if (REQUIRES_APPROVAL_BEFORE_EXECUTION.has(toolName)) return true;

  const parsed = parseMcpToolName(toolName);
  if (!parsed) return false;

  const tool = await integrationService.findMcpTool(
    organisationId,
    parsed.integrationId,
    parsed.remoteToolName,
  );
  // Not found (disconnected, stale grant, cache mismatch) or not
  // explicitly marked read-only — fail closed, require approval. A
  // readOnlyHint is an unverified claim from the remote server itself
  // (the MCP spec's own docs warn clients not to make trust decisions
  // based on it) — trusting it here only ever *relaxes* an additional
  // safety net (human approval), never grants access that wasn't already
  // explicitly given via an AgentTool row.
  return tool?.readOnlyHint !== true;
}
```

- [ ] **Step 4: Update the two call sites in agent-runtime.ts**

```typescript
// lib/runtime/agent-runtime.ts
// Around line 231 (inside runLoop's tool-call loop, which already has
// organisationId in scope from its destructured context):
      if (await requiresApprovalBeforeExecution(call.name, organisationId)) {
```

Search for the second usage referenced in the comment near line 456
(`resumeRun`'s doc comment references it but doesn't call it directly —
confirm with `grep -n "requiresApprovalBeforeExecution" lib/runtime/agent-runtime.ts`
that only the one call site at the former line 231 needs updating; the
other match is a comment).

- [ ] **Step 5: Update the call site in tool-execution.ts**

```typescript
// lib/runtime/tool-execution.ts
// Inside gateAndExecuteTool, around line 114:
  if (await requiresApprovalBeforeExecution(name, organisationId)) {
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/policy-engine.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Run typecheck and the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS. `pnpm typecheck` in particular will catch any missed
`await`/async call site — `requiresApprovalBeforeExecution` used
without `await` now returns a `Promise<boolean>`, which is always
truthy, so a missed call site is a real, dangerous bug (an approval-gated
tool would stop being gated) — do not proceed if typecheck doesn't pass
cleanly.

- [ ] **Step 8: Commit**

```bash
git add lib/policies/policy-engine.ts lib/runtime/agent-runtime.ts lib/runtime/tool-execution.ts tests/unit/policy-engine.test.ts
git commit -m "feat: gate discovered mcp tools on readOnlyHint, default to approval"
```

---

## Task 5: Proxy tool factory + wiring into createMcpServer

**Files:**

- Create: `lib/mcp/tools/mcp-proxy-tool.ts`
- Modify: `lib/mcp/server.ts`
- Test: `tests/integration/mcp-proxy-tools.test.ts`

**Interfaces:**

- Consumes: `DiscoveredMcpTool`, `buildMcpToolName` (Task 1),
  `callExternalMcpTool` (Task 2), `MCP_PROVIDER` (Task 3),
  `integrationRepository.findIntegrationsByProvider` (existing).
- Produces: `createMcpProxyTool(integrationId: string, url: string, token:
string, remoteTool: DiscoveredMcpTool)` → a `ToolDefinition`-shaped
  object (`{name, description, inputSchema, outputSchema, handler}`)
  matching the same shape every other file in `lib/mcp/tools/` returns.
  `createMcpServer` (existing, `lib/mcp/server.ts`) gains one more
  registration step — no change to its existing exported signature.

The proxy tool's input/output schemas are built dynamically, per
discovered tool, from the remote's declared JSON Schema property names —
each property maps to `z.unknown().optional()`. This is the "permissive
pass-through" the design spec calls for: Aperator doesn't enforce types or
required-ness on a tool it didn't write, only that the top-level shape is
plausible; the remote server validates the rest.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/mcp-proxy-tools.test.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";
import { createMcpServer } from "@/lib/mcp/server";

const TEST_TOKEN = "test-bearer-token";

async function startTestMcpServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await mcpServer.connect(transport);

  const httpServer: Server = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      res.writeHead(401).end();
      return;
    }
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
    await integrationService.connectMcpServer(organisationId, {
      label: "Test Server",
      url: testServer.url,
      token: TEST_TOKEN,
    });
    // Registration reads each connection's *cached* tool list (never a
    // live network call — see the Global Constraints), so the failure
    // this guards against is a malformed cache row, not a server that
    // happens to be unreachable right now: a row with no `tools` array at
    // all (predates this feature's expected config shape, or corrupted)
    // makes the `for (const remoteTool of config.tools)` loop throw for
    // that one connection only.
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "mcp",
        name: "Malformed Connection",
        config: {},
        credentials: null,
      },
    });

    const client = await connectInProcessClient(organisationId);
    try {
      const { tools } = await client.listTools();
      expect(tools.some((t) => t.name === "find_record")).toBe(true);
      expect(tools.some((t) => t.name.startsWith("mcp:"))).toBe(true);
    } finally {
      await client.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/mcp-proxy-tools.test.ts`
Expected: FAIL — no `mcp:` tools registered yet (first assertion fails)

- [ ] **Step 3: Write the proxy tool factory**

```typescript
// lib/mcp/tools/mcp-proxy-tool.ts
import { z } from "zod";

import { callExternalMcpTool } from "@/lib/integrations/mcp/external-client";
import {
  buildMcpToolName,
  type DiscoveredMcpTool,
} from "@/lib/integrations/mcp/tool-naming";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

function buildPassthroughShape(
  properties: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  if (!properties) return {};
  return Object.fromEntries(
    Object.keys(properties).map((key) => [key, z.unknown().optional()]),
  );
}

/**
 * Wraps one discovered remote tool as a forwarding registration on
 * Aperator's own in-process McpServer. The namespaced name exists only so
 * it's unique inside Aperator's own tool list — the handler calls the
 * remote server using remoteTool.name alone, the name it actually knows.
 * Input/output schemas are a permissive pass-through built from the
 * remote's own declared property names (CLAUDE.md/design spec: the remote
 * server is the authoritative validator for its own tool, not Aperator).
 */
export function createMcpProxyTool(
  integrationId: string,
  url: string,
  token: string,
  remoteTool: DiscoveredMcpTool,
) {
  const inputSchema = buildPassthroughShape(remoteTool.inputSchema.properties);

  return {
    name: buildMcpToolName(integrationId, remoteTool.name),
    description: remoteTool.description,
    inputSchema,
    outputSchema: {},
    handler: async (args: Record<string, unknown>) => {
      try {
        const result = await callExternalMcpTool(
          url,
          token,
          remoteTool.name,
          args,
        );
        if (result.isError) {
          const firstBlock = Array.isArray(result.content)
            ? result.content[0]
            : undefined;
          const message =
            firstBlock && firstBlock.type === "text"
              ? firstBlock.text
              : "The external tool returned an error.";
          return toolError(message);
        }
        return toolSuccess(
          (result.structuredContent as Record<string, unknown>) ?? {
            content: result.content,
          },
        );
      } catch (error) {
        return toolError(
          error instanceof Error
            ? error.message
            : "The external MCP server could not be reached.",
        );
      }
    },
  };
}
```

- [ ] **Step 4: Wire it into createMcpServer**

```typescript
// lib/mcp/server.ts
// Add this import:
import { createMcpProxyTool } from "@/lib/mcp/tools/mcp-proxy-tool";
import * as integrationRepository from "@/lib/integrations/integration-repository";
import { MCP_PROVIDER } from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";

// Add this step at the end of createMcpServer, just before `return server;`:
// Discovered tools from connected external MCP servers — proxied here,
// one registration per cached tool, so every existing tool-call path
// (grant checks, policy checks, ToolCall/RunStep recording) applies to
// them exactly as it does to any built-in tool. One connection failing
// to load must never break another connection's tools or the built-in
// ones (see the design spec's error-handling section) — each
// connection's registration is wrapped so a bad row can't take down the
// rest of the server build.
const mcpConnections = await integrationRepository.findIntegrationsByProvider(
  organisationId,
  MCP_PROVIDER,
);
for (const connection of mcpConnections) {
  try {
    const config = connection.config as {
      url: string;
      tools: DiscoveredMcpTool[];
    };
    const token = connection.credentials?.token as string | undefined;
    if (!token) continue;
    for (const remoteTool of config.tools) {
      register(
        createMcpProxyTool(connection.id, config.url, token, remoteTool),
        remoteTool.readOnlyHint === true ? readOnly : undefined,
      );
    }
  } catch {
    // Malformed cached config on this one row — skip it, don't fail the
    // whole server build over one bad connection.
    continue;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/mcp-proxy-tools.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full suite, including the pre-existing tool-count test**

Run: `pnpm test`
Expected: PASS. `tests/integration/mcp-tools.test.ts`'s "lists exactly the
thirteen registered tools" test must still pass unchanged — it asserts on
the fixed, built-in tool list only; an org with no `mcp`-provider
Integrations registers zero proxy tools, so that count is untouched by
this task.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/tools/mcp-proxy-tool.ts lib/mcp/server.ts tests/integration/mcp-proxy-tools.test.ts
git commit -m "feat: proxy discovered mcp tools onto the in-process tool server"
```

---

## Task 6: Grant validation — AgentTool accepts discovered names

**Files:**

- Modify: `lib/agents/schemas.ts`
- Modify: `lib/agents/agent-service.ts`
- Test: `tests/integration/agent-tool-grant-validation.test.ts`

**Interfaces:**

- Consumes: `findMcpTool` (Task 3), `parseMcpToolName` (Task 1),
  `TOOL_NAMES` (existing, `lib/mcp/tool-registry.ts`).
- Produces: `agentInputSchema`'s `toolNames` field now accepts any
  non-empty string (was `z.enum(TOOL_NAMES)`) — the real check moves to a
  new async function, `validateToolGrants(organisationId: string,
toolNames: string[]): Promise<void>` (throws `Error` naming the first
  invalid tool), called from both `agentService.createAgent` and
  `agentService.updateAgent` before anything is written, in the same
  position `validateActionIntegration` already runs.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/agent-tool-grant-validation.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import * as agentService from "@/lib/agents/agent-service";
import { prisma } from "@/lib/db/prisma";
import * as integrationService from "@/lib/integrations/integration-service";

const baseAgentInput = {
  name: "Test Agent",
  description: "A test agent.",
  instructions: "Do things.",
  model: "test-model",
  keywords: [] as string[],
  replySubjectTemplate: null,
  extractionFields: [] as never[],
  guardrailKeywords: [] as string[],
  actionIntegrationId: null,
  pipelineConfig: {} as Record<string, unknown>,
  executionMode: "LOOP" as const,
  pipelineKey: null,
};

describe("agent tool grant validation", () => {
  const organisationId = "test-org-grant-validation";

  beforeAll(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Grant Validation Test Org",
      },
    });
  });

  afterAll(async () => {
    await prisma.agentTool.deleteMany({
      where: { agent: { organisationId } },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.agentTool.deleteMany({
      where: { agent: { organisationId } },
    });
    await prisma.agent.deleteMany({ where: { organisationId } });
  });

  it("still accepts a fixed built-in tool name", async () => {
    const agent = await agentService.createAgent(organisationId, {
      ...baseAgentInput,
      toolNames: ["find_record"],
    });
    expect(agent.id).toBeDefined();
  });

  it("rejects a made-up tool name that matches neither shape", async () => {
    await expect(
      agentService.createAgent(organisationId, {
        ...baseAgentInput,
        toolNames: ["not_a_real_tool"],
      }),
    ).rejects.toThrow(/not a valid tool/i);
  });

  it("accepts a real discovered mcp tool name for this organisation", async () => {
    // Directly seeds a connected mcp Integration with a cached tool list
    // (Task 3's live-connect path is exercised in its own test file) —
    // this test is only about the grant-validation boundary.
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "mcp",
        name: "Test Server",
        config: {
          url: "https://example.test/mcp",
          tools: [
            {
              name: "search",
              description: "",
              inputSchema: { type: "object" },
              readOnlyHint: true,
            },
          ],
        },
        credentials: null,
      },
    });
    const integration = await prisma.integration.findFirstOrThrow({
      where: { organisationId, provider: "mcp" },
    });

    const agent = await agentService.createAgent(organisationId, {
      ...baseAgentInput,
      toolNames: [`mcp:${integration.id}:search`],
    });
    expect(agent.id).toBeDefined();
  });

  it("rejects an mcp tool name for a connection that doesn't have it", async () => {
    const integration = await prisma.integration.create({
      data: {
        organisationId,
        provider: "mcp",
        name: "Test Server",
        config: { url: "https://example.test/mcp", tools: [] },
        credentials: null,
      },
    });

    await expect(
      agentService.createAgent(organisationId, {
        ...baseAgentInput,
        toolNames: [`mcp:${integration.id}:search`],
      }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("rejects an mcp tool name copied from a different organisation's connection", async () => {
    const otherOrgId = "test-org-grant-validation-other";
    await prisma.organisation.create({
      data: { id: otherOrgId, clerkOrgId: otherOrgId, name: "Other Org" },
    });
    const otherIntegration = await prisma.integration.create({
      data: {
        organisationId: otherOrgId,
        provider: "mcp",
        name: "Other Org's Server",
        config: {
          url: "https://example.test/mcp",
          tools: [
            {
              name: "search",
              description: "",
              inputSchema: { type: "object" },
              readOnlyHint: true,
            },
          ],
        },
        credentials: null,
      },
    });

    await expect(
      agentService.createAgent(organisationId, {
        ...baseAgentInput,
        toolNames: [`mcp:${otherIntegration.id}:search`],
      }),
    ).rejects.toThrow(/does not exist/i);

    await prisma.integration.deleteMany({
      where: { organisationId: otherOrgId },
    });
    await prisma.organisation.deleteMany({ where: { id: otherOrgId } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/agent-tool-grant-validation.test.ts`
Expected: FAIL on the "rejects a made-up tool name" test — `toolNames` is
currently `z.enum(TOOL_NAMES)` so it already fails validation for the
_wrong_ reason, or the mcp-shaped ones fail entirely since nothing
validates them at all. Confirms the current gap this task closes.

- [ ] **Step 3: Loosen the Zod schema**

```typescript
// lib/agents/schemas.ts
// Change:
//   toolNames: z.array(z.enum(TOOL_NAMES)).default([]),
// to:
    toolNames: z.array(z.string().min(1)).default([]),
```

The `TOOL_NAMES` import in this file may now be unused if nothing else in
it references it — check with `grep -n "TOOL_NAMES" lib/agents/schemas.ts`
and remove the import only if so (the fixed-registry check itself moves to
`agent-service.ts` in the next step, which needs its own import).

- [ ] **Step 4: Add validateToolGrants to agent-service.ts**

```typescript
// lib/agents/agent-service.ts
// Add these imports:
import * as integrationService from "@/lib/integrations/integration-service";
import { parseMcpToolName } from "@/lib/integrations/mcp/tool-naming";
import { TOOL_NAMES } from "@/lib/mcp/tool-registry";

// Add this function near validateActionIntegration:
async function validateToolGrants(
  organisationId: string,
  toolNames: string[],
): Promise<void> {
  for (const toolName of toolNames) {
    if ((TOOL_NAMES as readonly string[]).includes(toolName)) continue;

    const parsed = parseMcpToolName(toolName);
    if (!parsed) {
      throw new Error(`"${toolName}" is not a valid tool.`);
    }

    const tool = await integrationService.findMcpTool(
      organisationId,
      parsed.integrationId,
      parsed.remoteToolName,
    );
    if (!tool) {
      throw new Error(
        `"${toolName}" does not exist on any of this organisation's connected MCP servers.`,
      );
    }
  }
}

// Call it at the top of both createAgent and updateAgent, in the same
// position validateActionIntegration already runs — e.g. for createAgent:
export async function createAgent(organisationId: string, input: AgentInput) {
  const { toolNames, ...agentColumns } = input;
  await validateActionIntegration(organisationId, input.actionIntegrationId);
  await validateToolGrants(organisationId, toolNames);
  const agent = await agentRepository.createAgent(organisationId, agentColumns);
  await agentToolRepository.setToolsForAgent(agent.id, toolNames);
  return agent;
}

// ...and the equivalent single added line in updateAgent, right after its
// own validateActionIntegration call.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/agent-tool-grant-validation.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Run typecheck and the full suite**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/agents/schemas.ts lib/agents/agent-service.ts tests/integration/agent-tool-grant-validation.test.ts
git commit -m "feat: validate discovered mcp tool grants against the org's own connections"
```

---

**Backend is now complete and independently shippable** (Tasks 1–6) — a
connected MCP server's tools are discoverable, proxied, gated, and
grantable end to end via direct service/repository calls, all covered by
tests. Tasks 7–8 add the UI. Matches this session's own established
pattern (the chat orchestrator shipped as a backend PR, then a UI PR) —
consider merging Tasks 1–6 before starting Task 7.

---

## Task 7: Settings UI — connect a server, refresh its tools

**Files:**

- Modify: `app/(shell)/(app)/settings/actions.ts`
- Create: `components/settings/mcp-server-connect-form.tsx`
- Modify: `components/settings/integrations-section.tsx`

**Interfaces:**

- Consumes: `connectMcpServer`, `refreshMcpServerTools` (Task 3).
- Produces: `createMcpServerAccountAction(_prevState: McpServerFormState,
formData: FormData): Promise<McpServerFormState>`,
  `refreshMcpServerToolsAction(integrationId: string): Promise<void>`.

Mirrors `WebhookAccountForm`/`createWebhookAccountAction`'s existing shape
exactly (same file, same `useActionState` pattern) — the only genuinely
new UI concept is showing the discovered tool count/list back to the user
on success, and a "Refresh tools" action on each connected row.

- [ ] **Step 1: Add the server action**

```typescript
// app/(shell)/(app)/settings/actions.ts
// Add alongside createWebhookAccountAction:

export type McpServerFormState = {
  error?: string;
  connected?: { integrationId: string; toolCount: number };
};

export async function createMcpServerAccountAction(
  _prevState: McpServerFormState,
  formData: FormData,
): Promise<McpServerFormState> {
  const label = formData.get("label");
  const url = formData.get("url");
  const token = formData.get("token");
  if (typeof label !== "string" || label.trim().length === 0) {
    return { error: "Label is required." };
  }
  if (typeof url !== "string" || url.trim().length === 0) {
    return { error: "URL is required." };
  }
  if (typeof token !== "string" || token.trim().length === 0) {
    return { error: "Bearer token is required." };
  }

  const organisation = await getCurrentOrganisation();
  try {
    const integration = await integrationService.connectMcpServer(
      organisation.id,
      { label: label.trim(), url: url.trim(), token: token.trim() },
    );
    const toolCount = (integration.config as { tools: unknown[] }).tools.length;
    return { connected: { integrationId: integration.id, toolCount } };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? `Couldn't connect: ${error.message}`
          : "Couldn't connect to that MCP server.",
    };
  }
}

export async function refreshMcpServerToolsAction(
  integrationId: string,
): Promise<void> {
  const organisation = await getCurrentOrganisation();
  await integrationService.refreshMcpServerTools(
    organisation.id,
    integrationId,
  );
  revalidatePath("/settings/integrations");
}
```

Check the top of this file for an existing `revalidatePath` import from
`next/cache` — add it if not already present (`disconnectIntegrationAction`
likely already revalidates this same path; reuse the identical string).

- [ ] **Step 2: Build the connect form component**

```typescript
// components/settings/mcp-server-connect-form.tsx
"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createMcpServerAccountAction,
  type McpServerFormState,
} from "@/app/(shell)/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Connecting…" : "Connect"}
    </Button>
  );
}

export function McpServerConnectForm() {
  const [state, formAction] = useActionState<McpServerFormState, FormData>(
    createMcpServerAccountAction,
    {},
  );

  if (state.connected) {
    return (
      <p className="text-sm text-success">
        Connected — {state.connected.toolCount} tool
        {state.connected.toolCount === 1 ? "" : "s"} discovered and ready to
        grant to your agents.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="mcpLabel">Label</Label>
        <Input
          id="mcpLabel"
          name="label"
          placeholder="e.g. Notion"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mcpUrl">Server URL</Label>
        <Input
          id="mcpUrl"
          name="url"
          type="url"
          placeholder="https://example.com/mcp"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mcpToken">Bearer token</Label>
        <Input id="mcpToken" name="token" type="password" required />
      </div>
      <SubmitButton />
    </form>
  );
}
```

- [ ] **Step 3: Wire it into the dispatch and add a refresh action**

```typescript
// components/settings/integrations-section.tsx
// Add the import:
import { McpServerConnectForm } from "@/components/settings/mcp-server-connect-form";
import { refreshMcpServerToolsAction } from "@/app/(shell)/(app)/settings/actions";

// In ConnectOrAddAccount, change:
//   if (provider === "webhook") {
//     return <WebhookAccountForm baseUrl={baseUrl} />;
//   }
//   return null;
// to:
  if (provider === "webhook") {
    return <WebhookAccountForm baseUrl={baseUrl} />;
  }
  if (provider === "mcp") {
    return <McpServerConnectForm />;
  }
  return null;

// In ConfigureDialog's per-account row (alongside the existing disconnect
// form), add a refresh button only for mcp-provider accounts — this
// component needs an `entry`/`provider` value in scope already (it's
// rendered per-registry-entry); add the same conditional there:
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
            >
              <span className="font-mono">{account.name}</span>
              <div className="flex items-center gap-2">
                {entry.provider === "mcp" && (
                  <form
                    action={refreshMcpServerToolsAction.bind(
                      null,
                      account.id,
                    )}
                  >
                    <Button type="submit" variant="outline" size="sm">
                      Refresh tools
                    </Button>
                  </form>
                )}
                {/* ...existing disconnect form stays exactly as it is... */}
              </div>
            </div>
          ))}
```

- [ ] **Step 4: Typecheck, lint, format**

Run: `pnpm typecheck && pnpm lint && pnpm format`
Expected: all clean.

- [ ] **Step 5: Live-verify in browser**

Start the dev server (`pnpm dev`), navigate to Settings → Integrations,
open "Custom MCP server," connect a real or locally-run test MCP server
(the same fixture pattern from Task 2's test works as a quick throwaway
script if no real one is handy), confirm the discovered tool count shows,
and confirm "Refresh tools" re-runs without error. Take the screenshot
this repo's own workflow rule requires before a PR (see the frontend-dirty
hook).

- [ ] **Step 6: Commit**

```bash
git add app/\(shell\)/\(app\)/settings/actions.ts components/settings/mcp-server-connect-form.tsx components/settings/integrations-section.tsx
git commit -m "feat: add the connect-a-custom-MCP-server settings UI"
```

---

## Task 8: Agent editor UI — grant discovered tools

**Files:**

- Modify: `components/agents/agent-form.tsx`
- Modify: wherever the agent form's server component fetches props today
  (`app/(shell)/(app)/agents/new/page.tsx` and
  `app/(shell)/(app)/agents/[id]/edit/page.tsx`) to also pass the org's
  connected `mcp` integrations and their cached tools

**Interfaces:**

- Consumes: `listIntegrationsByProvider` (existing,
  `integration-service.ts`), `buildMcpToolName` (Task 1).
- Produces: `AgentForm` gains one new optional prop,
  `mcpConnections: {id: string; label: string; tools: DiscoveredMcpTool[]}[]`.

Renders one more group per connected MCP integration in the Tools &
Permissions section, right after the existing `TOOL_GROUPS.map(...)`
block — same checkbox markup, same `name="toolNames"` field, just a
dynamic source instead of the fixed `TOOL_REGISTRY`.

- [ ] **Step 1: Thread the new data through `app/(shell)/(app)/agents/new/page.tsx`**

Both page files already `Promise.all` a `listIntegrationsByProvider` call
for `"gmail"` — add a second, parallel call for `"mcp"` right alongside it,
in both files, rather than a sequential second `await`.

```typescript
// app/(shell)/(app)/agents/new/page.tsx — replace the whole file with:
import { createAgentAction } from "@/app/(shell)/(app)/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import * as templateService from "@/lib/agents/template-service";
import * as integrationService from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function NewAgentPage({
  searchParams,
}: PageProps<"/agents/new">) {
  const { template: templateId } = await searchParams;
  const organisation = await getCurrentOrganisation();
  const [templates, gmailIntegrations, mcpIntegrations] = await Promise.all([
    templateService.listTemplates(organisation.id),
    integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
    integrationService.listIntegrationsByProvider(organisation.id, "mcp"),
  ]);

  const preselectedTemplate =
    typeof templateId === "string"
      ? templates.find((t) => t.id === templateId)
      : undefined;

  const mcpConnections = mcpIntegrations.map((integration) => ({
    id: integration.id,
    label: integration.name,
    tools:
      (integration.config as { tools: DiscoveredMcpTool[] }).tools ?? [],
  }));

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Create agent</h1>
      <AgentForm
        action={createAgentAction}
        submitLabel="Create agent"
        templates={templates}
        preselectedTemplate={preselectedTemplate}
        gmailIntegrations={gmailIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
        mcpConnections={mcpConnections}
      />
    </div>
  );
}
```

- [ ] **Step 2: Thread the same data through `app/(shell)/(app)/agents/[id]/edit/page.tsx`**

```typescript
// app/(shell)/(app)/agents/[id]/edit/page.tsx — replace the whole file with:
import { notFound } from "next/navigation";

import { updateAgentAction } from "@/app/(shell)/(app)/agents/actions";
import { AgentForm } from "@/components/agents/agent-form";
import * as agentService from "@/lib/agents/agent-service";
import * as templateService from "@/lib/agents/template-service";
import * as integrationService from "@/lib/integrations/integration-service";
import type { DiscoveredMcpTool } from "@/lib/integrations/mcp/tool-naming";
import { getCurrentOrganisation } from "@/lib/organisations/current-organisation";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({
  params,
}: PageProps<"/agents/[id]/edit">) {
  const { id } = await params;
  const organisation = await getCurrentOrganisation();
  const [agent, templates, gmailIntegrations, mcpIntegrations] =
    await Promise.all([
      agentService.getAgent(organisation.id, id),
      templateService.listTemplates(organisation.id),
      integrationService.listIntegrationsByProvider(organisation.id, "gmail"),
      integrationService.listIntegrationsByProvider(organisation.id, "mcp"),
    ]);

  if (!agent) {
    notFound();
  }

  const initialStepsConfig =
    agent.pipelineKey === "steps" &&
    agent.pipelineConfig &&
    typeof agent.pipelineConfig === "object" &&
    !Array.isArray(agent.pipelineConfig)
      ? (agent.pipelineConfig as Record<string, unknown>)
      : undefined;

  const mcpConnections = mcpIntegrations.map((integration) => ({
    id: integration.id,
    label: integration.name,
    tools:
      (integration.config as { tools: DiscoveredMcpTool[] }).tools ?? [],
  }));

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Edit {agent.name}</h1>
      <AgentForm
        action={updateAgentAction.bind(null, agent.id)}
        agent={{
          ...agent,
          toolNames: agent.tools.map((t) => t.toolName),
        }}
        submitLabel="Save changes"
        templates={templates}
        gmailIntegrations={gmailIntegrations.map((i) => ({
          id: i.id,
          name: i.name,
        }))}
        initialStepsConfig={initialStepsConfig}
        mcpConnections={mcpConnections}
      />
    </div>
  );
}
```

- [ ] **Step 3: Accept the prop in `AgentForm` and render the dynamic groups**

`components/agents/agent-form.tsx` line 137's `export function AgentForm({`
destructures `gmailIntegrations = []` at line 142 with the matching type
at line 155 (`gmailIntegrations?: { id: string; name: string }[];`) — add
`mcpConnections` the same way, right next to it:

```typescript
// components/agents/agent-form.tsx
// Add to the imports at the top of the file:
import {
  buildMcpToolName,
  type DiscoveredMcpTool,
} from "@/lib/integrations/mcp/tool-naming";

// Change the destructuring at line 137-145 from:
//   export function AgentForm({
//     action,
//     agent,
//     submitLabel,
//     templates = [],
//     gmailIntegrations = [],
//     initialStepsConfig,
//     preselectedTemplate,
//   }: {
// to:
export function AgentForm({
  action,
  agent,
  submitLabel,
  templates = [],
  gmailIntegrations = [],
  mcpConnections = [],
  initialStepsConfig,
  preselectedTemplate,
}: {

// And add this line to the props type, right after the existing
// `gmailIntegrations?: { id: string; name: string }[];` at line 155:
  mcpConnections?: {
    id: string;
    label: string;
    tools: DiscoveredMcpTool[];
  }[];
```

Then, in the Tools & Permissions section (lines 445–478), immediately
after the `{TOOL_GROUPS.map((group) => (...))}` block's closing `))}` at
line 478 and before the enclosing `</div>` at line 479, add:
{(mcpConnections ?? []).map((connection) => (
<div key={connection.id} className="flex flex-col gap-2">
<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
{connection.label}
</span>
{connection.tools.map((tool) => {
const fullName = buildMcpToolName(
connection.id,
tool.name,
);
return (
<label
key={fullName}
className="flex items-start gap-2 text-sm"
htmlFor={`tool-${fullName}`} >
<input
type="checkbox"
id={`tool-${fullName}`}
name="toolNames"
value={fullName}
checked={toolNames.has(fullName)}
onChange={(e) =>
toggleTool(fullName, e.target.checked)
}
className="mt-0.5 h-4 w-4 rounded border-border"
/>
<span className="flex flex-col">
<span className="font-medium">{tool.name}</span>
<span className="text-muted-foreground">
{tool.description}
</span>
</span>
</label>
);
})}
</div>
))}

````

`toolNames`/`toggleTool` are the same state and handler the existing
`TOOL_REGISTRY`-driven checkboxes already use — no new state needed, this
block only adds more checkboxes writing into the same `Set<string>`.

- [ ] **Step 4: Typecheck, lint, format**

Run: `pnpm typecheck && pnpm lint && pnpm format`
Expected: all clean.

- [ ] **Step 5: Live-verify in browser**

With a real connected MCP server from Task 7's verification still in
place, open the agent editor's Tools & Permissions section, confirm the
new group with its real tool names/descriptions appears, tick one, save,
and confirm the grant round-trips (reload the edit page, the checkbox is
still ticked). Then confirm a run of that agent using the tool actually
reaches the remote server — the true end-to-end proof this whole plan
exists to deliver.

- [ ] **Step 6: Commit**

```bash
git add components/agents/agent-form.tsx "app/(shell)/(app)/agents/new/page.tsx" "app/(shell)/(app)/agents/[id]/edit/page.tsx"
git commit -m "feat: grant discovered mcp tools from the agent editor"
````

---

## Final verification (not a task — a checklist before opening any PR)

- [ ] `pnpm typecheck && pnpm lint && pnpm format:check` all clean
- [ ] `pnpm test` — full suite passes, run twice to rule out flakiness
      (this session's own established bar)
- [ ] `pnpm build` succeeds
- [ ] Live end-to-end in browser: connect a real external MCP server →
      grant one of its tools to an agent → run the agent with input that
      requires that tool → confirm the call actually reaches the remote
      server and its real result reaches the agent's reply → confirm a
      _non_-read-only (or unhinted) discovered tool call instead pauses
      for approval and creates a real `Approval` row, never executing
      before that approval is granted
- [ ] Disconnect the MCP server mid-test, confirm the agent's _other_
      tools (built-in and any other connection's) still work normally
