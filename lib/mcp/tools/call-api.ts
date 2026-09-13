import { z } from "zod";

import { buildApiToolName } from "@/lib/integrations/api/tool-naming";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

// Long responses get cut off before reaching the model, the same
// token-cost reasoning as every other tool that can return unbounded
// external content.
const MAX_RESPONSE_BODY_LENGTH = 10_000;

/**
 * The generic "reach any system" tool (CLAUDE.md §4.5) — one call_api
 * registration per connected "Custom API" integration, scoped by
 * buildApiToolName the same way an MCP connection's tools are scoped: an
 * agent granted this tool can only ever reach *this* connection's pinned
 * host, never an arbitrary one.
 *
 * The model supplies method/path/query/body only. baseUrl and the bearer
 * token are fixed by how the connection was configured and never appear
 * in the tool's own input schema — there is no argument shape that lets
 * a compromised or hallucinating agent redirect this call to a different
 * host or read the credential back out.
 *
 * `path` is always treated as relative to baseUrl, even if the model
 * writes it with a leading slash — `new URL("/x", "https://h/v1/")`
 * would otherwise resolve to "https://h/x", silently dropping "v1" (a
 * correctness bug, not a security one, since the host itself can't
 * change either way) — stripping the leading slash first keeps every
 * call anchored under the connection's full configured base path.
 *
 * Approval gating for the resulting call is method-based, decided in
 * policy-engine.ts (GET/HEAD auto-allowed, everything else requires a
 * human) — this tool has no opinion of its own about that; it only ever
 * executes once the runtime has already decided to let it.
 */
export function createCallApiTool(
  integrationId: string,
  label: string,
  baseUrl: string,
  token: string,
) {
  return {
    name: buildApiToolName(integrationId),
    description: `Call ${label}'s HTTP API directly. GET reads and never needs approval; POST/PUT/PATCH/DELETE change something on ${label} and always require human approval first. This can only ever reach ${label} — the base URL and credential are fixed by how this connection was set up and can't be changed from here.`,
    inputSchema: {
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .describe("HTTP method for this request."),
      path: z
        .string()
        .describe(
          `Path relative to ${label}'s configured base URL, e.g. "me/media" — never a full URL, and never able to reach a different host.`,
        ),
      query: z
        .record(z.string(), z.string())
        .optional()
        .describe("Query parameters to add to the request URL."),
      body: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "JSON body for the request — only meaningful for POST/PUT/PATCH.",
        ),
    },
    outputSchema: {},
    handler: async ({
      method,
      path,
      query,
      body,
    }: {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      query?: Record<string, string>;
      body?: Record<string, unknown>;
    }) => {
      let url: URL;
      try {
        const relativePath = path.replace(/^\/+/, "");
        url = new URL(relativePath, baseUrl);
      } catch {
        return toolError(`"${path}" is not a valid path.`);
      }
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          url.searchParams.set(key, value);
        }
      }

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (error) {
        return toolError(
          error instanceof Error
            ? `Could not reach ${label}: ${error.message}`
            : `Could not reach ${label}.`,
        );
      }

      const rawText = await response.text();
      const truncated =
        rawText.length > MAX_RESPONSE_BODY_LENGTH
          ? `${rawText.slice(0, MAX_RESPONSE_BODY_LENGTH)}… (truncated)`
          : rawText;
      let parsedBody: unknown = truncated;
      try {
        parsedBody = truncated.length > 0 ? JSON.parse(truncated) : null;
      } catch {
        // Not JSON — keep the raw (possibly truncated) text as-is.
      }

      if (!response.ok) {
        return toolError(
          `${label} returned ${response.status}: ${typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody)}`,
        );
      }
      return toolSuccess({ status: response.status, body: parsedBody });
    },
  };
}
