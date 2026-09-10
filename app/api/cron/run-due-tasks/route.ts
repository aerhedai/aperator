import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getAIProvider } from "@/lib/ai/organisation-ai-provider";
import { isPresetDue } from "@/lib/tasks/schedule-presets";
import { runTaskPlan } from "@/lib/tasks/run-task-plan";
import * as taskRepository from "@/lib/tasks/task-repository";

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
 * (vercel.json's "0 * * * *", hourly; see schedule-presets.ts's own
 * comment on why every preset assumes that cadence). For each ACTIVE
 * routine whose preset is due against its own last run, this creates a
 * fresh TaskRun and replays its stored plan via run-task-plan.ts — no
 * live reasoning about what to do, exactly the same execution runTaskPlan
 * does for a one-off Task created moments earlier in chat.
 *
 * One routine failing (a bad plan, a deleted target agent, an unexpected
 * throw) must never stop the sweep from checking the rest — each is
 * caught and reported individually rather than letting one organisation's
 * misconfigured routine silently starve every other organisation's
 * routines of their own scheduled runs.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const routines = await taskRepository.listActiveRoutines();

  const results: {
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
      results.push({ taskId: routine.id, fired: false });
      continue;
    }

    try {
      const provider = await getAIProvider(routine.organisationId);
      const result = await runTaskPlan(
        routine.organisationId,
        routine,
        provider,
      );
      results.push({ taskId: routine.id, fired: true, status: result.status });
    } catch (error) {
      results.push({
        taskId: routine.id,
        fired: true,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    checked: routines.length,
    fired: results.filter((r) => r.fired).length,
    results,
  });
}
