import { describe, expect, it } from "vitest";
import {
  computeNextAutomationRunAt,
  computeNextAutomationRunAtAfter,
  validateAutomationSchedule,
} from "./automation-schedule.js";

describe("automation schedules", () => {
  it("resolves daily wall-clock time in an IANA timezone", () => {
    expect(computeNextAutomationRunAt(
      { type: "daily", timeOfDay: "09:00", timezone: "Africa/Lagos" },
      "2026-08-11T08:30:00.000Z",
    )).toBe("2026-08-12T08:00:00.000Z");
  });

  it("skips weekends for weekday schedules", () => {
    expect(computeNextAutomationRunAt(
      { type: "weekdays", timeOfDay: "09:00", timezone: "UTC" },
      "2026-08-14T10:00:00.000Z",
    )).toBe("2026-08-17T09:00:00.000Z");
  });

  it("skips nonexistent daylight-saving wall-clock slots", () => {
    expect(computeNextAutomationRunAt(
      { type: "daily", timeOfDay: "02:30", timezone: "America/New_York" },
      "2026-03-08T05:00:00.000Z",
    )).toBe("2026-03-09T06:30:00.000Z");
  });

  it("supports constrained cron ranges, steps, and weekday names", () => {
    expect(computeNextAutomationRunAt(
      { type: "cron", expression: "*/15 9-10 * * mon-fri", timezone: "UTC" },
      "2026-08-11T09:07:00.000Z",
    )).toBe("2026-08-11T09:15:00.000Z");
  });

  it("fast-forwards missed intervals without replaying each occurrence", () => {
    expect(computeNextAutomationRunAtAfter(
      { type: "interval", everyMinutes: 5 },
      "2026-08-11T09:00:00.000Z",
      "2026-08-11T11:02:00.000Z",
    )).toBe("2026-08-11T11:05:00.000Z");
  });

  it("applies stable load-spreading jitter for calendar schedules", () => {
    const context = { installSalt: "install-a", automationId: "automation-a" };
    const schedule = { type: "daily", timeOfDay: "09:00", timezone: "UTC" } as const;
    const first = computeNextAutomationRunAt(schedule, "2026-08-11T08:00:00.000Z", context);
    const second = computeNextAutomationRunAt(schedule, "2026-08-11T08:00:00.000Z", context);
    expect(first).toBe(second);
    expect(Date.parse(first!) - Date.parse("2026-08-11T09:00:00.000Z")).toBeGreaterThanOrEqual(0);
    expect(Date.parse(first!) - Date.parse("2026-08-11T09:00:00.000Z")).toBeLessThan(120_000);
  });

  it("rejects invalid schedules before they are persisted", () => {
    expect(() => validateAutomationSchedule({ type: "cron", expression: "not cron", timezone: "UTC" })).toThrow(/five fields/i);
    expect(() => validateAutomationSchedule({ type: "interval", everyMinutes: 0 })).toThrow(/between 1 minute/i);
    expect(() => validateAutomationSchedule({ type: "daily", timeOfDay: "25:00", timezone: "UTC" })).toThrow(/24-hour/i);
  });
});
