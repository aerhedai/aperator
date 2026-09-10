import { z } from "zod";

// A step-placeholder reference back into an earlier step's result — e.g.
// "Post this to Slack: {{steps.0.response}}" — substituted literally by
// substitutePlaceholders in run-task-plan.ts. 0-indexed to match array
// position, since the plan itself is an array the assistant already sees
// as such when it builds it.
const STEP_PLACEHOLDER_PATTERN = /\{\{steps\.(\d+)\.response\}\}/g;

export const taskStepSchema = z.object({
  targetType: z.enum(["agent", "workflow"]),
  targetId: z.string().min(1),
  // The text this step sends its target, as if a user had typed it
  // directly (same convention as invoke_agent/invoke_workflow's own
  // `input` parameter) — may embed {{steps.N.response}} placeholders.
  instructionTemplate: z.string().min(1),
});

export type TaskStep = z.infer<typeof taskStepSchema>;

// Capped at 10 — a task plan is a short, explicit sequence the assistant
// commits to once at creation time, not an open-ended program; something
// needing more steps than this is very likely better served by a real
// HARNESS pipeline or Workflow than by chat-assembled orchestration.
export const taskPlanSchema = z.object({
  steps: z.array(taskStepSchema).min(1).max(10),
});

export type TaskPlan = z.infer<typeof taskPlanSchema>;

// A plan step may only reference an *earlier* step's result — forward or
// self references can never resolve (run-task-plan.ts executes steps in
// order and substitutes as it goes), and are almost certainly a mistake in
// whatever produced the plan rather than something to silently execute
// with an unresolved placeholder left in the text.
export function validateStepReferences(plan: TaskPlan): string | null {
  for (const [index, step] of plan.steps.entries()) {
    for (const match of step.instructionTemplate.matchAll(
      STEP_PLACEHOLDER_PATTERN,
    )) {
      const referenced = Number(match[1]);
      if (referenced >= index) {
        return `Step ${index} references step ${referenced}'s result, which hasn't run yet — a step may only reference an earlier step.`;
      }
    }
  }
  return null;
}
