import type { AIProvider } from "@/lib/ai/provider";
import { invokeAgentDirectly } from "@/lib/agents/invoke-agent-directly";
import type { Task, TaskRun } from "@/lib/generated/prisma/client";
import * as runRepository from "@/lib/runs/run-repository";
import * as taskRepository from "@/lib/tasks/task-repository";
import { taskPlanSchema, type TaskPlan } from "@/lib/tasks/task-plan-schema";
import { invokeWorkflowDirectly } from "@/lib/workflows/invoke-workflow-directly";

export interface TaskPlanExecutionResult {
  taskRunId: string;
  status: "completed" | "waiting_for_approval" | "failed";
}

// Substitutes every {{steps.N.response}} placeholder with that step's
// actual response text. Validated at plan-creation time
// (validateStepReferences) to only ever reference an earlier index, so by
// the time execution reaches step `stepOutputs.length`, every reference
// inside it already has a real entry.
function substitutePlaceholders(
  template: string,
  stepOutputs: (string | null)[],
): string {
  return template.replace(/\{\{steps\.(\d+)\.response\}\}/g, (match, idx) => {
    const output = stepOutputs[Number(idx)];
    return output ?? match;
  });
}

/**
 * Executes a Task's stored plan step by step — the one thing both a
 * freshly-created one-off Task and a Routine's cron-triggered firing call,
 * so "how a task actually runs" has exactly one implementation regardless
 * of what triggered it (chat, immediately, vs. the cron sweep, later).
 *
 * Each step is a plain invoke_agent/invoke_workflow-equivalent call — no
 * live LLM reasoning about *what* to call, only the target agent's own
 * execution (LOOP/HARNESS/CHAT, whatever it already is) does any
 * reasoning. This is what makes a Routine cheap and repeatable: the plan
 * was decided once, in chat, when create_routine was called.
 *
 * A step that returns waiting_for_input (a CHAT-mode target agent pausing
 * for its next human turn) is treated as a normal completion, not a
 * pause — that pause is CHAT's own interactive mechanism and has nothing
 * to do with this plan; the reply it already gave is exactly the "result"
 * this step needed. Only waiting_for_approval is a real pause: something
 * needs a human decision before the underlying action executes.
 *
 * Known limitation, not yet built: once a step pauses for approval, that
 * step's own AgentRun resumes correctly through the existing Approvals UI
 * (resumeRun is untouched by any of this), but nothing here automatically
 * continues the *remaining* plan steps afterward — the TaskRun is left at
 * WAITING_FOR_APPROVAL and requires manual follow-up. Wiring that
 * continuation is real, separate work (hooking into wherever an approval
 * decision resolves a run) left for a later pass.
 */
export async function runTaskPlan(
  organisationId: string,
  task: Task,
  provider?: AIProvider,
): Promise<TaskPlanExecutionResult> {
  const plan = taskPlanSchema.parse(task.plan) as TaskPlan;

  const taskRun = await taskRepository.createTaskRun(task.id);
  await taskRepository.updateTaskRunStatus(taskRun.id, "RUNNING");
  if (!task.schedulePreset) {
    await taskRepository.updateTaskStatus(task.id, "RUNNING");
  }

  const stepOutputs: (string | null)[] = [];

  for (const [index, step] of plan.steps.entries()) {
    const instruction = substitutePlaceholders(
      step.instructionTemplate,
      stepOutputs,
    );

    const result =
      step.targetType === "agent"
        ? await invokeAgentDirectly(
            organisationId,
            step.targetId,
            instruction,
            0,
            provider,
          )
        : await invokeWorkflowDirectly(
            organisationId,
            step.targetId,
            instruction,
            0,
            provider,
          );

    if (result.runId) {
      await runRepository.attachToTaskRun(result.runId, taskRun.id, index);
    }

    if (result.status === "waiting_for_approval") {
      return await finish(taskRun, task, "WAITING_FOR_APPROVAL");
    }
    if (result.status === "failed" || result.status === "no_match") {
      return await finish(taskRun, task, "FAILED");
    }

    stepOutputs.push(result.response);
  }

  return await finish(taskRun, task, "COMPLETED");
}

async function finish(
  taskRun: TaskRun,
  task: Task,
  runStatus: "WAITING_FOR_APPROVAL" | "FAILED" | "COMPLETED",
): Promise<TaskPlanExecutionResult> {
  const completedAt =
    runStatus === "WAITING_FOR_APPROVAL" ? undefined : new Date();
  await taskRepository.updateTaskRunStatus(taskRun.id, runStatus, completedAt);

  // A Routine's own Task row never reaches a terminal status — only its
  // TaskRuns do (see TaskStatus's schema comment). It stays ACTIVE
  // regardless of how this particular firing went, ready for the next one.
  if (!task.schedulePreset) {
    const taskStatus =
      runStatus === "WAITING_FOR_APPROVAL"
        ? "RUNNING"
        : runStatus === "FAILED"
          ? "FAILED"
          : "COMPLETED";
    await taskRepository.updateTaskStatus(task.id, taskStatus);
  }

  return {
    taskRunId: taskRun.id,
    status:
      runStatus === "WAITING_FOR_APPROVAL"
        ? "waiting_for_approval"
        : runStatus === "FAILED"
          ? "failed"
          : "completed",
  };
}
