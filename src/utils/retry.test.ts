import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_RETRIES, getRetryMessage, isRetryableError } from "./retry.js";

describe("retry helpers", () => {
  it("retries five times by default", () => {
    expect(DEFAULT_MAX_RETRIES).toBe(5);
  });

  it("treats fetch failed and OpenAI-compatible 429s as retryable", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error('OpenAI-compatible API error 429: {"error":{"code":"token_limit_exceeded","type":"rate_limit_error"}}'))).toBe(true);
    expect(isRetryableError({ status: 429, message: "token_limit_exceeded" })).toBe(true);
  });

  it("does not retry auth or user-abort errors", () => {
    expect(isRetryableError(new Error("unauthorized"))).toBe(false);
    expect(isRetryableError(new DOMException("Aborted", "AbortError"))).toBe(false);
  });

  it("shows a short retrying label for rate limits and network drops", () => {
    expect(getRetryMessage(new Error("fetch failed"))).toBe("Connection issue — retrying");
    expect(getRetryMessage(new Error("token_limit_exceeded"))).toBe("Rate limit reached — retrying shortly");
  });
});
