import { z } from "zod";

import * as templateService from "@/lib/agents/template-service";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";
import type { ToolName } from "@/lib/mcp/tool-registry";

const TOOL_NAME: ToolName = "install_template";

const inputSchema = {
  templateId: z
    .string()
    .min(1)
    .describe(
      "The id of a template from list_templates's own output — never a name or a guessed id.",
    ),
};

const outputSchema = {
  agentId: z.string(),
  agentName: z.string(),
};

/**
 * The mechanism behind "the business can always ask for more" — chat
 * activating a pre-built agent on its own initiative, not just a human
 * clicking a button on the /templates page. Shares its actual logic
 * (validation, creation) with that button's server action via
 * templateService.installTemplate, so the two paths can never quietly
 * diverge.
 *
 * Deliberately not approval-gated (lib/policies/policy-engine.ts): this
 * creates an internal Agent record, not a customer-visible or otherwise
 * consequential action, and the created agent is DRAFT — reviewable and
 * deletable before it does anything at all, same as one a human built by
 * hand. Chat should say plainly what it just installed and that it needs
 * activating, not treat this as invisible or automatic.
 */
export function createInstallTemplateTool(organisationId: string) {
  return {
    name: TOOL_NAME,
    description:
      "Install a pre-built agent template for this organisation, from an id returned by list_templates. Creates a real, working agent (as a draft, awaiting review) — always call list_templates first to find the right one; never guess a template id.",
    inputSchema,
    outputSchema,
    handler: async ({ templateId }: { templateId: string }) => {
      const result = await templateService.installTemplate(
        organisationId,
        templateId,
      );
      if (!result.ok) {
        return toolError(result.error);
      }
      return toolSuccess({
        agentId: result.agentId,
        agentName: result.agentName,
      });
    },
  };
}
