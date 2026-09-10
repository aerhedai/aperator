import type { TaskSchedulePreset } from "@/lib/generated/prisma/client";

// Whether a preset should fire given the current time and when it last
// ran — pure and UTC-only (no per-business timezone yet, see
// TaskSchedulePreset's own schema comment) so it's testable without a
// real clock or database. The cron sweep (app/api/cron/run-due-tasks)
// calls this once per ACTIVE routine on each run, expected once daily
// (vercel.json's "0 9 * * *" — Vercel's Hobby plan caps cron at one
// invocation a day, which is also why there's no HOURLY preset) — every
// preset here assumes that cadence and would silently skip fires if the
// sweep ran less often than its own.
export function isPresetDue(
  preset: TaskSchedulePreset,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  // A day/hour gate below must still apply even when there's no history
  // yet — a routine that's never run is "due immediately" only in the
  // sense of having nothing to compare against, never in the sense of
  // skipping its own gate. A never-run WEEKDAYS_9AM routine checked on a
  // Saturday is still not due; it's simply not blocked by its own history
  // the way a same-day rerun is.
  switch (preset) {
    case "DAILY_9AM":
      return (
        now.getUTCHours() === 9 &&
        (!lastRunAt || !isSameUtcDate(lastRunAt, now))
      );
    case "WEEKDAYS_9AM":
      return (
        now.getUTCHours() === 9 &&
        isWeekday(now) &&
        (!lastRunAt || !isSameUtcDate(lastRunAt, now))
      );
    case "WEEKLY_MONDAY_9AM":
      return (
        now.getUTCDay() === 1 &&
        now.getUTCHours() === 9 &&
        (!lastRunAt || lastRunAt < startOfUtcWeek(now))
      );
  }
}

function isSameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

// Midnight UTC of the Monday on or before `d`.
function startOfUtcWeek(d: Date): Date {
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}
