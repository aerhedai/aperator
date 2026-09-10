import { z } from "zod";

import type { AIProvider } from "@/lib/ai/provider";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { InvokableAgentSummary } from "@/lib/mcp/tools/invoke-agent";
import type { InvokableWorkflowSummary } from "@/lib/mcp/tools/invoke-workflow";
import {
  buildInvokableTargetsDescription,
  taskStepInputSchema,
} from "@/lib/mcp/tools/shared/task-step-input";
import type { ToolName } from "@/lib/mcp/tool-registry";
import { toolError, toolSuccess } from "@/lib/mcp/tool-result";
import { runTaskPlan } from "@/lib/tasks/run-task-plan";
import {
  taskPlanSchema,
  validateStepReferences,
} from "@/lib/tasks/task-plan-schema";
import * as taskRepository from "@/lib/tasks/task-repository";

const TOOL_NAME: ToolName = "create_task";

const inputSchema = {
  title: z
    .string()
    .min(1)
    .describe(
      "A short label for this task, shown to the business owner in their task list.",
    ),
  instruction: z
    .string()
    .min(1)
    .describe(
      "A one- or two-sentence restatement of what was asked, shown on the task's own detail view.",
    ),
  steps: z
    .array(taskStepInputSchema)
    .min(1)
    .max(10)
    .describe(
      "The ordered plan to run right now — one entry per agent or workflow to invoke, in order.",
    ),
};

const outputSchema = {
  taskId: z.string(),
  taskRunId: z.string(),
  status: z.enum(["completed", "waiting_for_approval", "failed"]),
};

function buildDescription(
  invokableAgents: InvokableAgentSummary[],
  invokableWorkflows: InvokableWorkflowSummary[],
): string {
  const base =
    "Create and immediately run a trackable one-off task, made of one or more steps against your currently active agents and workflows. Use this — rather than answering directly, or making a bare invoke_agent/invoke_workflow call yourself — whenever something needs to actually happen once, right now: it gives the business owner a real record of what was asked and what happened, visible in their task list.";
  return `${base}\n\n${buildInvokableTargetsDescription(invokableAgents, invokableWorkflows)}`;
}

/**
 * The Task-shaped counterpart to a bare invoke_agent/invoke_workflow call:
 * both still do the actual work, but this wraps it in a Task/TaskRun row
 * (lib/tasks/) so it's visible and trackable outside the chat transcript
 * itself, and — for a multi-step ask — commits to the whole plan up front
 * rather than deciding step 2 only after seeing step 1's result.
 *
 * create_routine (lib/mcp/tools/create-routine.ts) is the only difference
 * from here on: same plan shape, same validation, but persisted with a
 * schedule instead of run immediately — see run-task-plan.ts for why the
 * plan itself, not a live reasoning loop, is what a Routine replays.
 */
export function createCreateTaskTool(
  organisationId: string,
  invokableAgents: InvokableAgentSummary[],
  invokableWorkflows: InvokableWorkflowSummary[],
  provider?: AIProvider,
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
    }: {
      title: string;
      instruction: string;
      steps: z.infer<typeof taskStepInputSchema>[];
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
        null,
      );
      const result = await runTaskPlan(organisationId, task, provider);

      return toolSuccess({
        taskId: task.id,
        taskRunId: result.taskRunId,
        status: result.status,
      });
    },
  };
}
