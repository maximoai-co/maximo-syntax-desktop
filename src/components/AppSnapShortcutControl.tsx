import { useRef, useState, type KeyboardEvent } from "react";
import type {
  DesktopAppSnapKeyChord,
  DesktopAppSnapShortcut,
  DesktopAppSnapShortcutAvailability,
  DesktopAppSnapShortcutModifier,
  DesktopAppSnapState,
} from "../../desktop/types";
import {
  DEFAULT_APP_SNAP_SHORTCUT,
  appSnapModifierFromEventCode,
  appSnapShortcutLabels,
  appSnapShortcutModifierLabel,
  appSnapShortcutSystemConflict,
  isAppSnapShortcutKey,
  sameAppSnapShortcut,
} from "../../desktop/app-snap-shortcut";
import { appSnapShortcutConflictCommand, appSnapShortcutConflictLabel } from "../appSnapShortcut";

type ShortcutCheckState =
  | { status: "idle"; availability: null }
  | { status: "checking"; availability: null }
  | { status: "checked"; availability: DesktopAppSnapShortcutAvailability };

interface CaptureState {
  capturing: boolean;
  heldModifierCodes: readonly string[];
  hint: string | null;
}

const IDLE_CAPTURE: CaptureState = { capturing: false, heldModifierCodes: [], hint: null };

function heldModifiers(codes: readonly string[]): readonly DesktopAppSnapShortcutModifier[] {
  const modifiers: DesktopAppSnapShortcutModifier[] = [];
  for (const code of codes) {
    const modifier = appSnapModifierFromEventCode(code);
    if (modifier && !modifiers.includes(modifier)) modifiers.push(modifier);
  }
  return modifiers;
}

export default function AppSnapShortcutControl({
  shortcut,
  enabled,
  reserved,
  onSaved,
  onNotice,
}: {
  shortcut: DesktopAppSnapShortcut;
  enabled: boolean;
  reserved: boolean;
  onSaved: (shortcut: DesktopAppSnapShortcut, state: DesktopAppSnapState) => void;
  onNotice: (title: string, description: string, kind?: "success" | "error") => void;
}) {
  const [capture, setCapture] = useState<CaptureState>(IDLE_CAPTURE);
  const [candidate, setCandidate] = useState<DesktopAppSnapShortcut>(shortcut);
  const [checkState, setCheckState] = useState<ShortcutCheckState>({
    status: "idle",
    availability: null,
  });
  const checkIdRef = useRef(0);
  const heldCodesRef = useRef<string[]>([]);
  const labels = appSnapShortcutLabels(candidate);
  const changed = !sameAppSnapShortcut(candidate, shortcut);
  const canSave = changed && checkState.availability?.available === true;
  const capturedModifiers = heldModifiers(capture.heldModifierCodes);

  function reportUnavailable(reason: string) {
    setCheckState({ status: "checked", availability: { available: false, reason } });
  }

  async function checkCandidate(nextCandidate: DesktopAppSnapKeyChord) {
    const checkId = ++checkIdRef.current;
    const conflictCommand = appSnapShortcutConflictCommand(nextCandidate);
    if (conflictCommand) {
      reportUnavailable(`Maximo Syntax already uses this for “${appSnapShortcutConflictLabel(conflictCommand)}”.`);
      return;
    }
    const systemConflict = appSnapShortcutSystemConflict(nextCandidate);
    if (systemConflict) {
      reportUnavailable(systemConflict);
      return;
    }
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) {
      reportUnavailable("Requires the Maximo Syntax desktop app on macOS.");
      return;
    }
    setCheckState({ status: "checking", availability: null });
    try {
      const availability = await bridge.checkShortcut(nextCandidate);
      if (checkId === checkIdRef.current) {
        setCheckState({ status: "checked", availability });
      }
    } catch (error) {
      if (checkId !== checkIdRef.current) return;
      reportUnavailable(error instanceof Error ? error.message : "Could not check this shortcut.");
    }
  }

  function startCapture() {
    heldCodesRef.current = [];
    setCapture({ capturing: true, heldModifierCodes: [], hint: null });
    setCheckState({ status: "idle", availability: null });
  }

  function stopCapture() {
    heldCodesRef.current = [];
    setCapture(IDLE_CAPTURE);
  }

  function captureKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!capture.capturing || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    const code = event.code;
    if (appSnapModifierFromEventCode(code)) {
      if (!heldCodesRef.current.includes(code)) heldCodesRef.current.push(code);
      setCapture((previous) => ({
        ...previous,
        heldModifierCodes: [...heldCodesRef.current],
        hint: null,
      }));
      return;
    }
    const modifiers = heldModifiers(heldCodesRef.current);
    if (code === "Escape" && modifiers.length === 0) {
      stopCapture();
      return;
    }
    if (!isAppSnapShortcutKey(code)) {
      setCapture((previous) => ({ ...previous, hint: "That key isn't supported — try another." }));
      return;
    }
    if (modifiers.length === 0) {
      setCapture((previous) => ({
        ...previous,
        hint: "Hold ⌘, ⌃, ⌥ or ⇧ first, then press the other key.",
      }));
      return;
    }
    const modifier = modifiers[0];
    if (modifiers.length > 1 || modifier === undefined) {
      setCapture((previous) => ({ ...previous, hint: "Hold only one modifier." }));
      return;
    }
    const nextCandidate: DesktopAppSnapKeyChord = { kind: "key-chord", modifier, key: code };
    stopCapture();
    setCandidate(nextCandidate);
    void checkCandidate(nextCandidate);
  }

  function captureKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (!capture.capturing) return;
    event.preventDefault();
    event.stopPropagation();
    const code = event.code;
    if (!heldCodesRef.current.includes(code)) return;
    heldCodesRef.current = heldCodesRef.current.filter((held) => held !== code);
    setCapture((previous) => ({
      ...previous,
      heldModifierCodes: [...heldCodesRef.current],
    }));
  }

  async function saveShortcut(nextShortcut: DesktopAppSnapShortcut) {
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    const result = await bridge.setShortcut(nextShortcut);
    onSaved(nextShortcut, result.state);
    if (result.availability.available) {
      onNotice(
        "AppSnap shortcut saved",
        enabled
          ? "The shortcut is reserved while AppSnap is enabled."
          : "The shortcut will be reserved when you enable AppSnap.",
        "success",
      );
    } else if (result.availability.reason) {
      onNotice("AppSnap shortcut saved, but unavailable", result.availability.reason, "error");
    }
  }

  const statusText = capture.capturing
    ? (capture.hint ??
      (capturedModifiers.length > 0
        ? "Now press the other key…"
        : "Hold a modifier, then press one other key. Esc cancels."))
    : checkState.status === "checking"
      ? "Checking macOS and other apps…"
      : checkState.availability
        ? checkState.availability.available
          ? "Available — save to apply."
          : checkState.availability.reason
        : changed
          ? "Check a new combination before saving."
          : reserved && candidate.kind === "key-chord"
            ? "Available and reserved"
            : "Current shortcut";

  return (
    <div className="appsnap-shortcut-control">
      <div className="appsnap-shortcut-row">
        <button
          type="button"
          aria-label="Record AppSnap shortcut"
          aria-pressed={capture.capturing}
          onClick={startCapture}
          onKeyDown={captureKeyDown}
          onKeyUp={captureKeyUp}
          onBlur={stopCapture}
          className={`appsnap-shortcut-record ${capture.capturing ? "capturing" : ""}`}
        >
          {capture.capturing ? (
            capturedModifiers.length > 0 ? (
              <span className="appsnap-kbd-group">
                {capturedModifiers.map((modifier) => (
                  <kbd key={modifier}>{appSnapShortcutModifierLabel(modifier)}</kbd>
                ))}
                <span>+</span>
                <span className="appsnap-shortcut-pulse">…</span>
              </span>
            ) : (
              <span className="appsnap-shortcut-pulse">Press two keys…</span>
            )
          ) : (
            <span className="appsnap-kbd-group">
              <kbd>{labels[0]}</kbd>
              <span>+</span>
              <kbd>{labels[1]}</kbd>
            </span>
          )}
        </button>
        {changed ? (
          <button type="button" className="settings-action" disabled={!canSave} onClick={() => void saveShortcut(candidate)}>
            Save
          </button>
        ) : candidate.kind !== "both-option-keys" ? (
          <button type="button" className="settings-action" onClick={() => void saveShortcut(DEFAULT_APP_SNAP_SHORTCUT)}>
            Reset
          </button>
        ) : null}
      </div>
      <span
        role="status"
        className={`appsnap-shortcut-status ${
          checkState.availability?.available === false
            ? "error"
            : checkState.availability?.available === true
              ? "ok"
              : ""
        }`}
      >
        {statusText}
      </span>
    </div>
  );
}
