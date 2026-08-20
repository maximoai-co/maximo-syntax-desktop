import { describe, expect, it } from "vitest";
import { isComposerAppSnapCaptureSource, normalizeComposerImageSource } from "./appSnapSource";

describe("AppSnap composer provenance", () => {
  it("matches current and legacy capture kinds", () => {
    expect(isComposerAppSnapCaptureSource({ kind: "appsnap", captureId: "c1" }, "c1")).toBe(true);
    expect(isComposerAppSnapCaptureSource({ kind: "appshot", captureId: "c1" }, "c1")).toBe(true);
    expect(isComposerAppSnapCaptureSource({ kind: "appsnap", captureId: "c1" }, "other")).toBe(false);
  });

  it("normalizes source metadata and rejects invalid icons", () => {
    expect(
      normalizeComposerImageSource({
        kind: "appshot",
        captureId: "c1",
        capturedAt: "2026-08-20T00:00:00.000Z",
        appName: "Safari",
        windowTitle: "Inbox",
        appIconDataUrl: "data:image/png;base64,aWNvbg==",
      }),
    ).toEqual({
      kind: "appsnap",
      captureId: "c1",
      capturedAt: "2026-08-20T00:00:00.000Z",
      appName: "Safari",
      bundleIdentifier: null,
      appIconDataUrl: "data:image/png;base64,aWNvbg==",
      windowTitle: "Inbox",
    });
    expect(
      normalizeComposerImageSource({
        kind: "appsnap",
        captureId: "c1",
        capturedAt: "2026-08-20T00:00:00.000Z",
        appIconDataUrl: "https://example.com/icon.png",
      })?.appIconDataUrl,
    ).toBeNull();
  });
});
