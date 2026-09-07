import { z } from "zod";

import { callExternalMcpTool } from "@/lib/integrations/mcp/external-client";
import {
  buildMcpToolName,
  type DiscoveredMcpTool,
} from "@/lib/integrations/mcp/tool-naming";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

// Maps a JSON Schema property's declared `type` to the closest Zod
// primitive — straightforward cases only (CLAUDE.md: don't try to handle
// every JSON Schema feature). Anything else — missing, "null", a union/
// anyOf, or a type this platform has no Zod equivalent for — falls back to
// z.unknown(), the same permissive shape this pass-through has always used.
function zodForJsonSchemaType(type: unknown): z.ZodTypeAny {
  switch (type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(z.unknown());
    case "object":
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}

/**
 * Builds one property's Zod schema from its raw JSON Schema declaration —
 * type mapped via zodForJsonSchemaType, `.describe()` attached when the
 * remote tool declared one (matches find-record.ts's own convention of
 * describing every field for the model), required-ness taken from whether
 * this key appears in the remote's `required` array.
 *
 * Wrapped in try/catch deliberately: a malformed or unusual remote schema
 * for *one* property (an unexpected shape, a `type` that isn't a string,
 * anything JSON-Schema-legal this platform doesn't handle) must not break
 * registration for the whole tool — it degrades to the original
 * fully-permissive z.unknown().optional() for that property alone, never
 * required, since a malformed entry's own "required" claim isn't trustworthy
 * either.
 */
function buildPropertySchema(
  rawSchema: unknown,
  isRequired: boolean,
): z.ZodTypeAny {
  try {
    const schema =
      typeof rawSchema === "object" && rawSchema !== null
        ? (rawSchema as { type?: unknown; description?: unknown })
        : {};
    const base = zodForJsonSchemaType(schema.type);
    const described =
      typeof schema.description === "string" && schema.description.length > 0
        ? base.describe(schema.description)
        : base;
    return isRequired ? described : described.optional();
  } catch {
    return z.unknown().optional();
  }
}

function buildPassthroughShape(
  properties: Record<string, unknown> | undefined,
  required: string[] | undefined,
): Record<string, z.ZodTypeAny> {
  if (!properties) return {};
  const requiredKeys = new Set(required ?? []);
  return Object.fromEntries(
    Object.entries(properties).map(([key, rawSchema]) => [
      key,
      buildPropertySchema(rawSchema, requiredKeys.has(key)),
    ]),
  );
}

/**
 * Wraps one discovered remote tool as a forwarding registration on
 * Aperator's own in-process McpServer. The namespaced name exists only so
 * it's unique inside Aperator's own tool list — the handler calls the
 * remote server using remoteTool.name alone, the name it actually knows.
 * Input/output schemas reflect the remote's real declared JSON Schema shape
 * as closely as practical (types, descriptions, required-ness) while
 * staying permissive about *validation* — a property whose declared type
 * this platform can't map falls back to z.unknown(), and Aperator's own
 * layer still never rejects something the remote might accept (CLAUDE.md/
 * design spec: the remote server is the authoritative validator for its
 * own tool, not Aperator). What changed from a pure z.unknown() pass-through
 * is only what the *model* is told about the tool's shape — it now sees
 * real types, descriptions, and required fields instead of just property
 * names.
 */
export function createMcpProxyTool(
  integrationId: string,
  url: string,
  token: string,
  remoteTool: DiscoveredMcpTool,
) {
  const inputSchema = buildPassthroughShape(
    remoteTool.inputSchema.properties,
    remoteTool.inputSchema.required,
  );

  return {
    name: buildMcpToolName(integrationId, remoteTool.name),
    description: remoteTool.description,
    inputSchema,
    outputSchema: {},
    handler: async (args: Record<string, unknown>) => {
      try {
        const result = await callExternalMcpTool(
          url,
          token,
          remoteTool.name,
          args,
        );
        if (result.isError) {
          const firstBlock = Array.isArray(result.content)
            ? result.content[0]
            : undefined;
          const message =
            firstBlock && firstBlock.type === "text"
              ? firstBlock.text
              : "The external tool returned an error.";
          return toolError(message);
        }
        return toolSuccess(
          (result.structuredContent as Record<string, unknown>) ?? {
            content: result.content,
          },
        );
      } catch (error) {
        return toolError(
          error instanceof Error
            ? error.message
            : "The external MCP server could not be reached.",
        );
      }
    },
  };
}
