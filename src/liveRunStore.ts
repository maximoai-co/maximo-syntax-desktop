import { startTransition, useEffect, useState } from "react";
import type { RunActivity, RunTimelineItem } from "../desktop/types";

export interface LiveRun {
  text: string;
  activity: RunActivity[];
  timeline: RunTimelineItem[];
  logs: Array<{ level: string; text: string; timestamp: number }>;
}

type LiveRunListener = (run: LiveRun | undefined) => void;

export const LIVE_INTERACTION_IDLE_MS = 500;

let liveRuns: Record<string, LiveRun> = {};
const listenersByThread = new Map<string, Set<LiveRunListener>>();
const pendingThreadNotifications = new Set<string>();
const pendingInteractionTasks = new Map<string, () => void>();
let interactionDeadline = 0;
let interactionTimer: ReturnType<typeof setTimeout> | null = null;

function interactionRemaining(): number {
  return Math.max(0, interactionDeadline - Date.now());
}

function notifyLiveRun(threadId: string): void {
  const listeners = listenersByThread.get(threadId);
  if (!listeners?.size) return;
  const run = liveRuns[threadId];
  for (const listener of [...listeners]) listener(run);
}

function flushAfterInteraction(): void {
  interactionTimer = null;
  const remaining = interactionRemaining();
  if (remaining > 0) {
    interactionTimer = setTimeout(flushAfterInteraction, remaining);
    return;
  }
  const threadIds = [...pendingThreadNotifications];
  pendingThreadNotifications.clear();
  for (const threadId of threadIds) notifyLiveRun(threadId);
  const tasks = [...pendingInteractionTasks.values()];
  pendingInteractionTasks.clear();
  for (const task of tasks) task();
}

function ensureInteractionFlush(): void {
  if (interactionTimer !== null) return;
  interactionTimer = setTimeout(flushAfterInteraction, Math.max(1, interactionRemaining()));
}

/**
 * Marks a short user-input window. Visual stream work is coalesced while this
 * window is active so renderer layout/paint can never compete with a typing or
 * scrolling gesture. The latest snapshot catches up after the user goes idle.
 */
export function markLiveInteraction(durationMs = LIVE_INTERACTION_IDLE_MS): void {
  interactionDeadline = Math.max(interactionDeadline, Date.now() + durationMs);
  if (pendingThreadNotifications.size > 0 || pendingInteractionTasks.size > 0) ensureInteractionFlush();
}

export function isLiveInteractionActive(): boolean {
  return interactionRemaining() > 0;
}

/** Coalesce non-critical UI work by key until active input has gone idle. */
export function scheduleAfterLiveInteraction(key: string, task: () => void): void {
  if (!isLiveInteractionActive()) {
    task();
    return;
  }
  pendingInteractionTasks.set(key, task);
  ensureInteractionFlush();
}

export function getLiveRunsSnapshot(): Record<string, LiveRun> {
  return liveRuns;
}

export function getLiveRun(threadId: string | undefined): LiveRun | undefined {
  return threadId ? liveRuns[threadId] : undefined;
}

export function subscribeLiveRun(threadId: string, listener: LiveRunListener): () => void {
  const listeners = listenersByThread.get(threadId) ?? new Set<LiveRunListener>();
  listeners.add(listener);
  listenersByThread.set(threadId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByThread.delete(threadId);
  };
}

/**
 * Publishes immutable per-thread snapshots without touching the app shell.
 * Only mounted consumers for threads whose snapshot identity changed are told
 * about an update; background runs therefore cost no React render work.
 */
export function publishLiveRuns(next: Record<string, LiveRun>, threadIds: Iterable<string>): void {
  const previous = liveRuns;
  liveRuns = next;
  for (const threadId of new Set(threadIds)) {
    if (previous[threadId] === next[threadId]) continue;
    if (isLiveInteractionActive()) {
      pendingThreadNotifications.add(threadId);
      ensureInteractionFlush();
    } else {
      pendingThreadNotifications.delete(threadId);
      notifyLiveRun(threadId);
    }
  }
}

/**
 * Streaming paints are deliberately transition-priority. Native typing,
 * scrolling, and disclosure clicks can interrupt an in-progress live-tail
 * render instead of waiting behind it.
 */
export function useLiveRun(threadId: string | undefined): LiveRun | undefined {
  // First paint never mounts a potentially large in-progress tail. Subscribe
  // after the urgent shell/composer paint, then catch up at transition priority.
  const [run, setRun] = useState<LiveRun | undefined>();

  useEffect(() => {
    if (!threadId) {
      setRun(undefined);
      return;
    }
    const update = (next: LiveRun | undefined) => {
      startTransition(() => setRun(next));
    };
    const unsubscribe = subscribeLiveRun(threadId, update);
    // Close the render-to-effect race if a chunk arrived before subscription.
    if (isLiveInteractionActive()) {
      pendingThreadNotifications.add(threadId);
      ensureInteractionFlush();
    } else {
      update(getLiveRun(threadId));
    }
    return unsubscribe;
  }, [threadId]);

  return run;
}

export function resetLiveRunStoreForTests(): void {
  if (interactionTimer !== null) clearTimeout(interactionTimer);
  liveRuns = {};
  listenersByThread.clear();
  pendingThreadNotifications.clear();
  pendingInteractionTasks.clear();
  interactionDeadline = 0;
  interactionTimer = null;
}
