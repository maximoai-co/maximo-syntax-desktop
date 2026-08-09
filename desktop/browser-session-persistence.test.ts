import { describe, expect, it, vi } from "vitest";
import { flushPersistentBrowserSession } from "./browser-session-persistence.js";

describe("persistent browser session", () => {
  it("flushes site storage and waits for cookies to reach disk", async () => {
    let finishCookieFlush: (() => void) | undefined;
    const flushStorageData = vi.fn();
    const flushStore = vi.fn(() => new Promise<void>((resolve) => {
      finishCookieFlush = resolve;
    }));
    let finished = false;

    const flush = flushPersistentBrowserSession({
      flushStorageData,
      cookies: { flushStore },
    }).then(() => {
      finished = true;
    });

    expect(flushStorageData).toHaveBeenCalledOnce();
    expect(flushStore).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(finished).toBe(false);

    finishCookieFlush?.();
    await flush;
    expect(finished).toBe(true);
  });

  it("does not let a stalled cookie store hang app shutdown", async () => {
    vi.useFakeTimers();
    try {
      const flush = flushPersistentBrowserSession({
        flushStorageData: vi.fn(),
        cookies: { flushStore: () => new Promise<void>(() => undefined) },
      });
      const rejection = expect(flush).rejects.toThrow("Timed out while saving the browser session.");

      await vi.advanceTimersByTimeAsync(2_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
