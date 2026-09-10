import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

function connectedOutlookCredentials() {
  return encryptToken(
    JSON.stringify({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    }),
  );
}

describe("new Outlook tools", () => {
  const organisationId = "test-org-outlook-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Outlook New Tools Test Org",
      },
    });
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "outlook",
        name: "test@company.test",
        credentials: connectedOutlookCredentials(),
        config: {
          grantedScopes: [
            "https://graph.microsoft.com/Mail.ReadWrite",
            "https://graph.microsoft.com/Mail.Send",
            "https://graph.microsoft.com/Contacts.ReadWrite",
          ],
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

  function stubGraphFetch(
    handler: (path: string, init?: RequestInit) => Response | null,
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = new URL(url).pathname + new URL(url).search;
        const response = handler(path, init);
        if (!response) throw new Error(`Unexpected fetch to ${url}`);
        return response;
      }),
    );
  }

  it("OUTLOOK_SEARCH_INBOX searches within the Aperator folder", async () => {
    stubGraphFetch((path) => {
      if (
        path.endsWith("/mailFolders?%24filter=displayName+eq+%27Aperator%27")
      ) {
        return new Response(JSON.stringify({ value: [{ id: "folder-1" }] }), {
          status: 200,
        });
      }
      if (path.includes("/mailFolders/folder-1/messages")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      return null;
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "OUTLOOK_SEARCH_INBOX",
      arguments: { query: "invoice" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ messages: [] });
    await client.close();
  });

  it("OUTLOOK_ARCHIVE_MESSAGE moves the message to the archive folder", async () => {
    let capturedBody = "";
    stubGraphFetch((path, init) => {
      if (path.endsWith("/messages/msg-1/move")) {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return null;
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "OUTLOOK_ARCHIVE_MESSAGE",
      arguments: { messageId: "msg-1" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(capturedBody)).toEqual({ destinationId: "archive" });
    await client.close();
  });

  it("OUTLOOK_CREATE_DRAFT never calls sendMail", async () => {
    const calledPaths: string[] = [];
    stubGraphFetch((path) => {
      calledPaths.push(path);
      if (path.endsWith("/messages")) {
        return new Response(JSON.stringify({ id: "draft-1" }), {
          status: 200,
        });
      }
      return null;
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "OUTLOOK_CREATE_DRAFT",
      arguments: {
        to: "customer@example.test",
        subject: "Hello",
        body: "Hi there.",
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ draftId: "draft-1" });
    expect(calledPaths.some((p) => p.endsWith("/sendMail"))).toBe(false);
    await client.close();
  });

  it("OUTLOOK_FIND_CONTACT and OUTLOOK_CREATE_CONTACT both work against Contacts.ReadWrite", async () => {
    stubGraphFetch((path, init) => {
      if (path.includes("/contacts?") && (!init || !init.method)) {
        return new Response(
          JSON.stringify({
            value: [
              {
                id: "c1",
                displayName: "Jane Doe",
                emailAddresses: [{ address: "jane@example.test" }],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (path.endsWith("/contacts") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "c2" }), { status: 200 });
      }
      return null;
    });

    const client = await connectClient();
    const found = await client.callTool({
      name: "OUTLOOK_FIND_CONTACT",
      arguments: { query: "Jane" },
    });
    expect(found.isError).toBeFalsy();
    expect(found.structuredContent).toEqual({
      contacts: [
        { id: "c1", displayName: "Jane Doe", email: "jane@example.test" },
      ],
    });

    const created = await client.callTool({
      name: "OUTLOOK_CREATE_CONTACT",
      arguments: { displayName: "John Smith", email: "john@example.test" },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent).toEqual({ contactId: "c2" });
    await client.close();
  });

  it("is denied when the connected account only has Mail.Read, not Mail.ReadWrite", async () => {
    await prisma.integration.updateMany({
      where: { organisationId, provider: "outlook" },
      data: {
        config: {
          grantedScopes: ["https://graph.microsoft.com/Mail.Read"],
        },
      },
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "OUTLOOK_ARCHIVE_MESSAGE",
      arguments: { messageId: "msg-1" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
