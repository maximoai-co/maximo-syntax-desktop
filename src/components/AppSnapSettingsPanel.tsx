import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { DesktopAppSnapPermission, DesktopAppSnapShortcut, DesktopAppSnapState, Settings } from "../../desktop/types";
import { DEFAULT_SETTINGS } from "../../desktop/types";
import { appSnapShortcutLabels } from "../../desktop/app-snap-shortcut";
import { createLatestAppSnapRequestGuard } from "../appSnap.logic";
import { playAppSnapCaptureSound } from "../appSnapSound";
import AppSnapShortcutControl from "./AppSnapShortcutControl";

const APPSNAP_PERMISSION_LABELS: Record<DesktopAppSnapPermission, string> = {
  granted: "Granted",
  denied: "Denied",
  "not-determined": "Not requested yet",
  restricted: "Restricted",
  unknown: "Unknown",
};

function appSnapStatusText(state: DesktopAppSnapState | null): string {
  if (!state) return "Available in the Maximo Syntax desktop app";
  if (!state.supported) return state.message ?? "Available on macOS only";
  if (state.status === "ready") {
    const shortcut = state.shortcut;
    const label = shortcut ? appSnapShortcutLabels(shortcut).join(" + ") : "the shortcut";
    return `Listening — press ${label} to snap`;
  }
  if (state.status === "disabled") return "Off";
  if (state.status === "starting") return "Starting the capture listener…";
  return state.message ?? "Permission setup required";
}

function AppSnapPermissionBadge({ permission }: { permission: DesktopAppSnapPermission }) {
  const tone = permission === "granted" ? "granted" : permission === "denied" || permission === "restricted" ? "denied" : "unknown";
  return (
    <span className="appsnap-permission-badge">
      <span aria-hidden className={`appsnap-permission-dot ${tone}`} />
      {APPSNAP_PERMISSION_LABELS[permission]}
    </span>
  );
}

export default function AppSnapSettingsPanel({
  values,
  onValuesChange,
  onPersist,
  onNotice,
}: {
  values: Settings;
  onValuesChange: (patch: Partial<Settings>) => void;
  onPersist: (patch: Partial<Settings>) => Promise<void>;
  onNotice: (title: string, description: string, kind?: "success" | "error" | "warning") => void;
}) {
  const [appSnapState, setAppSnapState] = useState<DesktopAppSnapState | null>(null);
  const appSnapRequestGuardRef = useRef(createLatestAppSnapRequestGuard());

  useEffect(() => {
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    let disposed = false;
    const unsubscribe = bridge.onState((state) => {
      if (!disposed) setAppSnapState(state);
    });
    void bridge
      .getState()
      .then((state) => {
        if (!disposed) setAppSnapState(state);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  async function setAppSnapEnabled(nextEnabled: boolean) {
    const requestGuard = appSnapRequestGuardRef.current;
    const requestId = requestGuard.begin();
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) {
      onNotice("AppSnap unavailable", "AppSnap requires the Maximo Syntax desktop app on macOS.", "warning");
      return;
    }

    try {
      if (nextEnabled) {
        const permissionState = await bridge.requestPermissions();
        if (!requestGuard.isCurrent(requestId)) return;
        setAppSnapState(permissionState);
      }
      if (!requestGuard.isCurrent(requestId)) return;
      onValuesChange({ enableAppSnap: nextEnabled });
      await onPersist({ enableAppSnap: nextEnabled });
      const state = await bridge.setEnabled(nextEnabled);
      if (!requestGuard.isCurrent(requestId)) return;
      setAppSnapState(state);
      if (nextEnabled && (state.status === "permission-required" || state.status === "error")) {
        const pane = state.permissionPrompt === "input" ? "input" : "screen";
        await bridge.openPrivacySettings(pane).catch(() => false);
        onNotice(
          pane === "screen" ? "Turn on Screen Recording" : "Turn on Input Monitoring",
          pane === "screen"
            ? "Enable Maximo Syntax in Screen Recording, then quit and reopen the app. Input Monitoring is requested automatically on the next launch."
            : "Enable Maximo Syntax in Input Monitoring, then click Recheck.",
          "warning",
        );
      }
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      onValuesChange({ enableAppSnap: false });
      await onPersist({ enableAppSnap: false }).catch(() => undefined);
      onNotice("AppSnap setup failed", error instanceof Error ? error.message : "Could not configure AppSnap.", "error");
    }
  }

  async function recheckAppSnapPermissions() {
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    const requestGuard = appSnapRequestGuardRef.current;
    const requestId = requestGuard.begin();
    try {
      const state = await bridge.requestInputMonitoring();
      if (!requestGuard.isCurrent(requestId)) return;
      setAppSnapState(state);
      onNotice(
        "Turn on Input Monitoring",
        "Enable Maximo Syntax in Input Monitoring, then click Recheck again.",
        "warning",
      );
    } catch (error) {
      if (!requestGuard.isCurrent(requestId)) return;
      onNotice("Could not check AppSnap permissions", error instanceof Error ? error.message : "Permission check failed.", "error");
    }
  }

  async function openPrivacySettings(pane: "input" | "screen" = "screen") {
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    await bridge.openPrivacySettings(pane).catch(() => false);
  }

  const hasDesktopBridge = Boolean(window.maximoDesktop?.appSnap);
  const supported = hasDesktopBridge && appSnapState?.supported !== false;
  const enabled = Boolean(hasDesktopBridge) && values.enableAppSnap && appSnapState?.supported !== false;

  return (
    <div className="settings-panel-stack">
      <section className="settings-card appsnap-intro-card">
        <span className="appsnap-intro-icon" aria-hidden><Camera size={16} /></span>
        <div>
          <strong>Take an AppSnap to show your agent another app&rsquo;s window</strong>
          <small>
            Press your two-key shortcut while any app is frontmost. Maximo Syntax captures that window as
            an image, brings itself forward, and attaches the snap to a chat composer — the capture stays
            on this device until you send the message.
          </small>
          {!supported ? (
            <small className="appsnap-unsupported">
              {appSnapState
                ? (appSnapState.message ?? "AppSnap is available only in the macOS desktop app.")
                : "AppSnap requires the Maximo Syntax desktop app on macOS."}
            </small>
          ) : null}
        </div>
      </section>

      <section className="settings-card">
        <h2>Capture</h2>
        <div className="settings-row">
          <span>
            <strong>Enable AppSnap</strong>
            <small>Run the capture listener in the background while Maximo Syntax is open. {appSnapStatusText(appSnapState)}</small>
          </span>
          <div className="settings-row-actions">
            <button
              type="button"
              className="settings-action"
              disabled={!enabled || appSnapState?.status !== "ready"}
              onClick={() => {
                onNotice("Capturing in 3 seconds", "Click another app so it is in front. AppSnap cannot capture Maximo Syntax itself.", "success");
                window.setTimeout(() => {
                  void window.maximoDesktop.appSnap.triggerCapture().then((started) => {
                    if (!started) {
                      onNotice("AppSnap is not listening", "Enable AppSnap and wait until status is Listening, then try Test capture.", "warning");
                    }
                  }).catch((error) => {
                    onNotice("Test capture failed", error instanceof Error ? error.message : "Could not trigger a capture.", "error");
                  });
                }, 3_000);
              }}
            >
              Test capture
            </button>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!supported}
              onChange={(event) => void setAppSnapEnabled(event.target.checked)}
              aria-label="Enable AppSnap"
            />
          </div>
        </div>
        <div className="settings-row appsnap-shortcut-settings-row">
          <span>
            <strong>Shortcut</strong>
            <small>Choose exactly two keys: one modifier and one other key. Maximo Syntax checks its own bindings and asks macOS whether another app already owns the shortcut before saving it.</small>
          </span>
          <AppSnapShortcutControl
            key={
              values.appSnapShortcut.kind === "both-option-keys"
                ? values.appSnapShortcut.kind
                : `${values.appSnapShortcut.modifier}:${values.appSnapShortcut.key}`
            }
            shortcut={values.appSnapShortcut}
            enabled={enabled}
            reserved={enabled && appSnapState?.status === "ready"}
            onSaved={(shortcut: DesktopAppSnapShortcut, state) => {
              onValuesChange({ appSnapShortcut: shortcut });
              void onPersist({ appSnapShortcut: shortcut });
              setAppSnapState(state);
            }}
            onNotice={onNotice}
          />
        </div>
        <div className="settings-row">
          <span>
            <strong>Destination</strong>
            <small>Snaps join the chat you interacted with in the last minute, and consecutive snaps stay together. Otherwise Maximo Syntax opens a fresh chat with the capture attached.</small>
          </span>
          <span className="setting-value">Automatic</span>
        </div>
        <div className="settings-row">
          <span>
            <strong>Capture sound</strong>
            <small>Play a short shutter cue when a window is captured.</small>
          </span>
          <div className="settings-row-actions">
            <button type="button" className="settings-action" onClick={() => void playAppSnapCaptureSound()}>Preview</button>
            <input
              type="checkbox"
              checked={values.appSnapPlaySound}
              onChange={(event) => {
                const appSnapPlaySound = event.target.checked;
                onValuesChange({ appSnapPlaySound });
                void onPersist({ appSnapPlaySound });
              }}
              aria-label="Play a sound when an AppSnap is captured"
            />
          </div>
        </div>
        {values.enableAppSnap !== DEFAULT_SETTINGS.enableAppSnap || values.appSnapPlaySound !== DEFAULT_SETTINGS.appSnapPlaySound || values.appSnapShortcut.kind !== "both-option-keys" ? (
          <div className="settings-row">
            <span><strong>Restore AppSnap defaults</strong><small>Turn AppSnap off, restore both Option keys, and keep the shutter sound.</small></span>
            <button
              type="button"
              className="settings-action"
              onClick={() => {
                void setAppSnapEnabled(DEFAULT_SETTINGS.enableAppSnap);
                onValuesChange({
                  appSnapPlaySound: DEFAULT_SETTINGS.appSnapPlaySound,
                  appSnapShortcut: DEFAULT_SETTINGS.appSnapShortcut,
                });
                void onPersist({
                  appSnapPlaySound: DEFAULT_SETTINGS.appSnapPlaySound,
                  appSnapShortcut: DEFAULT_SETTINGS.appSnapShortcut,
                });
              }}
            >
              Reset
            </button>
          </div>
        ) : null}
      </section>

      {supported && appSnapState ? (
        <section className="settings-card">
          <h2>macOS permissions</h2>
          <div className="settings-row">
            <span>
              <strong>Input Monitoring</strong>
              <small>Lets Maximo Syntax notice the double-Option chord while another app owns the keyboard. Nothing you type is recorded.</small>
            </span>
            <AppSnapPermissionBadge permission={appSnapState.inputMonitoringPermission} />
          </div>
          <div className="settings-row">
            <span>
              <strong>Screen Recording</strong>
              <small>Lets Maximo Syntax capture an image of the frontmost window. Only the single window you snap is captured, only at the moment you press the chord.</small>
            </span>
            <AppSnapPermissionBadge permission={appSnapState.screenRecordingPermission} />
          </div>
          <div className="settings-row">
            <span>
              <strong>Permission status</strong>
              <small>Screen Recording is requested when you enable AppSnap. Recheck then asks for Input Monitoring and opens that list. Turn Maximo Syntax on in both lists.</small>
            </span>
            <div className="settings-row-actions">
              <button type="button" className="settings-action" onClick={() => void openPrivacySettings(appSnapState.screenRecordingPermission === "granted" ? "input" : "screen")}>Open System Settings</button>
              <button type="button" className="settings-action" onClick={() => void recheckAppSnapPermissions()}>Recheck permissions</button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
