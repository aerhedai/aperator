import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

function connectedGmailCredentials() {
  return encryptToken(
    JSON.stringify({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    }),
  );
}

// read_inbox is the read-only counterpart send_email never had — until it
// existed, nothing could look at what's actually sitting in a connected
// mailbox except the EMAIL trigger's own automatic dispatch. Mocks the raw
// Gmail REST API, same convention as tests/unit/gmail-client.test.ts, since
// this exercises the real client functions end to end through the tool,
// not a stand-in for them.

function gmailMessagePayload(opts: {
  id: string;
  from: string;
  subject: string;
  bodyText: string;
}) {
  return {
    id: opts.id,
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: opts.from },
        { name: "Subject", value: opts.subject },
      ],
      body: { data: Buffer.from(opts.bodyText).toString("base64url") },
    },
  };
}

describe("GMAIL_READ_INBOX tool", () => {
  const organisationId = "test-org-read-inbox";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Read Inbox Test Org",
        currency: "GBP",
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.integration.deleteMany({ where: { organisationId } });
    await prisma.organisation.deleteMany({ where: { id: organisationId } });
  });

  it("lists unread messages with cleaned bodies and an extracted sender address", async () => {
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "gmail",
        name: "test@company.test",
        credentials: connectedGmailCredentials(),
        config: { grantedScopes: ["https://mail.google.com/"] },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const fetchMock = vi.fn(async (url: string | URL) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/messages")) {
        return new Response(JSON.stringify({ messages: [{ id: "msg-1" }] }), {
          status: 200,
        });
      }
      if (path.endsWith("/messages/msg-1")) {
        return new Response(
          JSON.stringify(
            gmailMessagePayload({
              id: "msg-1",
              from: "Jane Doe <jane@customer.test>",
              subject: "Quote request",
              bodyText: "Can I get a quote?\n--\nJane Doe\nSent from my iPhone",
            }),
          ),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const server = await createMcpServer(organisationId);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "GMAIL_READ_INBOX",
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      messages: [
        {
          id: "msg-1",
          from: "Jane Doe <jane@customer.test>",
          senderEmail: "jane@customer.test",
          subject: "Quote request",
          // Signature delimiter and mobile footer both stripped.
          body: "Can I get a quote?",
        },
      ],
    });

    await client.close();
  });

  it("returns a clear error when no email account is connected", async () => {
    const server = await createMcpServer(organisationId);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "GMAIL_READ_INBOX",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("Gmail is not connected"),
      },
    ]);

    await client.close();
  });

  it("never marks anything as read — read-only, no side effects", async () => {
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "gmail",
        name: "test@company.test",
        credentials: connectedGmailCredentials(),
        config: { grantedScopes: ["https://mail.google.com/"] },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      // Marking read is a PATCH/POST modify call — never issued anywhere
      // in this test's flow, only GETs for listing/fetching.
      expect(init?.method ?? "GET").toBe("GET");
      const path = new URL(url).pathname;
      if (path.endsWith("/messages")) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const server = await createMcpServer(organisationId);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "GMAIL_READ_INBOX",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ messages: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await client.close();
  });
});
