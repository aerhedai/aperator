import { describe, expect, it } from "vitest";

import { isPresetDue } from "@/lib/tasks/schedule-presets";

// All UTC — schedule-presets.ts is deliberately UTC-only for now.
function utc(iso: string): Date {
  return new Date(iso);
}

describe("isPresetDue", () => {
  it("every preset is due immediately when it has never run, at a time each preset's own gate allows (Monday 9am)", () => {
    const now = utc("2026-09-14T09:00:00Z"); // a Monday
    expect(isPresetDue("DAILY_9AM", null, now)).toBe(true);
    expect(isPresetDue("WEEKDAYS_9AM", null, now)).toBe(true);
    expect(isPresetDue("WEEKLY_MONDAY_9AM", null, now)).toBe(true);
  });

  it("a never-run preset still isn't due outside its own day/hour gate", () => {
    const now = utc("2026-09-10T09:00:00Z"); // a Thursday
    expect(isPresetDue("DAILY_9AM", null, now)).toBe(true);
    expect(isPresetDue("WEEKDAYS_9AM", null, now)).toBe(true);
    expect(isPresetDue("WEEKLY_MONDAY_9AM", null, now)).toBe(false);
  });

  describe("DAILY_9AM", () => {
    it("is not due outside the 9am hour, even if it's never run", () => {
      const now = utc("2026-09-10T10:00:00Z");
      expect(isPresetDue("DAILY_9AM", null, now)).toBe(false);
      expect(isPresetDue("DAILY_9AM", utc("2026-09-09T09:00:00Z"), now)).toBe(
        false,
      );
    });

    it("is not due twice on the same day even within the 9am hour", () => {
      const lastRunAt = utc("2026-09-10T09:00:00Z");
      const now = utc("2026-09-10T09:00:00Z");
      expect(isPresetDue("DAILY_9AM", lastRunAt, now)).toBe(false);
    });

    it("is due the next day at 9am", () => {
      const lastRunAt = utc("2026-09-09T09:00:00Z");
      const now = utc("2026-09-10T09:00:00Z");
      expect(isPresetDue("DAILY_9AM", lastRunAt, now)).toBe(true);
    });
  });

  describe("WEEKDAYS_9AM", () => {
    it("is not due on a Saturday", () => {
      // 2026-09-12 is a Saturday.
      const now = utc("2026-09-12T09:00:00Z");
      expect(isPresetDue("WEEKDAYS_9AM", null, now)).toBe(false);
    });

    it("is due on a Monday at 9am", () => {
      // 2026-09-14 is a Monday.
      const now = utc("2026-09-14T09:00:00Z");
      expect(isPresetDue("WEEKDAYS_9AM", null, now)).toBe(true);
    });
  });

  describe("WEEKLY_MONDAY_9AM", () => {
    it("is not due on a non-Monday", () => {
      const now = utc("2026-09-16T09:00:00Z"); // Wednesday
      expect(isPresetDue("WEEKLY_MONDAY_9AM", null, now)).toBe(false);
    });

    it("is due on Monday at 9am when it hasn't run this week", () => {
      const lastRunAt = utc("2026-09-07T09:00:00Z"); // previous Monday
      const now = utc("2026-09-14T09:00:00Z"); // this Monday
      expect(isPresetDue("WEEKLY_MONDAY_9AM", lastRunAt, now)).toBe(true);
    });

    it("is not due again later the same Monday", () => {
      const lastRunAt = utc("2026-09-14T09:00:00Z");
      const now = utc("2026-09-14T09:00:00Z");
      expect(isPresetDue("WEEKLY_MONDAY_9AM", lastRunAt, now)).toBe(false);
    });
  });
});
