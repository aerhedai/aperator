import { z } from "zod";

// Only triggers with real dispatch logic behind them
// (lib/routing/dispatch.ts / app/api/webhooks/[integrationId]) are offered
// at creation time. The enum itself already anticipates more (Slack, ...);
// this schema grows with it once those exist, rather than needing a rewrite.
export const workflowInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    description: z.string().trim().min(1, "Description is required").max(2000),
    trigger: z.enum(["EMAIL", "WEBHOOK", "SCHEDULE"]),
    // Which specific connected account this workflow listens on — see
    // Workflow.triggerIntegrationId's schema.prisma comment. Required-ness
    // is trigger-dependent (enforced in workflow-service.ts, not here,
    // since it needs a DB lookup to decide) rather than encoded as a Zod
    // refinement, so the one rule lives in one place.
    triggerIntegrationId: z.string().trim().min(1).nullable().optional(),
    // SCHEDULE-only — required-ness *is* checkable here (it only depends
    // on another field already in this object), unlike
    // triggerIntegrationId's above. See Workflow.schedulePreset's
    // schema.prisma comment.
    schedulePreset: z
      .enum(["DAILY_9AM", "WEEKDAYS_9AM", "WEEKLY_MONDAY_9AM"])
      .nullable()
      .optional(),
    // SCHEDULE-only. See Workflow.scheduledPrompt's schema.prisma comment.
    scheduledPrompt: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .refine((data) => data.trigger !== "SCHEDULE" || !!data.schedulePreset, {
    message: "A SCHEDULE workflow needs a schedule preset",
    path: ["schedulePreset"],
  });

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
