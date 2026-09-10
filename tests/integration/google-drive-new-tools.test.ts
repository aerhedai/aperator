import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptToken } from "@/lib/crypto/token-cipher";
import { prisma } from "@/lib/db/prisma";
import { createMcpServer } from "@/lib/mcp/server";

describe("new Google Drive tools", () => {
  const organisationId = "test-org-google-drive-new-tools";

  beforeEach(async () => {
    await prisma.organisation.create({
      data: {
        id: organisationId,
        clerkOrgId: organisationId,
        name: "Google Drive New Tools Test Org",
      },
    });
    await prisma.integration.create({
      data: {
        organisationId,
        provider: "google-drive",
        name: "test@company.test",
        credentials: encryptToken(
          JSON.stringify({ accessToken: "a", refreshToken: "b" }),
        ),
        config: {
          grantedScopes: ["https://www.googleapis.com/auth/drive"],
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

  function stubDriveFetch(
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

  it("GOOGLE_DRIVE_SEARCH_FILES searches by fullText, excluding trashed files", async () => {
    let capturedPath = "";
    stubDriveFetch((path) => {
      capturedPath = path;
      return new Response(
        JSON.stringify({
          files: [
            { id: "f1", name: "Invoice.pdf", mimeType: "application/pdf" },
          ],
        }),
        { status: 200 },
      );
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_SEARCH_FILES",
      arguments: { query: "invoice" },
    });
    expect(result.isError).toBeFalsy();
    const decoded = decodeURIComponent(capturedPath.replace(/\+/g, " "));
    expect(decoded).toContain("fullText contains");
    expect(decoded).toContain("trashed=false");
    await client.close();
  });

  it("GOOGLE_DRIVE_LIST_FOLDER lists root when no path is given", async () => {
    let capturedPath = "";
    stubDriveFetch((path) => {
      capturedPath = path;
      return new Response(JSON.stringify({ files: [] }), { status: 200 });
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_LIST_FOLDER",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    expect(decodeURIComponent(capturedPath.replace(/\+/g, " "))).toContain(
      "'root' in parents",
    );
    await client.close();
  });

  it("GOOGLE_DRIVE_GET_FILE fetches metadata and content together", async () => {
    stubDriveFetch((path) => {
      if (path.includes("fields=id%2Cname%2CmimeType")) {
        return new Response(
          JSON.stringify({ id: "f1", name: "doc.txt", mimeType: "text/plain" }),
          { status: 200 },
        );
      }
      if (path.includes("alt=media")) {
        return new Response("hello world", { status: 200 });
      }
      return null;
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_GET_FILE",
      arguments: { fileId: "f1" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      name: "doc.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("hello world").toString("base64"),
    });
    await client.close();
  });

  it("GOOGLE_DRIVE_DELETE_FILE trashes rather than permanently deletes, and requires approval", async () => {
    let capturedBody = "";
    let capturedMethod = "";
    stubDriveFetch((path, init) => {
      capturedMethod = init?.method ?? "";
      capturedBody = (init?.body as string) ?? "";
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_DELETE_FILE",
      arguments: { fileId: "f1" },
    });
    expect(result.isError).toBeFalsy();
    expect(capturedMethod).toBe("PATCH");
    expect(JSON.parse(capturedBody)).toEqual({ trashed: true });
    await client.close();
  });

  it("GOOGLE_DRIVE_SHARE_FILE grants access via a permissions POST", async () => {
    let capturedBody = "";
    stubDriveFetch((path, init) => {
      if (path.includes("/permissions")) {
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return null;
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_SHARE_FILE",
      arguments: { fileId: "f1", email: "colleague@example.test" },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(capturedBody)).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "colleague@example.test",
    });
    await client.close();
  });

  it("is denied for all five when Google Drive's scope has been revoked", async () => {
    await prisma.integration.updateMany({
      where: { organisationId, provider: "google-drive" },
      data: { config: { grantedScopes: [] } },
    });

    const client = await connectClient();
    const result = await client.callTool({
      name: "GOOGLE_DRIVE_SEARCH_FILES",
      arguments: { query: "x" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});
