import { afterEach, describe, expect, it, vi } from "vitest";

import { createCallApiTool } from "@/lib/mcp/tools/call-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Typed accessors for the two shapes these tests actually inspect —
// fetch's real call signature and CallToolResult's real content-block
// union are both wider than what a test needs, so these narrow just
// enough to keep assertions readable without `as any` at every call site.
function lastFetchCall(
  fetchSpy: ReturnType<typeof vi.fn>,
): [URL, { method: string; headers: Record<string, string>; body?: string }] {
  const call = fetchSpy.mock.calls.at(-1) as [
    URL,
    { method: string; headers: Record<string, string>; body?: string },
  ];
  return call;
}

function textOf(result: { content: { type: string; text?: string }[] }) {
  const block = result.content[0];
  return block?.type === "text" ? block.text : undefined;
}

describe("createCallApiTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scopes the tool name to the connection and never exposes the token in its input schema", () => {
    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );

    expect(tool.name).toBe("api__int1");
    expect(Object.keys(tool.inputSchema)).toEqual([
      "method",
      "path",
      "query",
      "body",
    ]);
  });

  it("GETs against the connection's pinned base URL with the token injected server-side", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { data: [{ id: "1" }] }));
    vi.stubGlobal("fetch", fetchSpy);

    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );
    const result = await tool.handler({ method: "GET", path: "me/media" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = lastFetchCall(fetchSpy);
    expect(calledUrl.toString()).toBe(
      "https://graph.facebook.com/v19.0/me/media",
    );
    expect(calledInit.method).toBe("GET");
    expect(calledInit.headers.Authorization).toBe("Bearer secret-token");
    expect(result.structuredContent).toEqual({
      status: 200,
      body: { data: [{ id: "1" }] },
    });
  });

  it("strips a leading slash from path so it can't escape the connection's configured base path", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );
    // A leading slash would otherwise make new URL() treat this as
    // root-relative, silently dropping "/v19.0" from the final request.
    await tool.handler({ method: "GET", path: "/me/media" });

    const [calledUrl] = lastFetchCall(fetchSpy);
    expect(calledUrl.toString()).toBe(
      "https://graph.facebook.com/v19.0/me/media",
    );
  });

  it("appends query parameters and sends a JSON body on POST", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(201, { id: "9" }));
    vi.stubGlobal("fetch", fetchSpy);

    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );
    await tool.handler({
      method: "POST",
      path: "me/media",
      query: { fields: "id,caption" },
      body: { caption: "hello" },
    });

    const [calledUrl, calledInit] = lastFetchCall(fetchSpy);
    expect(calledUrl.searchParams.get("fields")).toBe("id,caption");
    expect(calledInit.method).toBe("POST");
    expect(calledInit.headers["Content-Type"]).toBe("application/json");
    expect(calledInit.body).toBe(JSON.stringify({ caption: "hello" }));
  });

  it("returns a tool error, not a thrown exception, for a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(403, { error: "denied" })),
    );

    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );
    const result = await tool.handler({ method: "GET", path: "me/media" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("403");
  });

  it("returns a tool error when the connection can't be reached at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );
    const result = await tool.handler({ method: "GET", path: "me/media" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Meta Graph API");
  });

  it("truncates a very long response body instead of returning it whole", async () => {
    const longText = "x".repeat(20_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(longText, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const tool = createCallApiTool(
      "int1",
      "Meta Graph API",
      "https://graph.facebook.com/v19.0/",
      "secret-token",
    );
    const result = await tool.handler({ method: "GET", path: "me/media" });

    const body = result.structuredContent?.body as string;
    expect(body.length).toBeLessThan(longText.length);
    expect(body.endsWith("(truncated)")).toBe(true);
  });
});
