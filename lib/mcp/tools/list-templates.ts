import { z } from "zod";

import * as templateService from "@/lib/agents/template-service";
import { toolSuccess } from "@/lib/mcp/tool-result";
import type { ToolName } from "@/lib/mcp/tool-registry";
import * as workflowTemplateService from "@/lib/workflows/workflow-template-service";

const TOOL_NAME: ToolName = "list_templates";

const inputSchema = {};

const outputSchema = {
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      // "agent": install_template creates one DRAFT agent nothing points
      // at yet, for a human or chat to review and wire up afterwards.
      // "workflow": install_workflow_template creates a whole department
      // (a classifier plus its handlers) as one real, ACTIVE workflow —
      // usable immediately via invoke_workflow.
      kind: z.enum(["agent", "workflow"]),
      suggestedTools: z.array(z.string()),
    }),
  ),
};

/**
 * Read-only discovery for install_template/install_workflow_template — a
 * business (via chat) can only ask for "something that handles X" if it
 * can actually name what's available first. Returns every template
 * visible to this organisation (built-in plus its own saved ones) of
 * either kind, regardless of whether something similar has already been
 * installed: neither install path leaves a record of "already installed"
 * to check against (CLAUDE.md's own template design — a starting point,
 * not a tracked subscription).
 */
export function createListTemplatesTool(organisationId: string) {
  return {
    name: TOOL_NAME,
    description:
      'List the pre-built templates available to install for this organisation — both single agents (kind: "agent") and whole departments (kind: "workflow", a classifier plus its handlers). Use this before install_template/install_workflow_template, to see what\'s actually available and pick the right one and kind — never guess a template id.',
    inputSchema,
    outputSchema,
    handler: async () => {
      const [agentTemplates, workflowTemplates] = await Promise.all([
        templateService.listTemplates(organisationId),
        workflowTemplateService.listWorkflowTemplates(organisationId),
      ]);
      return toolSuccess({
        templates: [
          ...agentTemplates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            kind: "agent" as const,
            suggestedTools: t.suggestedTools,
          })),
          ...workflowTemplates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            kind: "workflow" as const,
            suggestedTools: [
              ...new Set(t.handlers.flatMap((h) => h.suggestedTools)),
            ],
          })),
        ],
      });
    },
  };
}
