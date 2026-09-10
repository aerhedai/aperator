import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

describe("new SharePoint tools", () => {
  const organisationId = "test-org-sharepoint-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "SharePoint New Tools Test Org",
      },
    });
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "sharepoint",
        name: "test@company.test",
        credentials: encryptToken(
          JSON.stringify({ accessToken: "a", refreshToken: "b" }),
        ),
        config: {
          grantedScopes: ["https://graph.microsoft.com/Sites.ReadWrite.All"],
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

  function withSiteAndDrive(
    extra: (path: string, init?: RequestInit) => Response | null,
  ) {
    return (path: string, init?: RequestInit) => {
      if (path.includes("/sites?search=")) {
        return new Response(
          JSON.stringify({
            value: [{ id: "site-1", displayName: "Projects" }],
          }),
          { status: 200 },
        );
      }
      if (path.endsWith("/sites/site-1/drive")) {
        return new Response(JSON.stringify({ id: "drive-1" }), {
          status: 200,
        });
      }
      return extra(path, init);
    };
  }

  it("SHAREPOINT_SEARCH_FILES resolves the site then searches its drive", async () => {
    stubGraphFetch(
      withSiteAndDrive((path) => {
        if (path.includes("/drives/drive-1/root/search")) {
          return new Response(
            JSON.stringify({ value: [{ id: "f1", name: "Invoice.pdf" }] }),
            { status: 200 },
          );
        }
        return null;
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "SHAREPOINT_SEARCH_FILES",
      arguments: { siteName: "Projects", query: "invoice" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      files: [{ id: "f1", name: "Invoice.pdf", isFolder: false }],
    });
    await client.close();
  });

  it("SHAREPOINT_LIST_FOLDER lists the drive root when no path is given", async () => {
    stubGraphFetch(
      withSiteAndDrive((path) => {
        if (path.includes("/drives/drive-1/items/root/children")) {
          return new Response(JSON.stringify({ value: [] }), { status: 200 });
        }
        return null;
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "SHAREPOINT_LIST_FOLDER",
      arguments: { siteName: "Projects" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ files: [] });
    await client.close();
  });

  it("SHAREPOINT_GET_FILE fetches metadata and content together", async () => {
    stubGraphFetch(
      withSiteAndDrive((path) => {
        if (path.includes("$select=name")) {
          return new Response(JSON.stringify({ name: "doc.txt" }), {
            status: 200,
          });
        }
        if (path.includes("/content")) {
          return new Response("hello world", { status: 200 });
        }
        return null;
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "SHAREPOINT_GET_FILE",
      arguments: { siteName: "Projects", fileId: "f1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      name: "doc.txt",
      contentBase64: Buffer.from("hello world").toString("base64"),
    });
    await client.close();
  });

  it("SHAREPOINT_DELETE_FILE issues a DELETE and requires approval", async () => {
    let capturedMethod = "";
    stubGraphFetch(
      withSiteAndDrive((path, init) => {
        if (path.includes("/drives/drive-1/items/f1")) {
          capturedMethod = init?.method ?? "";
          return new Response(null, { status: 204 });
        }
        return null;
      }),
    );

    const client = await connectClient();
    const result = await client.callTool({
      name: "SHAREPOINT_DELETE_FILE",
      arguments: { siteName: "Projects", fileId: "f1" },
    });
    expect(result.isError).toBeFalsy();
    expect(capturedMethod).toBe("DELETE");
    await client.close();
  });

  it("returns a clear error when the named site doesn't exist", async () => {
    stubGraphFetch((path) => {
      if (path.includes("/sites?search=")) {
        return new Response(JSON.stringify({ value: [] }), { status: 200 });
      }
      return null;
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "SHAREPOINT_SEARCH_FILES",
      arguments: { siteName: "Nonexistent", query: "x" },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining(
          'No SharePoint site matching "Nonexistent"',
        ),
      },
    ]);
    await client.close();
  });
});
