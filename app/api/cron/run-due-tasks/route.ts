import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import { dispatchScheduledWorkflow } from "@/lib/routing/dispatch";
import { isPresetDue } from "@/lib/tasks/schedule-presets";
import { runTaskPlan } from "@/lib/tasks/run-task-plan";
import * as taskRepository from "@/lib/tasks/task-repository";
import * as workflowRepository from "@/lib/workflows/workflow-repository";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
// is set on the project (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
// Unset locally/in preview is deliberately left open (no secret configured
// means nothing to check against) — set for production the same way every
// other real secret here is, via the hosting provider's environment, never
// committed (CLAUDE.md §21).
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const provided = request.headers.get("authorization");
  if (!provided) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * The one thing that makes a Routine actually a routine rather than a
 * dead schedulePreset column — Vercel Cron hits this on a fixed interval
 * (vercel.json's "0 9 * * *", once daily — Vercel's Hobby plan caps
 * cron at one invocation a day; see schedule-presets.ts's own comment
 * on why every preset assumes that cadence). For each ACTIVE
 * routine whose preset is due against its own last run, this creates a
 * fresh TaskRun and replays its stored plan via run-task-plan.ts — no
 * live reasoning about what to do, exactly the same execution runTaskPlan
 * does for a one-off Task created moments earlier in chat.
 *
 * Sweeps ACTIVE SCHEDULE workflows (departments) the same way, in the
 * same daily invocation — reusing the cadence vocabulary (TaskSchedulePreset)
 * and the cron infrastructure rather than standing up a second cron entry
 * for what's the same "is this due yet" check against a different table.
 * Unlike a Routine's fixed plan, a scheduled workflow's classifier reasons
 * fresh every firing (dispatchScheduledWorkflow) — that's the actual
 * difference between the two, not the scheduling mechanism.
 *
 * One routine or workflow failing (a bad plan, a deleted target agent, an
 * unexpected throw) must never stop the sweep from checking the rest —
 * each is caught and reported individually rather than letting one
 * organisation's misconfigured routine or department silently starve
 * every other organisation's scheduled work.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const routines = await taskRepository.listActiveRoutines();

  const taskResults: {
    taskId: string;
    fired: boolean;
    status?: string;
    error?: string;
  }[] = [];

  for (const routine of routines) {
    // schedulePreset is guaranteed non-null by listActiveRoutines' own
    // where clause; the type is still nullable on Task itself since a
    // one-off Task always has it null.
    if (!routine.schedulePreset) continue;

    const lastRunAt = routine.runs[0]?.createdAt ?? null;
    if (!isPresetDue(routine.schedulePreset, lastRunAt, now)) {
      taskResults.push({ taskId: routine.id, fired: false });
      continue;
    }

    try {
      const provider = await getAIProvider(routine.organisationId);
      const result = await runTaskPlan(
        routine.organisationId,
        routine,
        provider,
      );
      taskResults.push({
        taskId: routine.id,
        fired: true,
        status: result.status,
      });
    } catch (error) {
      taskResults.push({
        taskId: routine.id,
        fired: true,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const scheduledWorkflows =
    await workflowRepository.findActiveScheduledWorkflows();

  const workflowResults: {
    workflowId: string;
    fired: boolean;
    matched?: boolean;
    error?: string;
  }[] = [];

  for (const workflow of scheduledWorkflows) {
    // schedulePreset is guaranteed non-null for an ACTIVE SCHEDULE
    // workflow by activateWorkflow's own check; still nullable on the
    // model since every other trigger leaves it unset.
    if (!workflow.schedulePreset) continue;

    if (
      !isPresetDue(workflow.schedulePreset, workflow.lastScheduledFireAt, now)
    ) {
      workflowResults.push({ workflowId: workflow.id, fired: false });
      continue;
    }

    // Marked *before* dispatching, not after success — a department
    // whose handler keeps failing is attempted once per sweep rather than
    // retried every time this route runs that day. Same reasoning as a
    // Routine's TaskRun being created before its plan executes.
    await workflowRepository.markWorkflowScheduledFire(workflow.id, now);

    try {
      const provider = await getAIProvider(workflow.organisationId);
      const result = await dispatchScheduledWorkflow(workflow, provider);
      workflowResults.push({
        workflowId: workflow.id,
        fired: true,
        matched: result.matched,
      });
    } catch (error) {
      workflowResults.push({
        workflowId: workflow.id,
        fired: true,
        matched: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    tasks: {
      checked: routines.length,
      fired: taskResults.filter((r) => r.fired).length,
      results: taskResults,
    },
    workflows: {
      checked: scheduledWorkflows.length,
      fired: workflowResults.filter((r) => r.fired).length,
      results: workflowResults,
    },
  });
}
