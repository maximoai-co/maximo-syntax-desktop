import { shell, type IpcMain, type WebContents } from "electron";
import type { DesktopAppSnapCapture, DesktopAppSnapErrorEvent, DesktopAppSnapState } from "./types.js";
import type { DesktopAppSnapManager } from "./app-snap-manager.js";

export const APPSNAP_IPC_CHANNELS = {
  getState: "appsnap:get-state",
  setEnabled: "appsnap:set-enabled",
  checkShortcut: "appsnap:check-shortcut",
  setShortcut: "appsnap:set-shortcut",
  requestPermissions: "appsnap:request-permissions",
  requestInputMonitoring: "appsnap:request-input-monitoring",
  triggerCapture: "appsnap:trigger-capture",
  openPrivacySettings: "appsnap:open-privacy-settings",
  listPendingCaptures: "appsnap:list-pending-captures",
  acknowledgeCapture: "appsnap:acknowledge-capture",
  captured: "appsnap:captured",
  error: "appsnap:error",
  state: "appsnap:state",
} as const;

const PRIVACY_SETTINGS_URLS = {
  input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
} as const;

export async function openAppSnapPrivacySettings(pane: "input" | "screen" = "screen"): Promise<boolean> {
  try {
    await shell.openExternal(PRIVACY_SETTINGS_URLS[pane]);
    return true;
  } catch {
    return false;
  }
}

export function sendAppSnapState(
  webContents: WebContents | null | undefined,
  state: DesktopAppSnapState,
): void {
  webContents?.send(APPSNAP_IPC_CHANNELS.state, state);
}

export function sendAppSnapCaptured(
  webContents: WebContents | null | undefined,
  capture: DesktopAppSnapCapture,
): void {
  webContents?.send(APPSNAP_IPC_CHANNELS.captured, capture);
}

export function sendAppSnapError(
  webContents: WebContents | null | undefined,
  error: DesktopAppSnapErrorEvent,
): void {
  webContents?.send(APPSNAP_IPC_CHANNELS.error, error);
}

export function registerAppSnapIpcHandlers(ipcMain: IpcMain, manager: DesktopAppSnapManager): void {
  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.getState);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.getState, async () => {
    void manager.refreshState().catch(() => undefined);
    return manager.getState();
  });

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.setEnabled);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.setEnabled, async (_event, enabled: unknown) =>
    manager.setEnabled(enabled === true),
  );

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.checkShortcut);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.checkShortcut, async (_event, shortcut: unknown) =>
    manager.checkShortcut(shortcut),
  );

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.setShortcut);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.setShortcut, async (_event, shortcut: unknown) =>
    manager.setShortcut(shortcut),
  );

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.requestPermissions);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.requestPermissions, async () => manager.requestPermissions());

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.requestInputMonitoring);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.requestInputMonitoring, async () => manager.requestInputMonitoring());

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.triggerCapture);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.triggerCapture, async () => manager.triggerCapture());

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.openPrivacySettings);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.openPrivacySettings, async (_event, pane: unknown) => {
    const target = pane === "input" ? "input" : "screen";
    return openAppSnapPrivacySettings(target);
  });

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.listPendingCaptures);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.listPendingCaptures, async () =>
    manager.listPendingCaptures(),
  );

  ipcMain.removeHandler(APPSNAP_IPC_CHANNELS.acknowledgeCapture);
  ipcMain.handle(APPSNAP_IPC_CHANNELS.acknowledgeCapture, async (_event, captureId: unknown) => {
    if (typeof captureId === "string") await manager.acknowledgeCapture(captureId);
  });
}
