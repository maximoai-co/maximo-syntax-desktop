import { afterEach, describe, expect, it } from "vitest";
import { observeUserMessageOverflow } from "./userMessageOverflowObserver.js";

const originalResizeObserver = globalThis.ResizeObserver;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

afterEach(() => {
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: originalResizeObserver });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, writable: true, value: originalRequestAnimationFrame });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, writable: true, value: originalCancelAnimationFrame });
});

describe("observeUserMessageOverflow", () => {
  it("shares one observer and batches repeated resize entries into one frame", () => {
    let observerCount = 0;
    let callback: ResizeObserverCallback | undefined;
    let scheduledFrame: FrameRequestCallback | undefined;
    class FakeResizeObserver {
      constructor(next: ResizeObserverCallback) {
        observerCount += 1;
        callback = next;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: FakeResizeObserver });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: (next: FrameRequestCallback) => { scheduledFrame = next; return 1; },
    });
    Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, writable: true, value: () => undefined });

    const first = {} as HTMLElement;
    const second = {} as HTMLElement;
    let firstMeasures = 0;
    let secondMeasures = 0;
    const stopFirst = observeUserMessageOverflow(first, () => { firstMeasures += 1; });
    const stopSecond = observeUserMessageOverflow(second, () => { secondMeasures += 1; });

    callback?.([
      { target: first } as unknown as ResizeObserverEntry,
      { target: second } as unknown as ResizeObserverEntry,
      { target: first } as unknown as ResizeObserverEntry,
    ], {} as ResizeObserver);
    expect(observerCount).toBe(1);
    expect(firstMeasures).toBe(0);
    expect(secondMeasures).toBe(0);

    scheduledFrame?.(0);
    expect(firstMeasures).toBe(1);
    expect(secondMeasures).toBe(1);
    stopFirst();
    stopSecond();
  });
});
