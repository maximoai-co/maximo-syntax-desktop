import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLiveRun,
  markLiveInteraction,
  publishLiveRuns,
  resetLiveRunStoreForTests,
  scheduleAfterLiveInteraction,
  subscribeLiveRun,
  type LiveRun,
} from "./liveRunStore";

const run = (text: string): LiveRun => ({ text, activity: [], timeline: [], logs: [] });

afterEach(() => {
  resetLiveRunStoreForTests();
  vi.useRealTimers();
});

describe("live run store", () => {
  it("notifies only the changed thread subscriber", () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeLiveRun("first", first);
    subscribeLiveRun("second", second);

    const firstRun = run("one");
    publishLiveRuns({ first: firstRun }, ["first"]);

    expect(first).toHaveBeenCalledWith(firstRun);
    expect(second).not.toHaveBeenCalled();
    expect(getLiveRun("first")).toBe(firstRun);
  });

  it("does not notify when the immutable snapshot did not change", () => {
    const listener = vi.fn();
    subscribeLiveRun("thread", listener);
    const snapshot = run("same");
    publishLiveRuns({ thread: snapshot }, ["thread"]);
    listener.mockClear();

    publishLiveRuns({ thread: snapshot }, ["thread"]);

    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes deletion to the mounted thread", () => {
    const listener = vi.fn();
    subscribeLiveRun("thread", listener);
    publishLiveRuns({ thread: run("working") }, ["thread"]);
    listener.mockClear();

    publishLiveRuns({}, ["thread"]);

    expect(listener).toHaveBeenCalledWith(undefined);
  });

  it("coalesces stream paints until typing or scrolling goes idle", () => {
    vi.useFakeTimers();
    const listener = vi.fn();
    subscribeLiveRun("thread", listener);
    markLiveInteraction();

    const first = run("first");
    const latest = run("latest");
    publishLiveRuns({ thread: first }, ["thread"]);
    publishLiveRuns({ thread: latest }, ["thread"]);

    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(499);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(latest);
  });

  it("coalesces non-critical completion work by key during interaction", () => {
    vi.useFakeTimers();
    const stale = vi.fn();
    const latest = vi.fn();
    markLiveInteraction();

    scheduleAfterLiveInteraction("thread-state", stale);
    scheduleAfterLiveInteraction("thread-state", latest);
    vi.advanceTimersByTime(500);

    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
  });
});
