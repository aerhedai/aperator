import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

const FULL_USER_SCOPES = [
  "chat:write",
  "search:read.public",
  "channels:read",
  "channels:history",
  "users:read",
];

describe("new Slack tools", () => {
  const organisationId = "test-org-slack-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Slack New Tools Test Org",
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  async function connectWithUserToken(userAccessToken: string | null) {
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "slack",
        name: "Test Workspace",
        credentials: encryptToken(
          JSON.stringify({ botToken: "bot-token", userAccessToken }),
        ),
        config: {
          grantedScopes: userAccessToken ? FULL_USER_SCOPES : ["chat:write"],
        },
      },
    });
  }

  async function connectClient() {
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

  it("SLACK_SEARCH_MESSAGES uses the user token, not the bot token", async () => {
    await connectWithUserToken("user-token");
    let capturedAuth: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (new URL(url).pathname.endsWith("/search.messages")) {
          capturedAuth =
            (init?.headers as Record<string, string>)?.Authorization ?? null;
          return new Response(
            JSON.stringify({ ok: true, messages: { matches: [] } }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "SLACK_SEARCH_MESSAGES",
      arguments: { query: "invoice" },
    });
    expect(result.isError).toBeFalsy();
    expect(capturedAuth).toBe("Bearer user-token");
    await client.close();
  });

  it("SLACK_LIST_CHANNELS returns channels from conversations.list", async () => {
    await connectWithUserToken("user-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              channels: [{ id: "c1", name: "general" }],
            }),
            { status: 200 },
          ),
      ),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "SLACK_LIST_CHANNELS",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      channels: [{ id: "c1", name: "general" }],
    });
    await client.close();
  });

  it("SLACK_READ_CHANNEL_HISTORY and SLACK_GET_USER_INFO both work against the user token", async () => {
    await connectWithUserToken("user-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/conversations.history")) {
          return new Response(
            JSON.stringify({
              ok: true,
              messages: [{ user: "u1", text: "hi", ts: "123.456" }],
            }),
            { status: 200 },
          );
        }
        if (path.endsWith("/users.info")) {
          return new Response(
            JSON.stringify({
              ok: true,
              user: {
                id: "u1",
                real_name: "Jane Doe",
                profile: { email: "jane@example.test" },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const history = await client.callTool({
      name: "SLACK_READ_CHANNEL_HISTORY",
      arguments: { channel: "c1" },
    });
    expect(history.isError).toBeFalsy();
    expect(history.structuredContent).toEqual({
      messages: [{ user: "u1", text: "hi", ts: "123.456" }],
    });

    const userInfo = await client.callTool({
      name: "SLACK_GET_USER_INFO",
      arguments: { userId: "u1" },
    });
    expect(userInfo.isError).toBeFalsy();
    expect(userInfo.structuredContent).toEqual({
      id: "u1",
      realName: "Jane Doe",
      email: "jane@example.test",
    });
    await client.close();
  });

  it("is denied by the scope gate — not a crash — when the user declined the user-scope half of the consent screen", async () => {
    // No userAccessToken at all, and only chat:write in grantedScopes —
    // the real shape of a business that approved the bot install but
    // declined the broader user-permission request. ensureScopeAvailable
    // catches this before the tool's own null-token check is ever reached.
    await connectWithUserToken(null);

    const client = await connectClient();
    const result = await client.callTool({
      name: "SLACK_LIST_CHANNELS",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Tool access denied"),
      },
    ]);
    await client.close();
  });

  it("gives a clear reconnect message rather than crashing if the scope says granted but no user token is actually stored", async () => {
    // A data-drift scenario ensureScopeAvailable's own scope check can't
    // catch (the scope genuinely is in grantedScopes) — exercises the
    // tool handler's own defensive null check on the token itself.
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "slack",
        name: "Test Workspace",
        credentials: encryptToken(
          JSON.stringify({ botToken: "bot-token", userAccessToken: null }),
        ),
        config: { grantedScopes: FULL_USER_SCOPES },
      },
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "SLACK_LIST_CHANNELS",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("weren't granted when it was connected"),
      },
    ]);
    await client.close();
  });
});
