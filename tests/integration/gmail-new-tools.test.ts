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

describe("new Gmail tools", () => {
  const organisationId = "test-org-gmail-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Gmail New Tools Test Org",
      },
    });
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

  it("GMAIL_SEARCH_INBOX ANDs the caller's query with the Aperator label boundary", async () => {
    let capturedPath = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/messages")) {
          capturedPath = parsed.search;
          return new Response(JSON.stringify({ messages: [] }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "GMAIL_SEARCH_INBOX",
      arguments: { query: "invoice" },
    });

    expect(result.isError).toBeFalsy();
    expect(decodeURIComponent(capturedPath)).toContain("label:Aperator");
    expect(decodeURIComponent(capturedPath)).toContain("invoice");
    await client.close();
  });

  it("GMAIL_ARCHIVE_MESSAGE removes the INBOX label", async () => {
    let capturedBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (new URL(url).pathname.endsWith("/modify")) {
          capturedBody = init?.body as string;
          return new Response(JSON.stringify({}), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "GMAIL_ARCHIVE_MESSAGE",
      arguments: { messageId: "msg-1" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ archived: true });
    expect(JSON.parse(capturedBody)).toEqual({ removeLabelIds: ["INBOX"] });
    await client.close();
  });

  it("GMAIL_CREATE_DRAFT never calls the send endpoint", async () => {
    const sendCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const path = new URL(url).pathname;
        sendCalls.push(path);
        if (path.endsWith("/drafts")) {
          return new Response(JSON.stringify({ id: "draft-1" }), {
            status: 200,
          });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "GMAIL_CREATE_DRAFT",
      arguments: {
        to: "customer@example.test",
        subject: "Hello",
        body: "Hi there.",
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ draftId: "draft-1" });
    expect(sendCalls.some((p) => p.endsWith("/messages/send"))).toBe(false);
    await client.close();
  });

  it("GMAIL_APPLY_LABEL creates the label if it doesn't exist, then applies it", async () => {
    const calls: { path: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const path = new URL(url).pathname;
        calls.push({ path, method: init?.method ?? "GET" });
        if (path.endsWith("/labels") && (!init || init.method === undefined)) {
          return new Response(JSON.stringify({ labels: [] }), { status: 200 });
        }
        if (path.endsWith("/labels")) {
          return new Response(JSON.stringify({ id: "label-1" }), {
            status: 200,
          });
        }
        if (path.endsWith("/modify")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "GMAIL_APPLY_LABEL",
      arguments: { messageId: "msg-1", label: "Needs Follow-up" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ applied: true });
    await client.close();
  });

  it("all four new tools are denied when the connected account's granted scope no longer covers Gmail", async () => {
    await prisma.integration.updateMany({
      where: { organisationId, provider: "gmail" },
      data: { config: { grantedScopes: [] } },
    });

    const client = await connectClient();
    for (const name of [
      "GMAIL_SEARCH_INBOX",
      "GMAIL_ARCHIVE_MESSAGE",
      "GMAIL_CREATE_DRAFT",
      "GMAIL_APPLY_LABEL",
    ]) {
      const result = await client.callTool({
        name,
        arguments:
          name === "GMAIL_APPLY_LABEL"
            ? { messageId: "m1", label: "x" }
            : name === "GMAIL_CREATE_DRAFT"
              ? { to: "a@b.test", subject: "s", body: "b" }
              : name === "GMAIL_ARCHIVE_MESSAGE"
                ? { messageId: "m1" }
                : { query: "x" },
      });
      expect(result.isError).toBe(true);
    }
    await client.close();
  });
});
