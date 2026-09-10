import { describe, expect, it } from "vitest";

import {
  taskPlanSchema,
  validateStepReferences,
} from "@/lib/tasks/task-plan-schema";

describe("taskPlanSchema", () => {
  it("accepts a single-step plan", () => {
    const result = taskPlanSchema.safeParse({
      steps: [
        { targetType: "agent", targetId: "a1", instructionTemplate: "Do it" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty steps array", () => {
    const result = taskPlanSchema.safeParse({ steps: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 steps", () => {
    const steps = Array.from({ length: 11 }, (_, i) => ({
      targetType: "agent" as const,
      targetId: `a${i}`,
      instructionTemplate: "Do it",
    }));
    const result = taskPlanSchema.safeParse({ steps });
    expect(result.success).toBe(false);
  });

  it("rejects a step with an invalid targetType", () => {
    const result = taskPlanSchema.safeParse({
      steps: [
        { targetType: "person", targetId: "a1", instructionTemplate: "Do it" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a step with an empty instructionTemplate", () => {
    const result = taskPlanSchema.safeParse({
      steps: [{ targetType: "agent", targetId: "a1", instructionTemplate: "" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("validateStepReferences", () => {
  it("allows a step referencing an earlier step's result", () => {
    const plan = taskPlanSchema.parse({
      steps: [
        {
          targetType: "agent",
          targetId: "a1",
          instructionTemplate: "Draft it",
        },
        {
          targetType: "agent",
          targetId: "a2",
          instructionTemplate: "Post this: {{steps.0.response}}",
        },
      ],
    });
    expect(validateStepReferences(plan)).toBeNull();
  });

  it("rejects a step referencing itself", () => {
    const plan = taskPlanSchema.parse({
      steps: [
        {
          targetType: "agent",
          targetId: "a1",
          instructionTemplate: "Loop: {{steps.0.response}}",
        },
      ],
    });
    expect(validateStepReferences(plan)).toMatch(/hasn't run yet/);
  });

  it("rejects a step referencing a later step", () => {
    const plan = taskPlanSchema.parse({
      steps: [
        {
          targetType: "agent",
          targetId: "a1",
          instructionTemplate: "Future: {{steps.1.response}}",
        },
        { targetType: "agent", targetId: "a2", instructionTemplate: "Do it" },
      ],
    });
    expect(validateStepReferences(plan)).toMatch(/hasn't run yet/);
  });

  it("allows a step with no placeholder at all", () => {
    const plan = taskPlanSchema.parse({
      steps: [
        { targetType: "workflow", targetId: "w1", instructionTemplate: "Go" },
      ],
    });
    expect(validateStepReferences(plan)).toBeNull();
  });
});
