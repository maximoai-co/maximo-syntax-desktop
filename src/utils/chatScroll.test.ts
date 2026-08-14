import { describe, expect, it } from "vitest";
import { shouldStickToScrollBottom } from "./chatScroll.js";

function scrollElement(distanceFromBottom: number): HTMLElement {
  return {
    scrollHeight: 1_000,
    clientHeight: 400,
    scrollTop: 600 - distanceFromBottom,
  } as HTMLElement;
}

describe("shouldStickToScrollBottom", () => {
  it("keeps an existing live follow through a small layout shift", () => {
    expect(shouldStickToScrollBottom(scrollElement(40), true, false)).toBe(true);
  });

  it("does not recapture a user who only scrolled near the bottom", () => {
    expect(shouldStickToScrollBottom(scrollElement(20), false, false)).toBe(false);
  });

  it("resumes after the user deliberately returns to the live edge", () => {
    expect(shouldStickToScrollBottom(scrollElement(2), false, false)).toBe(true);
  });

  it("does not resume while the user is interacting with transcript content", () => {
    expect(shouldStickToScrollBottom(scrollElement(0), false, true)).toBe(false);
  });
});
