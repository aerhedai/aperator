import { z } from "zod";

import type { Prisma } from "@/lib/generated/prisma/client";
import type { InvokableAgentSummary } from "@/lib/mcp/tools/invoke-agent";
import type { InvokableWorkflowSummary } from "@/lib/mcp/tools/invoke-workflow";
import {
  buildInvokableTargetsDescription,
  taskStepInputSchema,
} from "@/lib/mcp/tools/shared/task-step-input";
import type { ToolName } from "@/lib/mcp/tool-registry";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";
import {
  taskPlanSchema,
  validateStepReferences,
} from "@/lib/tasks/task-plan-schema";
import * as taskRepository from "@/lib/tasks/task-repository";

const TOOL_NAME: ToolName = "create_routine";

// A closed set of presets, not raw cron — matches
// TaskSchedulePreset (schema.prisma) exactly; kept as a literal tuple here
// rather than imported from the generated Prisma client so this tool's
// input schema doesn't depend on the client being generated in whatever
// environment introspects tool schemas (e.g. tests that import this file
// without a live database).
const SCHEDULE_PRESETS = [
  "DAILY_9AM",
  "WEEKDAYS_9AM",
  "WEEKLY_MONDAY_9AM",
] as const;

const inputSchema = {
  title: z
    .string()
    .min(1)
    .describe(
      "A short label for this routine, shown to the business owner in their task list.",
    ),
  instruction: z
    .string()
    .min(1)
    .describe(
      "A one- or two-sentence restatement of what this routine does, shown on its own detail view.",
    ),
  steps: z
    .array(taskStepInputSchema)
    .min(1)
    .max(10)
    .describe(
      "The ordered plan to run on every firing — one entry per agent or workflow to invoke, in order. Decided once, now; not re-planned on later firings.",
    ),
  schedulePreset: z
    .enum(SCHEDULE_PRESETS)
    .describe(
      "How often this fires, in UTC: DAILY_9AM, WEEKDAYS_9AM (Mon-Fri), or WEEKLY_MONDAY_9AM.",
    ),
};

const outputSchema = {
  taskId: z.string(),
  schedulePreset: z.enum(SCHEDULE_PRESETS),
};

function buildDescription(
  invokableAgents: InvokableAgentSummary[],
  invokableWorkflows: InvokableWorkflowSummary[],
): string {
  const base =
    "Create a recurring routine — the same kind of plan as create_task, but saved with a schedule instead of run immediately. The plan is decided once, right now, and replayed exactly on every firing; it does not get re-planned or re-reasoned about later, even if new agents are added afterward — recreate it if the plan should change.";
  return `${base}\n\n${buildInvokableTargetsDescription(invokableAgents, invokableWorkflows)}`;
}

/**
 * The scheduled counterpart to create_task (lib/mcp/tools/create-task.ts)
 * — see that file's doc comment for the shared reasoning. This one never
 * executes its plan itself: it only persists a Task row with
 * schedulePreset set (status ACTIVE), and the cron sweep
 * (app/api/cron/run-due-tasks/route.ts) is what actually calls
 * run-task-plan.ts on each due firing.
 */
export function createCreateRoutineTool(
  organisationId: string,
  invokableAgents: InvokableAgentSummary[],
  invokableWorkflows: InvokableWorkflowSummary[],
) {
  return {
    name: TOOL_NAME,
    description: buildDescription(invokableAgents, invokableWorkflows),
    inputSchema,
    outputSchema,
    handler: async ({
      title,
      instruction,
      steps,
      schedulePreset,
    }: {
      title: string;
      instruction: string;
      steps: z.infer<typeof taskStepInputSchema>[];
      schedulePreset: (typeof SCHEDULE_PRESETS)[number];
    }) => {
      const parsed = taskPlanSchema.safeParse({ steps });
      if (!parsed.success) {
        return toolError(
          `Invalid plan: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }
      const referenceError = validateStepReferences(parsed.data);
      if (referenceError) return toolError(referenceError);

      for (const step of parsed.data.steps) {
        const validIds =
          step.targetType === "agent"
            ? invokableAgents.map((a) => a.id)
            : invokableWorkflows.map((w) => w.id);
        if (!validIds.includes(step.targetId)) {
          return toolError(
            `"${step.targetId}" is not a currently invokable ${step.targetType} — check list_invokable for what's actually available.`,
          );
        }
      }

      const task = await taskRepository.createTask(
        organisationId,
        title,
        instruction,
        parsed.data as unknown as Prisma.InputJsonValue,
        schedulePreset,
      );

      return toolSuccess({ taskId: task.id, schedulePreset });
    },
  };
}
