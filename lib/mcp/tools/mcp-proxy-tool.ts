import { z } from "zod";

import { callExternalMcpTool } from "@/lib/integrations/mcp/external-client";
import {
  buildMcpToolName,
  type DiscoveredMcpTool,
} from "@/lib/integrations/mcp/tool-naming";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";

function buildPassthroughShape(
  properties: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  if (!properties) return {};
  return Object.fromEntries(
    Object.keys(properties).map((key) => [key, z.unknown().optional()]),
  );
}

/**
 * Wraps one discovered remote tool as a forwarding registration on
 * Aperator's own in-process McpServer. The namespaced name exists only so
 * it's unique inside Aperator's own tool list — the handler calls the
 * remote server using remoteTool.name alone, the name it actually knows.
 * Input/output schemas are a permissive pass-through built from the
 * remote's own declared property names (CLAUDE.md/design spec: the remote
 * server is the authoritative validator for its own tool, not Aperator).
 */
export function createMcpProxyTool(
  integrationId: string,
  url: string,
  token: string,
  remoteTool: DiscoveredMcpTool,
) {
  const inputSchema = buildPassthroughShape(remoteTool.inputSchema.properties);

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
