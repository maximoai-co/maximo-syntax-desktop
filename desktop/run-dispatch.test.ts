import { describe, expect, it, vi } from "vitest";
import type { RunRequest, RunResult } from "./types.js";
import {
  dispatchRunRequest,
  launchConfigurationChanged,
  resolveAsFollowUp,
  RUN_ALREADY_RUNNING_ERROR,
  RUN_NOT_RUNNING_ERROR,
} from "./run-dispatch.js";

const request: RunRequest = {
  threadId: "thread-1",
  prompt: "Continue",
  attachments: [],
  model: "",
  effort: "",
  permission: "auto",
};

const accepted: RunResult = { accepted: true };

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

  it("recovers when the renderer missed a warm session's started event", async () => {
    const start = vi.fn().mockResolvedValue({ accepted: false, error: RUN_ALREADY_RUNNING_ERROR });
    const send = vi.fn().mockResolvedValue(accepted);

    await expect(dispatchRunRequest(request, false, { start, send })).resolves.toBe(accepted);
    expect(start).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("recovers when the renderer still remembers a process that has exited", async () => {
    const start = vi.fn().mockResolvedValue(accepted);
    const send = vi.fn().mockResolvedValue({ accepted: false, error: RUN_NOT_RUNNING_ERROR });

    await expect(dispatchRunRequest(request, true, { start, send })).resolves.toBe(accepted);
    expect(send).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not redispatch genuine run errors", async () => {
    const unavailable: RunResult = { accepted: false, error: "The project folder is unavailable." };
    const start = vi.fn().mockResolvedValue(unavailable);
    const send = vi.fn().mockResolvedValue(accepted);

    await expect(dispatchRunRequest(request, false, { start, send })).resolves.toBe(unavailable);
    expect(start).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
