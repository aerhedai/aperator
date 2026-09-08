import { z } from "zod";

import { toolError, toolSuccess } from "@/lib/mcp/tool-result";
import type { ToolName } from "@/lib/mcp/tool-registry";
import * as workflowTemplateService from "@/lib/workflows/workflow-template-service";

const TOOL_NAME: ToolName = "install_workflow_template";

const inputSchema = {
  templateId: z
    .string()
    .min(1)
    .describe(
      "The id of a workflow template from list_templates's own output — never a name or a guessed id.",
    ),
};

const outputSchema = {
  workflowId: z.string(),
  workflowName: z.string(),
};

/**
 * The multi-agent counterpart to install_template: installs a whole
 * department (a classifier plus its handler agents) as one real, ACTIVE
 * Workflow, immediately reachable via invoke_workflow — unlike a lone
 * agent template, which installs as a DRAFT nothing points at yet, a
 * department is installed ready to try, since nothing else would wire it
 * up afterwards.
 *
 * Shares its actual logic with the /templates page's own install action
 * via workflowTemplateService.installWorkflowTemplate, same "one real
 * install path" reasoning as install_template.
 */
export function createInstallWorkflowTemplateTool(organisationId: string) {
  return {
    name: TOOL_NAME,
    description:
      "Install a pre-built department (a classifier plus its handler agents) for this organisation, from an id returned by list_templates. Creates a real, ACTIVE workflow — immediately usable via invoke_workflow — always call list_templates first to find the right one; never guess a template id.",
    inputSchema,
    outputSchema,
    handler: async ({ templateId }: { templateId: string }) => {
      const result = await workflowTemplateService.installWorkflowTemplate(
        organisationId,
        templateId,
      );
      if (!result.ok) {
        return toolError(result.error);
      }
      return toolSuccess({
        workflowId: result.workflowId,
        workflowName: result.workflowName,
      });
    },
  };
}
