import { describe, expect, it } from "vitest";
import { visibleRetryNotice, type ProviderRetryState, type TransientRetryState } from "./TransientRetryNotice";

const providerRetry: ProviderRetryState = {
  threadId: "chat-a",
  attempt: 1,
  max: 3,
  message: "Connection issue",
};

const ipcRetry: NonNullable<TransientRetryState> = {
  attempt: 2,
  max: 5,
  message: "Reading git status",
};

describe("visibleRetryNotice", () => {
  it("shows the provider retry only on the session that is retrying", () => {
    expect(visibleRetryNotice(providerRetry, null, "chat-a")).toEqual(providerRetry);
  });

  it("hides the provider retry when viewing a different session", () => {
    expect(visibleRetryNotice(providerRetry, null, "chat-b")).toBeNull();
  });

  it("does not follow into a session with no selected chat", () => {
    expect(visibleRetryNotice(providerRetry, null, undefined)).toBeNull();
    expect(visibleRetryNotice(providerRetry, null, null)).toBeNull();
  });

  it("falls back to an app-wide IPC retry on other sessions", () => {
    expect(visibleRetryNotice(providerRetry, ipcRetry, "chat-b")).toEqual(ipcRetry);
  });

  it("keeps the provider retry on top of an IPC retry in the same session", () => {
    expect(visibleRetryNotice(providerRetry, ipcRetry, "chat-a")).toEqual(providerRetry);
  });

  it("still shows app-wide IPC retries when no provider retry is active", () => {
    expect(visibleRetryNotice(null, ipcRetry, "chat-a")).toEqual(ipcRetry);
    expect(visibleRetryNotice(null, ipcRetry, "chat-b")).toEqual(ipcRetry);
  });
});
