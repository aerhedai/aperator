import { z } from "zod";

import type { InvokableAgentSummary } from "@/lib/mcp/tools/invoke-agent";
import type { InvokableWorkflowSummary } from "@/lib/mcp/tools/invoke-workflow";

// The tool-input counterpart to lib/tasks/task-plan-schema.ts's
// taskStepSchema — same shape, but as the raw Zod object create_task and
// create_routine embed directly in their own inputSchema (MCP tool input
// schemas are flat shapes, not a single nested schema object), so both
// tools describe the identical step format to the model with zero drift.
export const taskStepInputSchema = z.object({
  targetType: z.enum(["agent", "workflow"]),
  targetId: z
    .string()
    .min(1)
    .describe(
      "The id of the agent or workflow this step invokes — must be one listed as available in this tool's own description.",
    ),
  instructionTemplate: z
    .string()
    .min(1)
    .describe(
      "The text to send this step, exactly as if a user had typed it directly. Reference an earlier step's result with the literal placeholder \"{{steps.N.response}}\" (0-indexed) to pass that step's output into this one.",
    ),
});

// Shared by create_task and create_routine — both need the model to know
// exactly which agents/workflows exist right now, same "description
// doubles as the enforcement set" pattern invoke_agent/invoke_workflow
// already use.
export function buildInvokableTargetsDescription(
  invokableAgents: InvokableAgentSummary[],
  invokableWorkflows: InvokableWorkflowSummary[],
): string {
  const agentsList = invokableAgents.length
    ? invokableAgents
        .map((a) => `- agent id: ${a.id} — ${a.name}: ${a.description}`)
        .join("\n")
    : "(none currently active)";
  const workflowsList = invokableWorkflows.length
    ? invokableWorkflows
        .map((w) => `- workflow id: ${w.id} — ${w.name}: ${w.description}`)
        .join("\n")
    : "(none currently active)";
  return `Agents you may target with targetType "agent":\n${agentsList}\n\nWorkflows you may target with targetType "workflow":\n${workflowsList}`;
}
