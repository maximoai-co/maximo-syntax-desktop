import { isComposerAppSnapCaptureSource } from "./appSnapSource";

export const APPSNAP_RECENT_TARGET_WINDOW_MS = 60_000;

export interface AppSnapThreadTarget {
  threadId: string;
}

export interface TimedAppSnapThreadTarget extends AppSnapThreadTarget {
  atMs: number;
}

export type ResolvedAppSnapTarget =
  | { kind: "existing"; target: AppSnapThreadTarget }
  | { kind: "fresh" };

export interface LatestAppSnapRequestGuard {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
}

export function createLatestAppSnapRequestGuard(): LatestAppSnapRequestGuard {
  let latestRequestId = 0;
  return {
    begin: () => {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent: (requestId) => requestId === latestRequestId,
  };
}

interface AppSnapSourceCarrier {
  path?: unknown;
  source?:
    | {
        kind?: unknown;
        captureId?: unknown;
      }
    | null
    | undefined;
}

interface AppSnapCaptureDraft {
  attachments?: ReadonlyArray<AppSnapSourceCarrier> | undefined;
}

function isCaptureEntry(entry: AppSnapSourceCarrier, captureId: string): boolean {
  return isComposerAppSnapCaptureSource(entry.source, captureId);
}

export function hasPersistedAppSnapCapture(
  drafts: Iterable<AppSnapCaptureDraft | undefined>,
  captureId: string,
): boolean {
  if (captureId.length === 0) return false;
  for (const draft of drafts) {
    if (!draft) continue;
    if ((draft.attachments ?? []).some((entry) => isCaptureEntry(entry, captureId))) return true;
  }
  return false;
}

export function hasHydratedAppSnapCapture(
  drafts: Iterable<AppSnapCaptureDraft | undefined>,
  captureId: string,
): boolean {
  if (captureId.length === 0) return false;
  for (const draft of drafts) {
    if (!draft) continue;
    if (
      (draft.attachments ?? []).some(
        (entry) => isCaptureEntry(entry, captureId) && typeof entry.path === "string" && entry.path.length > 0,
      )
    ) {
      return true;
    }
  }
  return false;
}

function isRecent(atMs: number, captureAtMs: number): boolean {
  const ageMs = captureAtMs - atMs;
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= APPSNAP_RECENT_TARGET_WINDOW_MS;
}

export function resolveAppSnapTarget(input: {
  captureAtMs: number;
  lastInteraction: TimedAppSnapThreadTarget | null;
  lastAppSnap: TimedAppSnapThreadTarget | null;
  isThreadAvailable: (threadId: string) => boolean;
}): ResolvedAppSnapTarget {
  const { captureAtMs, lastInteraction, lastAppSnap, isThreadAvailable } = input;

  const recentInteraction =
    lastInteraction &&
    isRecent(lastInteraction.atMs, captureAtMs) &&
    isThreadAvailable(lastInteraction.threadId)
      ? lastInteraction
      : null;
  const recentAppSnap =
    lastAppSnap &&
    isRecent(lastAppSnap.atMs, captureAtMs) &&
    isThreadAvailable(lastAppSnap.threadId)
      ? lastAppSnap
      : null;

  // A newer explicit task interaction overrides the affinity created by an older AppSnap.
  if (recentInteraction && (!recentAppSnap || recentInteraction.atMs >= recentAppSnap.atMs)) {
    return { kind: "existing", target: { threadId: recentInteraction.threadId } };
  }

  // Consecutive AppSnaps stay together even while the user remains in the external app.
  if (recentAppSnap) {
    return { kind: "existing", target: { threadId: recentAppSnap.threadId } };
  }

  return { kind: "fresh" };
}
