import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { Attachment, DesktopAppSnapCapture, DesktopAppSnapShortcut } from "../../desktop/types";
import {
  type AppSnapThreadTarget,
  type TimedAppSnapThreadTarget,
  hasHydratedAppSnapCapture,
  hasPersistedAppSnapCapture,
  resolveAppSnapTarget,
} from "../appSnap.logic";
import { dispatchAppSnapAttach } from "../appSnapEvents";
import { playAppSnapCaptureSound } from "../appSnapSound";
import { normalizeComposerImageSource } from "../appSnapSource";

const MAX_REMEMBERED_CAPTURE_IDS = 100;

interface AppSnapToast {
  id: number;
  type: "success" | "error" | "warning";
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

function captureTimestampMs(capture: DesktopAppSnapCapture): number {
  const parsed = Date.parse(capture.capturedAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function captureBytes(capture: DesktopAppSnapCapture): Uint8Array {
  const raw = capture.bytes as unknown;
  if (raw instanceof Uint8Array) return raw;
  if (raw && typeof raw === "object" && ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return new Uint8Array();
}

function rememberCaptureId(captureIds: Map<string, true>, captureId: string): boolean {
  if (captureIds.has(captureId)) return false;
  captureIds.set(captureId, true);
  while (captureIds.size > MAX_REMEMBERED_CAPTURE_IDS) {
    const oldest = captureIds.keys().next().value as string | undefined;
    if (!oldest) break;
    captureIds.delete(oldest);
  }
  return true;
}

export default function AppSnapCoordinator({
  enableAppSnap,
  shortcut,
  playSound,
  selectedThreadId,
  threadIds,
  getDrafts,
  onAttachToDraft,
  onActivateThread,
  onCreateThread,
}: {
  enableAppSnap: boolean;
  shortcut: DesktopAppSnapShortcut;
  playSound: boolean;
  selectedThreadId: string | null;
  threadIds: readonly string[];
  getDrafts: () => Record<string, { attachments: Attachment[] } | undefined>;
  onAttachToDraft: (threadId: string, attachment: Attachment) => boolean;
  onActivateThread: (threadId: string) => void;
  onCreateThread: () => Promise<string | null>;
}) {
  const focusedTargetRef = useRef<AppSnapThreadTarget | null>(null);
  const lastInteractionRef = useRef<TimedAppSnapThreadTarget | null>(null);
  const lastAppSnapRef = useRef<TimedAppSnapThreadTarget | null>(null);
  const captureIdsRef = useRef(new Map<string, true>());
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachCaptureRef = useRef<((capture: DesktopAppSnapCapture) => Promise<void>) | null>(null);
  const playCaptureSoundRef = useRef(playSound);
  const enableAppSnapRef = useRef(enableAppSnap);
  const getDraftsRef = useRef(getDrafts);
  const threadIdsRef = useRef(threadIds);
  const [toasts, setToasts] = useState<AppSnapToast[]>([]);
  const toastIdRef = useRef(0);

  useEffect(() => {
    playCaptureSoundRef.current = playSound;
    enableAppSnapRef.current = enableAppSnap;
  }, [enableAppSnap, playSound]);
  useEffect(() => {
    getDraftsRef.current = getDrafts;
  }, [getDrafts]);
  useEffect(() => {
    threadIdsRef.current = threadIds;
  }, [threadIds]);

  const pushToast = useCallback((toast: Omit<AppSnapToast, "id">) => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, { ...toast, id }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5_000);
  }, []);

  useEffect(() => {
    const nextTarget = selectedThreadId ? { threadId: selectedThreadId } : null;
    focusedTargetRef.current = nextTarget;
    if (nextTarget) lastInteractionRef.current = { ...nextTarget, atMs: Date.now() };
  }, [selectedThreadId]);

  useEffect(() => {
    const recordInteraction = () => {
      const target = focusedTargetRef.current;
      if (target) lastInteractionRef.current = { ...target, atMs: Date.now() };
    };
    window.addEventListener("pointerdown", recordInteraction, { capture: true });
    window.addEventListener("keydown", recordInteraction, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", recordInteraction, { capture: true });
      window.removeEventListener("keydown", recordInteraction, { capture: true });
    };
  }, []);

  const shortcutModifier = shortcut.kind === "key-chord" ? shortcut.modifier : null;
  const shortcutKey = shortcut.kind === "key-chord" ? shortcut.key : null;

  useEffect(() => {
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    const nextShortcut: DesktopAppSnapShortcut =
      shortcutModifier && shortcutKey
        ? { kind: "key-chord", modifier: shortcutModifier, key: shortcutKey }
        : { kind: "both-option-keys" };
    void bridge
      .setShortcut(nextShortcut)
      .then((result) => {
        if (!result.availability.available) {
          console.warn("[appsnap] Saved shortcut is unavailable", result.availability.reason);
        }
        return bridge.setEnabled(enableAppSnap);
      })
      .catch((error) => {
        console.warn("[appsnap] Could not update native listener state", error);
      });
  }, [enableAppSnap, shortcutKey, shortcutModifier]);

  const attachCapture = useCallback(async (capture: DesktopAppSnapCapture) => {
    const captureAtMs = captureTimestampMs(capture);
    const availableIds = new Set(threadIdsRef.current);
    const resolvedTarget = resolveAppSnapTarget({
      captureAtMs,
      lastInteraction: lastInteractionRef.current,
      lastAppSnap: lastAppSnapRef.current,
      isThreadAvailable: (threadId) => availableIds.has(threadId),
    });

    let target: AppSnapThreadTarget;
    if (resolvedTarget.kind === "existing") {
      target = resolvedTarget.target;
      onActivateThread(target.threadId);
    } else {
      const threadId = await onCreateThread();
      if (threadId) {
        target = { threadId };
      } else {
        const focused = focusedTargetRef.current;
        if (!focused) throw new Error("Maximo Syntax could not create a chat for this AppSnap.");
        target = focused;
        onActivateThread(target.threadId);
      }
    }

    const bytes = captureBytes(capture);
    if (bytes.byteLength === 0) throw new Error("The captured AppSnap is empty.");
    const saved = await window.maximoDesktop.savePastedAttachment(capture.name, bytes);
    if (!saved.attachment) {
      throw new Error(saved.rejection?.reason ?? "Maximo Syntax could not attach the captured AppSnap.");
    }
    const source = normalizeComposerImageSource({
      kind: "appsnap",
      captureId: capture.id,
      capturedAt: capture.capturedAt,
      appName: capture.sourceAppName,
      bundleIdentifier: capture.sourceBundleIdentifier,
      appIconDataUrl: capture.sourceAppIconDataUrl,
      windowTitle: capture.sourceWindowTitle,
    });
    const attachment: Attachment = source ? { ...saved.attachment, source } : saved.attachment;
    if (!onAttachToDraft(target.threadId, attachment)) {
      throw new Error("The AppSnap was prepared, but this message already has the maximum number of attachments.");
    }
    dispatchAppSnapAttach(target.threadId, attachment);
    lastAppSnapRef.current = { ...target, atMs: captureAtMs };
    pushToast({
      type: "success",
      title: "AppSnap added",
      description: capture.sourceAppName
        ? `Captured ${capture.sourceAppName} and added it to the composer.`
        : "The frontmost window was added to the composer.",
    });
  }, [onActivateThread, onAttachToDraft, onCreateThread, pushToast]);

  useEffect(() => {
    attachCaptureRef.current = attachCapture;
  }, [attachCapture]);

  useEffect(() => {
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    let disposed = false;

    const enqueueCapture = (capture: DesktopAppSnapCapture) => {
      if (disposed || !rememberCaptureId(captureIdsRef.current, capture.id)) return;
      captureQueueRef.current = captureQueueRef.current
        .then(async () => {
          const currentDrafts = Object.values(getDraftsRef.current());
          if (hasPersistedAppSnapCapture(currentDrafts, capture.id) && hasHydratedAppSnapCapture(currentDrafts, capture.id)) {
            await bridge.acknowledgeCapture(capture.id).catch((error) => console.warn("[appsnap] Could not acknowledge capture", error));
            return;
          }
          try {
            const attach = attachCaptureRef.current;
            if (!attach) throw new Error("The AppSnap composer is not ready yet.");
            await attach(capture);
          } catch (error) {
            pushToast({
              type: "error",
              title: "AppSnap could not be added",
              description: error instanceof Error ? error.message : "AppSnap capture failed.",
              action: {
                label: "Retry",
                onClick: () => {
                  captureIdsRef.current.delete(capture.id);
                  enqueueCapture(capture);
                },
              },
            });
            return;
          }
          await bridge.acknowledgeCapture(capture.id).catch((error) => console.warn("[appsnap] Could not acknowledge capture", error));
        })
        .catch(() => undefined);
    };

    const unsubscribeCaptured = bridge.onCaptured((capture) => {
      if (playCaptureSoundRef.current && !captureIdsRef.current.has(capture.id)) {
        void playAppSnapCaptureSound();
      }
      enqueueCapture(capture);
    });
    const unsubscribeError = bridge.onError((error) => {
      pushToast({
        type: "error",
        title: "AppSnap failed",
        description: error.message,
        ...(error.code === "helper-stopped"
          ? {
              action: {
                label: "Restart",
                onClick: () => {
                  void bridge
                    .setEnabled(enableAppSnapRef.current)
                    .catch((restartError) => console.warn("[appsnap] Could not restart native listener", restartError));
                },
              },
            }
          : {}),
      });
    });
    void bridge
      .listPendingCaptures()
      .then((captures) => captures.forEach(enqueueCapture))
      .catch((error) => console.warn("[appsnap] Could not restore pending captures", error));

    return () => {
      disposed = true;
      unsubscribeCaptured();
      unsubscribeError();
    };
  }, [pushToast]);

  if (toasts.length === 0) return null;
  return createPortal(
    <div className="appsnap-toast-stack" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className={`appsnap-toast ${toast.type}`}>
          {toast.type === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <div>
            <strong>{toast.title}</strong>
            <small>{toast.description}</small>
          </div>
          {toast.action ? (
            <button type="button" onClick={toast.action.onClick}>{toast.action.label}</button>
          ) : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}
