import { describe, expect, it } from "vitest";
import { launchConfigurationChanged, resolveAsFollowUp } from "./run-dispatch.js";

describe("run dispatch", () => {
  it("does not trust a stale renderer follow-up flag after a turn completed", () => {
    expect(resolveAsFollowUp(true, false)).toBe(false);
    expect(resolveAsFollowUp(false, true)).toBe(true);
  });

  it("restarts a warm process when any launch-time selection changed", () => {
    const current = { model: "old-model", effort: "medium", permission: "auto" as const };
    expect(launchConfigurationChanged(current, { ...current, model: "new-model" })).toBe(true);
    expect(launchConfigurationChanged(current, { ...current, effort: "high" })).toBe(true);
    expect(launchConfigurationChanged(current, { ...current, permission: "plan" })).toBe(true);
    expect(launchConfigurationChanged(current, { ...current })).toBe(false);
  });
});
