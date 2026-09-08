import { z } from "zod";

import * as templateService from "@/lib/agents/template-service";
import { toolSuccess } from "@/lib/mcp/tool-result";
import type { ToolName } from "@/lib/mcp/tool-registry";

const TOOL_NAME: ToolName = "list_templates";

const inputSchema = {};

const outputSchema = {
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      suggestedTools: z.array(z.string()),
    }),
  ),
};

/**
 * Read-only discovery for install_template — a business (via chat) can
 * only ask for "an agent that handles X" if something can actually name
 * what's available first. Returns every template visible to this
 * organisation (built-in plus its own saved ones), regardless of whether
 * something similar has already been installed: installing one just
 * creates a plain Agent with no link back to the template it came from
 * (CLAUDE.md's own AgentTemplate design — a starting point, not a
 * tracked subscription), so there's no reliable way to know "already
 * installed" even if this tool tried to hide it.
 */
export function createListTemplatesTool(organisationId: string) {
  return {
    name: TOOL_NAME,
    description:
      "List the pre-built agent templates available to install for this organisation. Use this before install_template, to see what's actually available and pick the right one — never guess a template id.",
    inputSchema,
    outputSchema,
    handler: async () => {
      const templates = await templateService.listTemplates(organisationId);
      return toolSuccess({
        templates: templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          suggestedTools: t.suggestedTools,
        })),
      });
    },
  };
}
