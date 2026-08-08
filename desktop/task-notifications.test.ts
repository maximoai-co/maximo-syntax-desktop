import { describe, expect, it } from "vitest";
import { createInitialState } from "./state-store.js";
import { taskCompletionNotification } from "./task-notifications.js";

function stateWithThread(status: "idle" | "running" | "complete" | "error" | "cancelled", unread: boolean, selected = false) {
  const state = createInitialState();
  state.threads = [{
    id: "thread-1",
    projectId: "project-1",
    title: "Fix notifications",
    messages: [],
    status,
    unread,
    createdAt: 1,
    updatedAt: 2,
  }];
  state.selectedThreadId = selected ? "thread-1" : undefined;
  return state;
}

describe("taskCompletionNotification", () => {
  it("returns a notification for a completed unread background chat", () => {
    expect(taskCompletionNotification(stateWithThread("complete", true), "thread-1")).toEqual({
      title: "Fix notifications",
      body: "Finished successfully.",
      threadId: "thread-1",
    });
  });

  it("describes error and cancelled completions", () => {
    expect(taskCompletionNotification(stateWithThread("error", true), "thread-1")?.body).toBe("Ended with an error.");
    expect(taskCompletionNotification(stateWithThread("cancelled", true), "thread-1")?.body).toBe("Was stopped.");
  });

  it("does not notify for foreground, read, idle, or continuing chats", () => {
    expect(taskCompletionNotification(stateWithThread("complete", true, true), "thread-1")).toBeNull();
    expect(taskCompletionNotification(stateWithThread("complete", false), "thread-1")).toBeNull();
    expect(taskCompletionNotification(stateWithThread("idle", true), "thread-1")).toBeNull();
    expect(taskCompletionNotification(stateWithThread("running", true), "thread-1")).toBeNull();
  });
});
