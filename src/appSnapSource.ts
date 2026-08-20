import type { AppSnapSource } from "../desktop/types";

export function isComposerAppSnapCaptureSource(value: unknown, captureId: string): boolean {
  if (!value || typeof value !== "object" || captureId.length === 0) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "appsnap" || candidate.kind === "appshot") &&
    candidate.captureId === captureId
  );
}

function normalizeAppIconDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 256_000) return null;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
}

export function normalizeComposerImageSource(value: unknown): AppSnapSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.kind !== "appsnap" && candidate.kind !== "appshot") ||
    typeof candidate.captureId !== "string" ||
    candidate.captureId.length === 0 ||
    typeof candidate.capturedAt !== "string"
  ) {
    return undefined;
  }
  return {
    kind: "appsnap",
    captureId: candidate.captureId,
    capturedAt: candidate.capturedAt,
    appName: typeof candidate.appName === "string" ? candidate.appName : null,
    bundleIdentifier: typeof candidate.bundleIdentifier === "string" ? candidate.bundleIdentifier : null,
    appIconDataUrl: normalizeAppIconDataUrl(candidate.appIconDataUrl),
    windowTitle: typeof candidate.windowTitle === "string" ? candidate.windowTitle : null,
  };
}
