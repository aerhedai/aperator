import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

describe("new Teams tools", () => {
  const organisationId = "test-org-teams-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Teams New Tools Test Org",
      },
    });
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "teams",
        name: "test@company.test",
        credentials: encryptToken(
          JSON.stringify({ accessToken: "a", refreshToken: "b" }),
        ),
        config: {
          grantedScopes: ["https://graph.microsoft.com/Group.ReadWrite.All"],
        },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

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

  it("TEAMS_LIST_CHANNELS lists a team's channels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (new URL(url).pathname.endsWith("/teams/team-1/channels")) {
          return new Response(
            JSON.stringify({
              value: [{ id: "ch-1", displayName: "General" }],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "TEAMS_LIST_CHANNELS",
      arguments: { teamId: "team-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      channels: [{ id: "ch-1", displayName: "General" }],
    });
    await client.close();
  });

  it("TEAMS_READ_CHANNEL_MESSAGES reads recent messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (
          new URL(url).pathname.endsWith("/teams/team-1/channels/ch-1/messages")
        ) {
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: "msg-1",
                  from: { user: { displayName: "Jane" } },
                  body: { content: "<p>Hello</p>" },
                  createdDateTime: "2026-09-15T09:00:00Z",
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "TEAMS_READ_CHANNEL_MESSAGES",
      arguments: { teamId: "team-1", channel: "ch-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      messages: [
        {
          id: "msg-1",
          from: "Jane",
          content: "<p>Hello</p>",
          createdDateTime: "2026-09-15T09:00:00Z",
        },
      ],
    });
    await client.close();
  });

  it("is denied when Teams isn't connected at all", async () => {
    await prisma.integration.deleteMany({ where: { organisationId } });
    const client = await connectClient();
    const result = await client.callTool({
      name: "TEAMS_LIST_CHANNELS",
      arguments: { teamId: "team-1" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
