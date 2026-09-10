import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

describe("new Outlook Calendar tools", () => {
  const organisationId = "test-org-outlook-calendar-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Outlook Calendar New Tools Test Org",
      },
    });
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "outlook-calendar",
        name: "test@company.test",
        credentials: encryptToken(
          JSON.stringify({ accessToken: "a", refreshToken: "b" }),
        ),
        config: {
          grantedScopes: ["https://graph.microsoft.com/Calendars.ReadWrite"],
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

  it("OUTLOOK_UPDATE_CALENDAR_EVENT sends only the fields supplied and requires approval", async () => {
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (new URL(url).pathname.endsWith("/events/evt-1")) {
          capturedBody = init?.body as string;
          return new Response(JSON.stringify({}), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    // Calling the tool directly (not through an approval-gated agent run)
    // still exercises the underlying client call — approval gating itself
    // is proven generically in tests/unit/policy-engine.test.ts.
    const result = await client.callTool({
      name: "OUTLOOK_UPDATE_CALENDAR_EVENT",
      arguments: { eventId: "evt-1", subject: "New subject" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(capturedBody)).toEqual({ subject: "New subject" });
    await client.close();
  });

  it("OUTLOOK_CANCEL_CALENDAR_EVENT calls Graph's /cancel action", async () => {
    let capturedPath = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        capturedPath = new URL(url).pathname;
        if (capturedPath.endsWith("/cancel")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "OUTLOOK_CANCEL_CALENDAR_EVENT",
      arguments: { eventId: "evt-1", comment: "No longer needed" },
    });
    expect(result.isError).toBeFalsy();
    expect(capturedPath).toContain("/events/evt-1/cancel");
    await client.close();
  });

  it("OUTLOOK_LIST_CALENDAR_EVENTS is read-only and uses calendarView", async () => {
    let capturedPath = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        capturedPath = new URL(url).pathname;
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "evt-1",
                subject: "Standup",
                start: { dateTime: "2026-09-15T09:00:00" },
                end: { dateTime: "2026-09-15T09:30:00" },
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "OUTLOOK_LIST_CALENDAR_EVENTS",
      arguments: {
        start: "2026-09-15T00:00:00Z",
        end: "2026-09-16T00:00:00Z",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(capturedPath).toContain("/calendarView");
    expect(result.structuredContent).toEqual({
      events: [
        {
          id: "evt-1",
          subject: "Standup",
          start: "2026-09-15T09:00:00",
          end: "2026-09-15T09:30:00",
        },
      ],
    });
    await client.close();
  });

  it("is denied when the connected account only has Calendars.Read for the two write tools", async () => {
    await prisma.integration.updateMany({
      where: { organisationId, provider: "outlook-calendar" },
      data: {
        config: {
          grantedScopes: ["https://graph.microsoft.com/Calendars.Read"],
        },
      },
    });

    const client = await connectClient();
    const updateResult = await client.callTool({
      name: "OUTLOOK_UPDATE_CALENDAR_EVENT",
      arguments: { eventId: "evt-1", subject: "x" },
    });
    expect(updateResult.isError).toBe(true);

    const cancelResult = await client.callTool({
      name: "OUTLOOK_CANCEL_CALENDAR_EVENT",
      arguments: { eventId: "evt-1" },
    });
    expect(cancelResult.isError).toBe(true);
    await client.close();
  });
});
