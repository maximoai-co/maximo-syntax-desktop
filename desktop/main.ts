import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir, release as osRelease } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification as ElectronNotification, shell } from "electron";
import {
  cancelBrowserLogin,
  clearExtraProviderCredentials,
  isLoginMethod,
  isSignInCancelled,
  loginMethodNeedsApiKey,
  loginMyTabulonWithBrowser,
  loginWithApiKey,
  readLocalAccountStatus,
} from "./auth-service.js";
import { AppUpdater } from "./app-updater.js";
import { CliRunner, restoreFilesFromChanges } from "./cli-runner.js";
import { RuntimeManager } from "./runtime-manager.js";
import { BrowserHostServer } from "./browser-host.js";
import { BrowserManager } from "./browser-manager.js";
import { discoverSkills } from "./skill-discovery.js";
import { createInitialState, StateStore } from "./state-store.js";
import { fetchAccountUsage } from "./usage-service.js";
import { TerminalManager } from "./terminal-manager.js";
import {
  fetchGithubReleaseEntries,
  mergeWhatsNewEntries,
  parseChangelogMarkdown,
  toWhatsNewSnapshot,
} from "./whats-new.js";
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from "./workspace-files.js";
import { MAX_ATTACHMENT_COUNT, MAX_PROJECT_SOURCE_COUNT } from "./types.js";
import type { AccountStatus, AskUserAnswer, Attachment, AttachmentPreview, AttachmentPreviewKind, BrowserNewTabInput, BrowserOpenInput, BrowserSetPanelBoundsInput, BrowserTabInput, BrowserThreadInput, DesktopNotificationInput, GitFile, GitRemote, GitStatus, LocalServer, LoginMethod, OpenCodePlan, PermissionMode, RevertResult, RunEvent, RunRequest, Settings, SpaceIconName, WhatsNewSnapshot } from "./types.js";
import { launchConfigurationChanged, resolveAsFollowUp, type RunLaunchConfiguration } from "./run-dispatch.js";
import { taskCompletionNotification } from "./task-notifications.js";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let runtime: RuntimeManager;
let terminalManager: TerminalManager;
let browserManager: BrowserManager;
let browserHost: BrowserHostServer;
let appUpdater: AppUpdater | null = null;
let isQuitting = false;
const activeDesktopNotifications = new Set<ElectronNotification>();
const runner = new CliRunner();
const pendingRunEvents: RunEvent[] = [];
// Tool/status events are presentation updates, not animation frames. Synara's
// domain stream uses a 100 ms trailing flush; 80 ms keeps this UI feeling live
// while preventing IPC/React churn during tool bursts. Approval and lifecycle
// events still bypass the queue below.
const RUN_EVENT_FLUSH_INTERVAL_MS = 80;
// Tracks launch-time configuration for each warm CLI process. Thread settings
// can change between turns, but the existing process keeps its original flags.
const runningModel = new Map<string, RunLaunchConfiguration>();
let runEventFlushTimer: ReturnType<typeof setTimeout> | null = null;
let rendererRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
const rendererRecoveryTimes: number[] = [];
// Local staging ceiling; the CLI applies its format-specific API limits when
// it dereferences the @-mentioned path.
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024;
const MAX_BINARY_PREVIEW_SIZE = 12 * 1024 * 1024;
const MAX_TEXT_PREVIEW_SIZE = 512 * 1024;
const MAXIMO_PROJECTS_ROOT = resolve(homedir(), ".maximo", "projects");

function isWithinPath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function resolveBrowserBridgePath(): string {
  const packagedPath = join(app.getAppPath(), "dist-electron", "browser-mcp-bridge.js");
  const unpackedPath = packagedPath.replace(/\.asar([\\/])/u, ".asar.unpacked$1");
  return existsSync(unpackedPath) ? unpackedPath : packagedPath;
}

const attachmentMimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
  ".3gp": "video/3gpp",
  ".c": "text/x-c",
  ".cc": "text/x-c++",
  ".conf": "text/plain",
  ".cpp": "text/x-c++",
  ".css": "text/css",
  ".csv": "text/csv",
  ".env": "text/plain",
  ".go": "text/x-go",
  ".h": "text/x-c",
  ".hpp": "text/x-c++",
  ".html": "text/html",
  ".htm": "text/html",
  ".ini": "text/plain",
  ".java": "text/x-java-source",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".less": "text/css",
  ".log": "text/plain",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".mts": "text/typescript",
  ".py": "text/x-python",
  ".rs": "text/x-rust",
  ".sass": "text/css",
  ".scss": "text/css",
  ".sh": "text/x-shellscript",
  ".sql": "application/sql",
  ".svgz": "image/svg+xml",
  ".toml": "text/plain",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".vue": "text/html",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".zsh": "text/x-shellscript",
};

function attachmentMimeType(path: string): string {
  return attachmentMimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function attachmentPreviewKind(mimeType: string): AttachmentPreviewKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml" || mimeType === "application/sql") return "text";
  return "unsupported";
}

function attachmentPreviewReason(kind: AttachmentPreviewKind, size: number): string | undefined {
  if (size > MAX_ATTACHMENT_SIZE) return "This file is larger than the 25 MB attachment limit.";
  if (kind === "unsupported") return "This file type opens in your default desktop app instead of an inline preview.";
  if (kind === "text") return undefined;
  const limit = MAX_BINARY_PREVIEW_SIZE;
  if (size > limit) return `This file is too large for an inline preview (${Math.round(limit / (1024 * 1024))} MB limit).`;
  return undefined;
}

app.setName("Maximo Syntax");

if (process.env.MAXIMO_DESKTOP_DATA_DIR) {
  app.setPath("userData", resolve(process.env.MAXIMO_DESKTOP_DATA_DIR));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function playDesktopNotificationSound(): Promise<boolean> | boolean {
  if (process.platform !== "darwin") {
    shell.beep();
    return true;
  }
  return new Promise<boolean>((resolvePromise) => {
    const audio = spawn("/usr/bin/afplay", ["/System/Library/Sounds/Glass.aiff"], { stdio: "ignore" });
    audio.once("error", () => resolvePromise(false));
    audio.once("close", (code) => resolvePromise(code === 0));
  });
}

function showDesktopNotification(input: DesktopNotificationInput): boolean {
  if (!ElectronNotification.isSupported()) return false;
  try {
    const title = typeof input?.title === "string" ? input.title.slice(0, 120) : "Maximo Syntax";
    const body = typeof input?.body === "string" ? input.body.slice(0, 500) : "Activity needs your attention.";
    const threadId = typeof input?.threadId === "string" && input.threadId.trim() ? input.threadId.slice(0, 200) : undefined;
    const notification = new ElectronNotification({ title, body, silent: input?.silent === true });
    const release = () => activeDesktopNotifications.delete(notification);
    activeDesktopNotifications.add(notification);
    notification.on("close", release);
    notification.on("failed", release);
    if (threadId) notification.on("click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      send("notification:open-thread", threadId);
    });
    notification.show();
    return true;
  } catch {
    return false;
  }
}

function notifyTaskCompletion(threadId: string): void {
  const state = store.taskNotificationSnapshot(threadId);
  const input = taskCompletionNotification(state, threadId);
  if (!input || !state.settings.enableSystemTaskCompletionNotifications) return;
  if (state.settings.enableNotificationSound) void Promise.resolve(playDesktopNotificationSound());
  showDesktopNotification({ ...input, silent: true });
}

async function finishRunAndNotify(...args: Parameters<StateStore["finishRun"]>): Promise<void> {
  await store.finishRun(...args);
  notifyTaskCompletion(args[0]);
}

function resolveChangelogPath(): string {
  const candidates = [
    join(app.getAppPath(), "CHANGELOG.md"),
    join(process.cwd(), "CHANGELOG.md"),
  ];
  return candidates.find((path) => existsSync(path)) ?? candidates[0];
}

async function loadWhatsNewEntries(currentVersion: string) {
  let changelogEntries = [] as ReturnType<typeof parseChangelogMarkdown>;
  try {
    const markdown = await readFile(resolveChangelogPath(), "utf8");
    changelogEntries = parseChangelogMarkdown(markdown);
  } catch {
    changelogEntries = [];
  }
  const githubEntries = await fetchGithubReleaseEntries(fetch, currentVersion);
  return mergeWhatsNewEntries(changelogEntries, githubEntries);
}

function flushRunEvents(): void {
  if (runEventFlushTimer !== null) {
    clearTimeout(runEventFlushTimer);
    runEventFlushTimer = null;
  }
  if (pendingRunEvents.length === 0) return;
  const events = pendingRunEvents.splice(0);
  send("run:event", events);
}

function sendRunEvent(event: RunEvent): void {
  const immediate = event.type === "started"
    // Text is already coalesced to 120 ms by CliRunner; do not put it through a
    // second trailing timer or make the visible stream feel ~200 ms behind.
    || event.type === "text"
    || event.type === "question"
    || event.type === "permission"
    || event.type === "retrying"
    || event.type === "turn-complete"
    || event.type === "finished";
  if (immediate) {
    flushRunEvents();
    send("run:event", event);
    return;
  }
  pendingRunEvents.push(event);
  if (runEventFlushTimer === null) runEventFlushTimer = setTimeout(flushRunEvents, RUN_EVENT_FLUSH_INTERVAL_MS);
}

function safeText(value: unknown, maxLength = 4_000): string {
  if (typeof value !== "string") throw new Error("Expected text input.");
  return value.slice(0, maxLength);
}

function projectForId(projectId: unknown) {
  const project = store.getProject(safeText(projectId, 100));
  if (!project) throw new Error("Project not found.");
  if (!existsSync(project.path)) throw new Error("The project folder is unavailable.");
  return project;
}

function safeRelativeGitPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((path): path is string => typeof path === "string")
    .map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "").trim())
    .filter((path) => path && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split("/").includes("..")))].slice(0, 200);
}

async function attachmentFromPathValue(requestedPath: unknown): Promise<Attachment | null> {
  if (typeof requestedPath !== "string") return null;
  const path = resolve(requestedPath.slice(0, 2_000));
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ATTACHMENT_SIZE) return null;
    return { name: basename(path), path, size: info.size };
  } catch {
    return null;
  }
}

async function normalizeAttachments(value: unknown): Promise<Attachment[]> {
  if (!Array.isArray(value)) return [];
  const paths = value.slice(0, MAX_ATTACHMENT_COUNT).map((item) => {
    if (!item || typeof item !== "object") return null;
    const path = (item as { path?: unknown }).path;
    return typeof path === "string" ? path : null;
  });
  const attachments = await Promise.all(paths.map(attachmentFromPathValue));
  const seen = new Set<string>();
  return attachments.filter((attachment): attachment is Attachment => {
    if (!attachment || seen.has(attachment.path)) return false;
    seen.add(attachment.path);
    return true;
  });
}

async function readAccountStatus(): Promise<AccountStatus> {
  const local = await readLocalAccountStatus();
  if (local) return local;

  const result = await runtime.execute(["auth", "status", "--json"]);
  const combined = `${result.stdout}\n${result.stderr}`;
  try {
    const start = combined.indexOf("{");
    const end = combined.lastIndexOf("}");
    const value = JSON.parse(combined.slice(start, end + 1)) as Record<string, unknown>;
    return {
      loggedIn: Boolean(value.loggedIn),
      authMethod: typeof value.authMethod === "string" ? value.authMethod : "none",
      apiProvider: typeof value.apiProvider === "string" ? value.apiProvider : undefined,
      email: typeof value.email === "string" ? value.email : undefined,
      displayName: typeof value.displayName === "string" ? value.displayName : undefined,
      orgName: typeof value.orgName === "string" ? value.orgName : undefined,
      subscriptionType: typeof value.subscriptionType === "string" ? value.subscriptionType : undefined,
    };
  } catch {
    return { loggedIn: false, authMethod: "none" };
  }
}

function createApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: "Check for Updates…",
    click: () => {
      void (async () => {
        const state = await appUpdater?.checkForUpdates("menu");
        if (!state) return;
        if (state.status === "available") {
          send("menu:action", "update-available");
          return;
        }
        const boxOptions: Electron.MessageBoxOptions = state.status === "up-to-date"
          ? {
              type: "info",
              message: "You're up to date",
              detail: `Maximo Syntax ${state.currentVersion} is the latest version.`,
            }
          : {
              type: "warning",
              message: "Could not check for updates",
              detail: state.message ?? "An unexpected error occurred.",
            };
        if (mainWindow && !mainWindow.isDestroyed()) {
          void dialog.showMessageBox(mainWindow, boxOptions);
        } else {
          void dialog.showMessageBox(boxOptions);
        }
      })();
    },
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" as const },
            checkForUpdatesItem,
            { type: "separator" as const },
            { role: "services" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        }]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Chat", accelerator: "CmdOrCtrl+N", click: () => send("menu:action", "new-thread") },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => send("menu:action", "open-project") },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+Shift+O", click: () => send("menu:action", "open-folder") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "CmdOrCtrl+Shift+B", click: () => send("menu:action", "toggle-sidebar") },
        { label: "Toggle Inspector", accelerator: "CmdOrCtrl+Shift+I", click: () => send("menu:action", "toggle-inspector") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [{ type: "separator" as const }, { role: "front" as const }] : [])],
    },
    ...(!isMac
      ? [{
          label: "Help",
          submenu: [checkForUpdatesItem],
        }]
      : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function loadRendererContents(window: BrowserWindow): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(join(app.getAppPath(), "dist-renderer", "index.html"));
}

function scheduleRendererRecovery(window: BrowserWindow, reason: string, exitCode: number): void {
  if (isQuitting || window.isDestroyed() || reason === "clean-exit") return;
  console.error("[renderer] process exited:", reason, exitCode);

  const now = Date.now();
  while (rendererRecoveryTimes.length > 0 && now - rendererRecoveryTimes[0]! > 60_000) rendererRecoveryTimes.shift();
  if (rendererRecoveryTimes.length >= 2 || rendererRecoveryTimer !== null) {
    console.error("[renderer] automatic recovery suppressed to avoid a crash loop");
    return;
  }
  rendererRecoveryTimes.push(now);

  // A native WebContentsView can otherwise remain painted over a dead
  // renderer. Detach it first, then reload the same isolated renderer so the
  // user gets a working shell instead of a permanent black window.
  browserManager?.setWindow(null);
  rendererRecoveryTimer = setTimeout(() => {
    rendererRecoveryTimer = null;
    if (isQuitting || window.isDestroyed() || mainWindow !== window) return;
    void loadRendererContents(window).then(() => {
      if (!window.isDestroyed() && mainWindow === window) browserManager?.setWindow(window);
    }).catch((error) => console.error("[renderer] automatic recovery failed:", error));
  }, 250);
  rendererRecoveryTimer.unref();
}

async function createWindow(): Promise<void> {
  const preloadPath = join(app.getAppPath(), "dist-electron", "preload.cjs");
  mainWindow = new BrowserWindow({
    width: Number(process.env.MAXIMO_DESKTOP_WINDOW_WIDTH) || 1440,
    height: Number(process.env.MAXIMO_DESKTOP_WINDOW_HEIGHT) || 940,
    minWidth: 360,
    minHeight: 620,
    title: "Maximo Syntax — Your AI workspace for work",
    icon: join(app.getAppPath(), "assets", "app-icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111111" : "#eef4f4",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : {
      color: "#00000000",
      symbolColor: nativeTheme.shouldUseDarkColors ? "#e9f4f2" : "#142b2c",
      height: 46,
    },
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      webSecurity: true,
    },
  });
  browserManager?.setWindow(mainWindow);
  mainWindow.on("closed", () => {
    browserManager?.setWindow(null);
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, parameters) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (!/^(?:https?:\/\/|about:blank$)/i.test(parameters.src)) event.preventDefault();
  });
  mainWindow.webContents.on("did-attach-webview", (_event, guestWebContents) => {
    guestWebContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    guestWebContents.on("will-navigate", (event, url) => {
      if (!/^(?:https?:\/\/|about:blank$)/i.test(url)) event.preventDefault();
    });
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    if (!allowed && !url.startsWith("file:")) event.preventDefault();
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[renderer] failed to load ${url}: ${code} ${description}`);
  });
  mainWindow.webContents.on("preload-error", (_event, path, error) => {
    console.error(`[preload] ${path}:`, error);
  });
  mainWindow.webContents.on("console-message", (details) => {
    const level = details.level === "error" ? 3 : details.level === "warning" ? 2 : details.level === "info" ? 1 : 0;
    if (level >= 2 || process.env.MAXIMO_DESKTOP_DEBUG) {
      console.error(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });
  const windowForRendererRecovery = mainWindow;
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    scheduleRendererRecovery(windowForRendererRecovery, details.reason, details.exitCode);
  });

  await loadRendererContents(mainWindow);

  if (process.env.MAXIMO_DESKTOP_SCREENSHOT) {
    const screenshotPath = resolve(process.env.MAXIMO_DESKTOP_SCREENSHOT);
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const image = await mainWindow.webContents.capturePage();
      await mkdir(join(screenshotPath, ".."), { recursive: true });
      await writeFile(screenshotPath, image.toPNG());
    }, Number(process.env.MAXIMO_DESKTOP_SCREENSHOT_DELAY) || 1_500).unref();
  }
}

function registerIpc(): void {
  ipcMain.handle("app:info", () => ({ version: app.getVersion(), platform: process.platform, dataPath: app.getPath("userData") }));
  ipcMain.handle("update:state", () => appUpdater?.getState() ?? {
    status: "idle" as const,
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseName: null,
    releaseUrl: null,
    downloadUrl: null,
    message: null,
    checkedAt: null,
  });
  ipcMain.handle("update:check", async () => appUpdater?.checkForUpdates("renderer") ?? {
    status: "error" as const,
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseName: null,
    releaseUrl: null,
    downloadUrl: null,
    message: "Updater is not available.",
    checkedAt: new Date().toISOString(),
  });
  ipcMain.handle("update:open-download", async () => {
    if (!appUpdater) {
      return {
        opened: false,
        url: null,
        state: {
          status: "error" as const,
          currentVersion: app.getVersion(),
          availableVersion: null,
          releaseName: null,
          releaseUrl: null,
          downloadUrl: null,
          message: "Updater is not available.",
          checkedAt: new Date().toISOString(),
        },
      };
    }
    return appUpdater.openDownload();
  });
  ipcMain.handle("whats-new:load", async (): Promise<WhatsNewSnapshot> => {
    const currentVersion = app.getVersion();
    const lastSeenVersion = store.getLastSeenWhatsNewVersion();
    const entries = await loadWhatsNewEntries(currentVersion);
    const snapshot = toWhatsNewSnapshot(currentVersion, lastSeenVersion, entries);
    if (snapshot.decision === "silent-bootstrap" && snapshot.nextLastSeenVersion) {
      await store.update((draft) => {
        draft.lastSeenWhatsNewVersion = snapshot.nextLastSeenVersion;
      });
    }
    return snapshot;
  });
  ipcMain.handle("whats-new:mark-seen", async (_event, requestedVersion?: unknown) => {
    const version = typeof requestedVersion === "string" && requestedVersion.trim()
      ? safeText(requestedVersion, 40)
      : app.getVersion();
    return store.update((draft) => {
      draft.lastSeenWhatsNewVersion = version;
    });
  });
  ipcMain.handle("state:load", () => store.snapshotForRenderer());
  ipcMain.handle("notifications:supported", () => ElectronNotification.isSupported());
  ipcMain.handle("notifications:sound", () => playDesktopNotificationSound());
  ipcMain.handle("notifications:show", (_event, input: DesktopNotificationInput) => showDesktopNotification(input));
  ipcMain.handle("browser:open", (_event, input: BrowserOpenInput) => {
    const threadId = safeText(input?.threadId, 100);
    const initialUrl = typeof input?.initialUrl === "string" ? safeText(input.initialUrl, 8_192) : undefined;
    return browserManager.open({ threadId, ...(initialUrl === undefined ? {} : { initialUrl }) });
  });
  ipcMain.handle("browser:close", (_event, input: BrowserThreadInput) =>
    browserManager.close({ threadId: safeText(input?.threadId, 100) }),
  );
  ipcMain.handle("browser:hide", (_event, input: BrowserThreadInput) => {
    browserManager.hide({ threadId: safeText(input?.threadId, 100) });
  });
  ipcMain.handle("browser:get-state", (_event, input: BrowserThreadInput) =>
    browserManager.getState({ threadId: safeText(input?.threadId, 100) }),
  );
  ipcMain.on("browser:set-bounds", (_event, input: BrowserSetPanelBoundsInput) => {
    if (!input || typeof input.threadId !== "string") return;
    const bounds = input?.bounds;
    browserManager.setPanelBounds({
      threadId: safeText(input.threadId, 100),
      bounds: bounds && typeof bounds === "object"
        ? {
            x: Number(bounds.x),
            y: Number(bounds.y),
            width: Number(bounds.width),
            height: Number(bounds.height),
          }
        : null,
    });
  });
  ipcMain.handle("browser:navigate", (_event, input: { threadId?: unknown; tabId?: unknown; url?: unknown }) =>
    browserManager.navigate({
      threadId: safeText(input?.threadId, 100),
      ...(typeof input?.tabId === "string" ? { tabId: safeText(input.tabId, 200) } : {}),
      url: safeText(input?.url, 8_192),
    }),
  );
  ipcMain.handle("browser:reload", (_event, input: BrowserTabInput) =>
    browserManager.reload({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:back", (_event, input: BrowserTabInput) =>
    browserManager.goBack({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:forward", (_event, input: BrowserTabInput) =>
    browserManager.goForward({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:new-tab", (_event, input: BrowserNewTabInput) =>
    browserManager.newTab({
      threadId: safeText(input?.threadId, 100),
      ...(typeof input?.url === "string" ? { url: safeText(input.url, 8_192) } : {}),
      activate: input?.activate !== false,
    }),
  );
  ipcMain.handle("browser:close-tab", (_event, input: BrowserTabInput) =>
    browserManager.closeTab({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:select-tab", (_event, input: BrowserTabInput) =>
    browserManager.selectTab({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:screenshot", (_event, input: BrowserTabInput) =>
    browserManager.captureScreenshot({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:copy-screenshot", (_event, input: BrowserTabInput) =>
    browserManager.copyScreenshotToClipboard({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) }),
  );
  ipcMain.handle("browser:copy-link", (_event, input: BrowserTabInput) => {
    browserManager.copyLink({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) });
  });
  ipcMain.handle("browser:devtools", (_event, input: BrowserTabInput) => {
    browserManager.openDevTools({ threadId: safeText(input?.threadId, 100), tabId: safeText(input?.tabId, 200) });
  });
  ipcMain.handle("skills:list", async (_event, requestedProjectPath?: string) => {
    const projectPath = typeof requestedProjectPath === "string" && requestedProjectPath
      ? requestedProjectPath
      : store.getSelectedProjectPath();
    return discoverSkills(projectPath ?? null);
  });
  ipcMain.handle("onboarding:complete", () => store.update((draft) => { draft.onboardingComplete = true; }));
  ipcMain.handle("provider:reset-selections", () => store.resetProviderSelections());
  ipcMain.handle("space:create", (_event, requestedName: string, requestedIcon: unknown) => {
    const icon = typeof requestedIcon === "string" ? requestedIcon as SpaceIconName : "briefcase";
    return store.createSpace(safeText(requestedName, 100), icon);
  });
  ipcMain.handle("space:select", (_event, requestedSpaceId: unknown) => store.selectSpace(typeof requestedSpaceId === "string" ? safeText(requestedSpaceId, 100) : null));
  ipcMain.handle("settings:update", async (_event, patch: Partial<Settings>) => {
    const allowed: Partial<Settings> = {};
    if (["system", "light", "dark"].includes(String(patch.theme))) allowed.theme = patch.theme;
    if (patch.themePacks && typeof patch.themePacks === "object") allowed.themePacks = patch.themePacks;
    if (typeof patch.cliPath === "string") allowed.cliPath = patch.cliPath.slice(0, 2_000);
    if (typeof patch.defaultModel === "string") allowed.defaultModel = patch.defaultModel.slice(0, 200);
    if (typeof patch.defaultEffort === "string") allowed.defaultEffort = patch.defaultEffort.slice(0, 40);
    if (["default", "plan", "acceptEdits", "auto", "full"].includes(String(patch.defaultPermission))) allowed.defaultPermission = patch.defaultPermission;
    if (typeof patch.hideFullAccessWarning === "boolean") allowed.hideFullAccessWarning = patch.hideFullAccessWarning;
    if (typeof patch.showInspector === "boolean") allowed.showInspector = patch.showInspector;
    if (typeof patch.sendWithEnter === "boolean") allowed.sendWithEnter = patch.sendWithEnter;
    if (["compact", "comfortable", "spacious"].includes(String(patch.uiDensity))) allowed.uiDensity = patch.uiDensity;
    if (typeof patch.useSystemUiFont === "boolean") allowed.useSystemUiFont = patch.useSystemUiFont;
    if (typeof patch.chatFontSizePx === "number" && Number.isFinite(patch.chatFontSizePx)) allowed.chatFontSizePx = patch.chatFontSizePx;
    if (typeof patch.terminalFontSizePx === "number" && Number.isFinite(patch.terminalFontSizePx)) allowed.terminalFontSizePx = patch.terminalFontSizePx;
    if (typeof patch.terminalFontFamily === "string") allowed.terminalFontFamily = patch.terminalFontFamily.slice(0, 256);
    if (["locale", "12-hour", "24-hour"].includes(String(patch.timestampFormat))) allowed.timestampFormat = patch.timestampFormat;
    if (["queue", "steer"].includes(String(patch.followUpBehavior))) allowed.followUpBehavior = patch.followUpBehavior;
    if (typeof patch.enableAssistantStreaming === "boolean") allowed.enableAssistantStreaming = patch.enableAssistantStreaming;
    if (typeof patch.diffWordWrap === "boolean") allowed.diffWordWrap = patch.diffWordWrap;
    if (typeof patch.confirmThreadDelete === "boolean") allowed.confirmThreadDelete = patch.confirmThreadDelete;
    if (typeof patch.confirmThreadArchive === "boolean") allowed.confirmThreadArchive = patch.confirmThreadArchive;
    if (typeof patch.confirmTerminalTabClose === "boolean") allowed.confirmTerminalTabClose = patch.confirmTerminalTabClose;
    if (typeof patch.enableTaskCompletionToasts === "boolean") allowed.enableTaskCompletionToasts = patch.enableTaskCompletionToasts;
    if (typeof patch.enableSystemTaskCompletionNotifications === "boolean") allowed.enableSystemTaskCompletionNotifications = patch.enableSystemTaskCompletionNotifications;
    if (typeof patch.enableNotificationSound === "boolean") allowed.enableNotificationSound = patch.enableNotificationSound;
    if (typeof patch.environmentPanelDefaultOpen === "boolean") allowed.environmentPanelDefaultOpen = patch.environmentPanelDefaultOpen;
    for (const key of ["showEnvironmentUsage", "showEnvironmentLocalServers", "showEnvironmentRepository", "showEnvironmentEditor", "showEnvironmentPinned", "showEnvironmentMarkers", "showEnvironmentNotepad", "showEnvironmentActivity"] as const) {
      if (typeof patch[key] === "boolean") allowed[key] = patch[key];
    }
    if (["updated_at", "created_at", "manual"].includes(String(patch.sidebarProjectSortOrder))) allowed.sidebarProjectSortOrder = patch.sidebarProjectSortOrder;
    if (["updated_at", "created_at"].includes(String(patch.sidebarThreadSortOrder))) allowed.sidebarThreadSortOrder = patch.sidebarThreadSortOrder;
    if (Array.isArray(patch.customModelSlugs)) allowed.customModelSlugs = patch.customModelSlugs.filter((value): value is string => typeof value === "string").slice(0, 64);
    const next = await store.updateSettings(allowed);
    nativeTheme.themeSource = next.settings.theme;
    return next;
  });

  ipcMain.handle("project:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Open a project", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const next = await store.addProject(result.filePaths[0]);
    return next.projects.find((project) => project.path === resolve(result.filePaths[0])) ?? null;
  });
  ipcMain.handle("project:choose-sources", async (): Promise<string[]> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose project source folders",
      properties: ["openDirectory", "multiSelections", "createDirectory"],
    });
      return result.canceled ? [] : result.filePaths.slice(0, MAX_PROJECT_SOURCE_COUNT).map((path) => resolve(path));
  });
  ipcMain.handle("project:create", (_event, requestedName: string, requestedPaths: unknown, requestedSpaceId?: unknown) => {
    const paths = Array.isArray(requestedPaths) ? requestedPaths.filter((path): path is string => typeof path === "string").slice(0, MAX_PROJECT_SOURCE_COUNT) : [];
    const spaceId = typeof requestedSpaceId === "string" ? safeText(requestedSpaceId, 100) : null;
    return store.createProject(safeText(requestedName, 100), paths.map((path) => safeText(path, 2_000)), spaceId);
  });
  ipcMain.handle("project:add", (_event, projectPath: string) => store.addProject(safeText(projectPath, 2_000)));
  ipcMain.handle("project:select", (_event, projectId: string) => store.selectProject(safeText(projectId, 100)));
  ipcMain.handle("project:rename", (_event, projectId: string, name: string) => store.renameProject(safeText(projectId, 100), safeText(name, 100)));
  ipcMain.handle("project:toggle-pinned", (_event, projectId: string) => store.toggleProjectPinned(safeText(projectId, 100)));
  ipcMain.handle("project:reorder", (_event, sourceProjectId: string, targetProjectId: string) => store.reorderProjects(safeText(sourceProjectId, 100), safeText(targetProjectId, 100)));
  ipcMain.handle("project:archive-chats", (_event, projectId: string) => store.archiveProjectThreads(safeText(projectId, 100)));
  ipcMain.handle("thread:archive", (_event, threadId: string) => store.archiveThread(safeText(threadId, 100)));
  ipcMain.handle("thread:unarchive", (_event, threadId: string) => store.unarchiveThread(safeText(threadId, 100)));
  ipcMain.handle("project:remove", (_event, projectId: string) => store.removeProject(safeText(projectId, 100)));
  ipcMain.handle("thread:create", (_event, projectId: string) => store.createThread(safeText(projectId, 100)));
  ipcMain.handle("thread:record-question", (_event, threadId: string, requestedQuestions: unknown, requestedToolUseId: unknown) => {
    const questions: AskUserAnswer[] = Array.isArray(requestedQuestions)
      ? requestedQuestions.slice(0, 20).flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const item = value as Record<string, unknown>;
          if (typeof item.question !== "string" || typeof item.answer !== "string") return [];
          return [{
            question: item.question.slice(0, 2_000),
            answer: item.answer.slice(0, 2_000),
            ...(typeof item.header === "string" ? { header: item.header.slice(0, 200) } : {}),
            ...(item.multiSelect === true ? { multiSelect: true } : {}),
          }];
        })
      : [];
    return store.recordQuestionInteraction(safeText(threadId, 100), questions, typeof requestedToolUseId === "string" ? requestedToolUseId.slice(0, 200) : undefined);
  });
  ipcMain.handle("thread:record-permission", (_event, threadId: string, requestedInteraction: unknown) => {
    const value = requestedInteraction && typeof requestedInteraction === "object" ? requestedInteraction as Record<string, unknown> : {};
    return store.recordPermissionInteraction(safeText(threadId, 100), {
      toolName: typeof value.toolName === "string" ? value.toolName.slice(0, 200) : "Tool",
      decision: value.decision === "approved" ? "approved" : "denied",
      ...(typeof value.detail === "string" ? { detail: value.detail.slice(0, 2_000) } : {}),
      ...(value.remember === true ? { remember: true } : {}),
      ...(typeof value.toolUseId === "string" ? { toolUseId: value.toolUseId.slice(0, 200) } : {}),
    });
  });
  ipcMain.handle("thread:select", (_event, threadId: string) => store.selectThread(safeText(threadId, 100)));
  ipcMain.handle("thread:activate", (_event, threadId: string) => store.activateThread(safeText(threadId, 100)));
  ipcMain.handle("thread:detail", (_event, threadId: string) => store.threadDetail(safeText(threadId, 100)));
  ipcMain.handle("thread:mark-read", (_event, threadId: string) => store.markThreadRead(safeText(threadId, 100)));
  ipcMain.handle("thread:mark-all-read", () => store.markAllNotificationsRead());
  ipcMain.handle("thread:rename", (_event, threadId: string, title: string) => store.renameThread(safeText(threadId, 100), safeText(title, 100)));
  ipcMain.handle("thread:toggle-pinned", (_event, threadId: string) => store.toggleThreadPinned(safeText(threadId, 100)));
  ipcMain.handle("thread:message-toggle-pinned", (_event, threadId: string, messageId: string) => store.toggleMessagePinned(safeText(threadId, 100), safeText(messageId, 200)));
  ipcMain.handle("thread:message-pin-done", (_event, threadId: string, messageId: string, done: unknown) => store.setMessagePinDone(safeText(threadId, 100), safeText(messageId, 200), done === true));
  ipcMain.handle("thread:message-pin-label", (_event, threadId: string, messageId: string, label: unknown) => store.setMessagePinLabel(safeText(threadId, 100), safeText(messageId, 200), typeof label === "string" ? safeText(label, 160) : null));
  ipcMain.handle("thread:message-remove-pin", (_event, threadId: string, messageId: string) => store.removeMessagePin(safeText(threadId, 100), safeText(messageId, 200)));
  ipcMain.handle("thread:marker-toggle", (_event, threadId: string, messageId: string) => store.toggleThreadMarker(safeText(threadId, 100), safeText(messageId, 200)));
  ipcMain.handle("thread:marker-done", (_event, threadId: string, markerId: string, done: unknown) => store.setThreadMarkerDone(safeText(threadId, 100), safeText(markerId, 200), done === true));
  ipcMain.handle("thread:marker-label", (_event, threadId: string, markerId: string, label: unknown) => store.setThreadMarkerLabel(safeText(threadId, 100), safeText(markerId, 200), typeof label === "string" ? safeText(label, 160) : null));
  ipcMain.handle("thread:marker-remove", (_event, threadId: string, markerId: string) => store.removeThreadMarker(safeText(threadId, 100), safeText(markerId, 200)));
  ipcMain.handle("thread:notes-update", (_event, threadId: string, notes: string) => store.updateThreadNotes(safeText(threadId, 100), safeText(notes, 10_000)));
  ipcMain.handle("thread:delete", (_event, threadId: string) => store.deleteThread(safeText(threadId, 100)));

  ipcMain.handle("attachments:choose", async (): Promise<Attachment[]> => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Attach files", properties: ["openFile", "multiSelections"] });
    if (result.canceled) return [];
    const attachments = await Promise.all(result.filePaths.slice(0, MAX_ATTACHMENT_COUNT).map(attachmentFromPathValue));
    return attachments.filter((attachment): attachment is Attachment => Boolean(attachment));
  });
  ipcMain.handle("attachments:path", async (_event, requestedPath: string): Promise<Attachment | null> => {
    return attachmentFromPathValue(requestedPath);
  });
  ipcMain.handle("attachments:save", async (_event, requestedName: string, requestedBytes: Uint8Array): Promise<Attachment | null> => {
    const bytes = Buffer.from(requestedBytes);
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_SIZE) return null;
    const rawName = basename(safeText(requestedName || "pasted-file", 180));
    const safeName = rawName.replace(/[^A-Za-z0-9._ -]/g, "-") || "pasted-file";
    const targetDir = join(app.getPath("temp"), "maximo-syntax-attachments");
    await mkdir(targetDir, { recursive: true });
    const path = join(targetDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`);
    await writeFile(path, bytes, { mode: 0o600 });
    return { name: safeName, path, size: bytes.length };
  });
  ipcMain.handle("attachments:preview", async (_event, requestedPath: string, requestedThumbnail?: boolean): Promise<AttachmentPreview | null> => {
    const path = resolve(safeText(requestedPath, 2_000));
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const name = basename(path);
      const mimeType = attachmentMimeType(path);
      const kind = attachmentPreviewKind(mimeType);
      const reason = attachmentPreviewReason(kind, info.size);
      const base = { name, size: info.size, mimeType, kind, ...(reason ? { reason } : {}) } satisfies AttachmentPreview;
      if (reason) return base;
      const bytes = await readFile(path);
      if (kind === "text") {
        return {
          ...base,
          text: bytes.subarray(0, MAX_TEXT_PREVIEW_SIZE).toString("utf8"),
          ...(bytes.length > MAX_TEXT_PREVIEW_SIZE ? { truncated: true } : {}),
        };
      }
      if (requestedThumbnail && kind === "image") {
        const image = nativeImage.createFromBuffer(bytes);
        if (!image.isEmpty()) {
          const size = image.getSize();
          const scale = Math.min(1, 320 / Math.max(size.width, size.height));
          const thumbnail = scale < 1
            ? image.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) })
            : image;
          return { ...base, dataUrl: `data:image/png;base64,${thumbnail.toPNG().toString("base64")}` };
        }
      }
      return { ...base, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
    } catch {
      return null;
    }
  });

  ipcMain.handle("engine:ensure", (_event, forceRepair?: boolean) => runtime.ensure(Boolean(forceRepair)));
  ipcMain.handle("engine:status", () => runtime.currentStatus());
  ipcMain.handle("engine:update", () => runtime.update());
  ipcMain.handle("engine:models", () => runtime.discoverModels());
  ipcMain.handle("account:status", () => readAccountStatus());
  ipcMain.handle("account:login", async (_event, requestedMethod: LoginMethod, apiKey?: string, requestedOpenCodePlan?: OpenCodePlan) => {
    const method: LoginMethod = isLoginMethod(requestedMethod) ? requestedMethod : "maximoai";
    try {
      if (method === "maximoai") {
        const result = await runtime.execute(["auth", "login", "--maximoai"], 10 * 60_000);
        const status = await readAccountStatus();
        if (result.cancelled) {
          return { ok: false, message: "Sign-in cancelled.", status };
        }
        const ok = result.code === 0 && status.loggedIn;
        return {
          ok,
          message: ok
            ? "Signed in with Maximo AI subscription."
            : (result.stderr.trim() || result.stdout.trim() || "Sign-in did not complete."),
          status,
        };
      }

      if (method === "mytabulon") {
        await loginMyTabulonWithBrowser();
        const status = await readAccountStatus();
        return {
          ok: status.loggedIn,
          message: status.loggedIn ? "Signed in with MyTabulon Coding Plan." : "MyTabulon sign-in did not complete.",
          status,
        };
      }

      if (loginMethodNeedsApiKey(method)) {
        const key = typeof apiKey === "string" ? apiKey.trim() : "";
        if (!key) {
          return { ok: false, message: "Enter an API key to continue.", status: await readAccountStatus() };
        }
         const openCodePlan: OpenCodePlan = requestedOpenCodePlan === "go" ? "go" : "zen";
         await loginWithApiKey(method, key, openCodePlan);
        const status = await readAccountStatus();
        const labels: Record<string, string> = {
           maximoai_api: "Maximo AI API key",
           mytabulon_api: "MyTabulon Coding Plan",
           cencori: "Cencori",
           openrouter: "OpenRouter",
           opencode: `OpenCode ${openCodePlan === "go" ? "Go" : "Zen"}`,
        };
        return {
          ok: status.loggedIn,
          message: status.loggedIn ? `Signed in with ${labels[method] ?? "API key"}.` : "API key was saved but account status could not be confirmed.",
          status,
        };
      }

      return { ok: false, message: "Unsupported sign-in method.", status: await readAccountStatus() };
    } catch (error) {
      const status = await readAccountStatus();
      return {
        ok: false,
        message: isSignInCancelled(error)
          ? "Sign-in cancelled."
          : error instanceof Error
            ? error.message
            : "Sign-in failed.",
        status,
      };
    }
  });
  ipcMain.handle("account:cancel-login", async () => {
    const browser = cancelBrowserLogin();
    const cli = runtime.cancelActiveExecute();
    return { ok: browser || cli, message: browser || cli ? "Cancelling sign-in…" : "No sign-in in progress." };
  });
  ipcMain.handle("account:logout", async () => {
    const result = await runtime.execute(["auth", "logout"]);
    // CLI logout clears Maximo/MyTabulon fields but may leave Cencori keys; clear extras locally.
    try {
      await clearExtraProviderCredentials();
    } catch {
      // Best-effort cleanup; status read still reflects remaining credentials.
    }
    const status = await readAccountStatus();
    return {
      ok: result.code === 0 || !status.loggedIn,
      message: result.code === 0 || !status.loggedIn ? "Signed out of Maximo Syntax." : (result.stderr.trim() || "Unable to sign out."),
      status,
    };
  });
  ipcMain.handle("account:usage", () => fetchAccountUsage());

  ipcMain.handle("run:start", async (_event, request: RunRequest) => {
    const threadId = safeText(request.threadId, 100);
    const thread = store.getThread(threadId);
    if (!thread) return { accepted: false, error: "Chat not found." };
    if (runner.isRunning(threadId)) return { accepted: false, error: "This chat is already running." };
    const project = store.getProject(thread.projectId);
    if (!project || !existsSync(project.path)) return { accepted: false, error: "The project folder is unavailable." };
    const prompt = safeText(request.prompt, 100_000).trim();
    if (!prompt) return { accepted: false, error: "Write a request first." };
    const permission = (["default", "plan", "acceptEdits", "auto", "full"].includes(request.permission) ? request.permission : "auto") as PermissionMode;
    const safeRequest: RunRequest = {
      threadId,
      prompt,
      attachments: await normalizeAttachments(request.attachments),
      model: typeof request.model === "string" ? request.model.slice(0, 200) : "",
      effort: typeof request.effort === "string" ? request.effort.slice(0, 40) : "",
      permission,
      additionalDirectories: (project.sourcePaths ?? [])
        .map((path) => resolve(path))
        .filter((path, index, paths) => path !== resolve(project.path) && paths.indexOf(path) === index && existsSync(path))
        .slice(0, MAX_PROJECT_SOURCE_COUNT - 1),
      ...(typeof request.contextWindow === "number" && Number.isFinite(request.contextWindow) && request.contextWindow > 0 ? { contextWindow: Math.round(Math.min(request.contextWindow, 10_000_000)) } : {}),
      // After an edit-and-resend / revert, keep truncating the CLI transcript
      // at the thread's anchor so stale turns never resurface on later sends.
      ...(thread.truncateAtUuid ? { resumeSessionAt: thread.truncateAtUuid } : {}),
    };
    const status = await runtime.ensure();
    const engine = runtime.currentLaunch();
    if (!status.available || !engine) return { accepted: false, error: status.message };
    const startedState = await store.beginRun(threadId, prompt, safeRequest.attachments, safeRequest.model, safeRequest.effort, permission);
    try {
      runner.start(engine, safeRequest, project.path, thread.cliSessionId, {
        onEvent: (event: RunEvent) => {
          sendRunEvent(event);
          if (event.type === "context") void store.recordContextUsage(threadId, event.context);
          if (event.type === "finished") {
            runningModel.delete(threadId);
          }
        },
        onComplete: async (result) => {
          await finishRunAndNotify(threadId, result.content, result.status, result.sessionId, result.error, result.activity, result.durationMs, result.timeline, result.fileChanges, result.final, result.continueRunning);
        },
      }, browserHost?.bridgeLaunch(threadId, project.path));
      runningModel.set(threadId, { model: safeRequest.model, effort: safeRequest.effort, permission: safeRequest.permission });
      return { accepted: true, state: startedState };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRunAndNotify(threadId, message, "error", thread.cliSessionId, true);
      return { accepted: false, error: message };
    }
  });
  ipcMain.handle("run:send", async (_event, request: RunRequest) => {
    const threadId = safeText(request.threadId, 100);
    const thread = store.getThread(threadId);
    if (!thread) return { accepted: false, error: "Chat not found." };
    if (!runner.isRunning(threadId)) return { accepted: false, error: "This chat is not running." };
    const project = store.getProject(thread.projectId);
    if (!project || !existsSync(project.path)) return { accepted: false, error: "The project folder is unavailable." };
    const prompt = safeText(request.prompt, 100_000).trim();
    if (!prompt) return { accepted: false, error: "Write a request first." };
    const permission = (["default", "plan", "acceptEdits", "auto", "full"].includes(request.permission) ? request.permission : "auto") as PermissionMode;
    const safeRequest: RunRequest = {
      threadId,
      prompt,
      attachments: await normalizeAttachments(request.attachments),
      model: typeof request.model === "string" ? request.model.slice(0, 200) : "",
      effort: typeof request.effort === "string" ? request.effort.slice(0, 40) : "",
      permission,
      additionalDirectories: (project.sourcePaths ?? [])
        .map((path) => resolve(path))
        .filter((path, index, paths) => path !== resolve(project.path) && paths.indexOf(path) === index && existsSync(path))
        .slice(0, MAX_PROJECT_SOURCE_COUNT - 1),
      ...(typeof request.contextWindow === "number" && Number.isFinite(request.contextWindow) && request.contextWindow > 0 ? { contextWindow: Math.round(Math.min(request.contextWindow, 10_000_000)) } : {}),
      ...(thread.truncateAtUuid ? { resumeSessionAt: thread.truncateAtUuid } : {}),
    };
    // Never trust the renderer's possibly stale thread status here. The CLI
    // stays alive between turns, so only its pending-prompt bit can tell an
    // in-turn steer from a new turn after a result.
    const asFollowUp = resolveAsFollowUp(request.asFollowUp, runner.isTurnActive(threadId));
    // If the user changed model, effort, or permission while a warm session is
    // alive, the old process still has stale launch flags. Reusing it would
    // answer with the wrong configuration. Restart with --resume so the
    // transcript continues and the visible selections take effect.
    const running = runningModel.get(threadId);
    const effectivePrevModel = running?.model ?? thread.model ?? "";
    const effectivePrevEffort = running?.effort ?? thread.effort ?? "";
    const effectivePrevPermission = running?.permission ?? thread.permission ?? "auto";
    const configurationChanged = launchConfigurationChanged(
      { model: effectivePrevModel, effort: effectivePrevEffort, permission: effectivePrevPermission },
      { model: safeRequest.model, effort: safeRequest.effort, permission: safeRequest.permission },
    );
    // Mid-turn follow-ups (asFollowUp) ride the current query's injection point
    // and must not restart — they are steering within the same turn.
    if (configurationChanged && !asFollowUp) {
      // The follow-up flag reflects an in-turn injection; a turn-boundary
      // configuration change needs a fresh process. Stop the warm session and
      // start a resumed one that continues the transcript with the new flags.
      await runner.stopAndWait(threadId);
      runningModel.delete(threadId);
      const sentState = await store.sendRunMessage(threadId, prompt, safeRequest.attachments, safeRequest.model, safeRequest.effort, permission, { asFollowUp });
      const status = await runtime.ensure();
      const engine = runtime.currentLaunch();
      if (!status.available || !engine) {
        await finishRunAndNotify(threadId, status.message, "error", thread.cliSessionId, true);
        return { accepted: false, error: status.message };
      }
      // Keep truncating at the fork anchor after edit/revert/file-rewind.
      const resumedRequest: RunRequest = {
        ...safeRequest,
        ...(thread.truncateAtUuid ? { resumeSessionAt: thread.truncateAtUuid } : safeRequest.resumeSessionAt ? { resumeSessionAt: safeRequest.resumeSessionAt } : {}),
      };
      // The previous session id is still on the thread (set by the last turn's
      // onComplete). Use the latest thread state after sendRunMessage.
      const latestThread = store.getThread(threadId);
      const previousSessionId = latestThread?.cliSessionId ?? thread.cliSessionId;
      try {
        runner.start(engine, resumedRequest, project.path, previousSessionId, {
          onEvent: (event: RunEvent) => {
            sendRunEvent(event);
            if (event.type === "context") void store.recordContextUsage(threadId, event.context);
            if (event.type === "finished") {
              runningModel.delete(threadId);
            }
          },
          onComplete: async (result) => {
            await finishRunAndNotify(threadId, result.content, result.status, result.sessionId, result.error, result.activity, result.durationMs, result.timeline, result.fileChanges, result.final, result.continueRunning);
          },
        }, browserHost?.bridgeLaunch(threadId, project.path));
        runningModel.set(threadId, { model: resumedRequest.model, effort: resumedRequest.effort, permission: resumedRequest.permission });
        return { accepted: true, state: sentState };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finishRunAndNotify(threadId, message, "error", latestThread?.cliSessionId ?? thread.cliSessionId, true);
        return { accepted: false, error: message };
      }
    }
    const sentState = await store.sendRunMessage(threadId, prompt, safeRequest.attachments, safeRequest.model, safeRequest.effort, permission, { asFollowUp });
    const accepted = runner.send(threadId, prompt, safeRequest.attachments);
    if (!accepted) {
      await finishRunAndNotify(threadId, "Unable to send the message; the run stopped.", "error", thread.cliSessionId, true);
      return { accepted: false, error: "Unable to send the message; the run stopped." };
    }
    return { accepted: true, state: sentState };
  });
  ipcMain.handle("run:context", (_event, threadId: string) => runner.requestContext(safeText(threadId, 100)));
  ipcMain.handle("run:permission-response", (_event, threadId: string, response: { requestId?: unknown; behavior?: unknown; updatedInput?: unknown; message?: unknown; toolUseID?: unknown; updatedPermissions?: unknown }) => {
    const safeThreadId = safeText(threadId, 100);
    if (typeof response?.requestId !== "string" || !["allow", "deny"].includes(String(response.behavior))) return false;
    const updatedInput = response.updatedInput && typeof response.updatedInput === "object" && !Array.isArray(response.updatedInput) ? response.updatedInput as Record<string, unknown> : undefined;
    const updatedPermissions = Array.isArray(response.updatedPermissions) ? response.updatedPermissions : undefined;
    return runner.respond(safeThreadId, {
      requestId: response.requestId.slice(0, 200),
      behavior: response.behavior as "allow" | "deny",
      updatedInput,
      message: typeof response.message === "string" ? response.message.slice(0, 2_000) : undefined,
      toolUseID: typeof response.toolUseID === "string" ? response.toolUseID.slice(0, 200) : undefined,
      updatedPermissions,
    });
  });
  ipcMain.handle("run:stop", (_event, threadId: string) => {
    const id = safeText(threadId, 100);
    runningModel.delete(id);
    return runner.stop(id);
  });

  const buildSafeRequest = async (request: RunRequest, threadId: string): Promise<RunRequest> => {
    const thread = store.getThread(threadId);
    const project = thread ? store.getProject(thread.projectId) : undefined;
    const permission = (["default", "plan", "acceptEdits", "auto", "full"].includes(request.permission) ? request.permission : "auto") as PermissionMode;
    return {
      threadId,
      prompt: safeText(request.prompt, 100_000).trim(),
      attachments: await normalizeAttachments(request.attachments),
      model: typeof request.model === "string" ? request.model.slice(0, 200) : "",
      effort: typeof request.effort === "string" ? request.effort.slice(0, 40) : "",
      permission,
      additionalDirectories: (project?.sourcePaths ?? [])
        .map((path) => resolve(path))
        .filter((path, index, paths) => path !== resolve(project?.path ?? "") && paths.indexOf(path) === index && existsSync(path))
        .slice(0, MAX_PROJECT_SOURCE_COUNT - 1),
      ...(typeof request.contextWindow === "number" && Number.isFinite(request.contextWindow) && request.contextWindow > 0 ? { contextWindow: Math.round(Math.min(request.contextWindow, 10_000_000)) } : {}),
      // Preserve edit/revert fork anchors so the CLI receives --resume-session-at
      // and the edited turn's fresh uuid (buildSafeRequest used to drop these).
      ...(typeof request.resumeSessionAt === "string" && request.resumeSessionAt.trim()
        ? { resumeSessionAt: request.resumeSessionAt.trim().slice(0, 200) }
        : {}),
      ...(typeof request.userMessageUuid === "string" && request.userMessageUuid.trim()
        ? { userMessageUuid: request.userMessageUuid.trim().slice(0, 200) }
        : {}),
      ...(typeof request.editMessageId === "string" && request.editMessageId.trim()
        ? { editMessageId: request.editMessageId.trim().slice(0, 200) }
        : {}),
    };
  };

  /**
   * Edit-and-resend: rewrite the target user message in place (fresh CLI uuid),
   * then start a run that forks the CLI transcript truncated at the message
   * BEFORE the edited one (so the edited turn replaces it, not appends) and
   * replays the edited prompt.
   *
   * A warm CLI session (process still alive after the previous turn finished)
   * is stopped automatically — the user should not have to click Stop first.
   */
  ipcMain.handle("run:edit-and-resend", async (_event, request: RunRequest) => {
    const threadId = safeText(request.threadId, 100);
    const thread = store.getThread(threadId);
    if (!thread) return { accepted: false, error: "Chat not found." };
    const project = store.getProject(thread.projectId);
    if (!project || !existsSync(project.path)) return { accepted: false, error: "The project folder is unavailable." };
    const messageId = typeof request.editMessageId === "string" ? request.editMessageId.slice(0, 200) : "";
    if (!messageId) return { accepted: false, error: "No message selected to edit." };
    const targetIndex = thread.messages.findIndex((message) => message.id === messageId);
    const target = thread.messages[targetIndex];
    if (!target || target.role !== "user") return { accepted: false, error: "Only user messages can be edited." };
    const prompt = safeText(request.prompt, 100_000).trim();
    if (!prompt) return { accepted: false, error: "Write a request first." };
    const status = await runtime.ensure();
    const engine = runtime.currentLaunch();
    if (!status.available || !engine) return { accepted: false, error: status.message };
    // Warm sessions stay alive between turns for follow-ups. Edit-and-resend
    // needs a forked replacement process, so retire the live one first.
    if (runner.isRunning(threadId)) {
      await runner.stopAndWait(threadId);
      runningModel.delete(threadId);
    }
    // The truncated fork ends at the message before the edited one, so the
    // edited turn (fresh uuid) replaces it in the new session.
    const resumeSessionAt = targetIndex > 0 ? (thread.messages[targetIndex - 1]?.uuid ?? undefined) : undefined;
    await store.rewriteUserMessage(threadId, messageId, prompt);
    const editedMessage = store.getThread(threadId)?.messages.find((message) => message.id === messageId);
    const userMessageUuid = editedMessage?.uuid;
    const safeRequest = await buildSafeRequest({ ...request, prompt, editMessageId: messageId, resumeSessionAt, userMessageUuid }, threadId);
    const startedState = await store.beginEditAndResend(threadId);
    // When editing the first user message there is no prior anchor — start a
    // fresh CLI session instead of resuming the full (pre-edit) transcript.
    const previousSessionId = resumeSessionAt ? thread.cliSessionId : undefined;
    try {
      runner.start(engine, safeRequest, project.path, previousSessionId, {
        onEvent: (event: RunEvent) => {
          sendRunEvent(event);
          if (event.type === "context") void store.recordContextUsage(threadId, event.context);
          if (event.type === "finished") {
            runningModel.delete(threadId);
          }
        },
        onComplete: async (result) => {
          await finishRunAndNotify(threadId, result.content, result.status, result.sessionId, result.error, result.activity, result.durationMs, result.timeline, result.fileChanges, result.final, result.continueRunning);
        },
      }, browserHost?.bridgeLaunch(threadId, project.path));
      runningModel.set(threadId, { model: safeRequest.model, effort: safeRequest.effort, permission: safeRequest.permission });
      return { accepted: true, state: startedState };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRunAndNotify(threadId, message, "error", thread.cliSessionId, true);
      return { accepted: false, error: message };
    }
  });

  /**
   * Revert-to-message: truncates the desktop transcript at the target user
   * message and, when requested, restores files changed by the discarded turns.
   *
   * File restore strategy (in order):
   *  1. Desktop reverse-apply of `fileChanges` recorded on discarded messages
   *     (reliable, works without a warm CLI session).
   *  2. CLI `rewind_files` checkpoint when a warm session still has one and
   *     desktop tracking found nothing to reverse.
   *
   * The CLI's non-dry-run success response omits `filesChanged`, so counts
   * always come from the dry-run list or from the desktop reverse-apply.
   * After file work the warm process is retired so the next send forks from
   * the truncated anchor.
   */
  ipcMain.handle("run:revert", async (_event, input: { threadId?: unknown; messageId?: unknown; revertFiles?: unknown }) => {
    const threadId = safeText(input?.threadId, 100);
    const thread = store.getThread(threadId);
    if (!thread) return { ok: false, error: "Chat not found." } satisfies RevertResult;
    const messageId = typeof input?.messageId === "string" ? input.messageId.slice(0, 200) : "";
    const targetIndex = thread.messages.findIndex((message) => message.id === messageId);
    const target = thread.messages[targetIndex];
    if (targetIndex < 0 || !target || target.role !== "user") return { ok: false, error: "Only user messages can be reverted to." } satisfies RevertResult;
    const removedMessages = thread.messages.length - (targetIndex + 1);
    const wantFiles = input?.revertFiles === true;
    // File rewinding and transcript truncation both key off the CLI uuid.
    const targetUuid = target.uuid ?? target.id;

    let restoredFiles = 0;
    if (wantFiles) {
      const project = store.getProject(thread.projectId);
      if (!project || !existsSync(project.path)) return { ok: false, error: "The project folder is unavailable." } satisfies RevertResult;

      // Desktop-tracked patches from every discarded turn, newest first so
      // multi-turn edits of the same path unwind correctly.
      const discardedChanges = thread.messages
        .slice(targetIndex + 1)
        .flatMap((message) => (message.fileChanges ?? []).map((change) => ({ change, createdAt: message.createdAt })))
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((entry) => entry.change);

      if (discardedChanges.length > 0) {
        const restored = restoreFilesFromChanges(project.path, discardedChanges);
        restoredFiles = restored.length;
      }

      // Fall back to (or supplement with) the CLI file-history checkpoint when
      // desktop tracking found nothing — e.g. edits that never produced a
      // comparable text snapshot still live in the warm CLI session.
      if (restoredFiles === 0 && runner.isRunning(threadId)) {
        const dryRun = await runner.rewindFiles(threadId, targetUuid, true);
        if (dryRun?.canRewind) {
          // The CLI omits filesChanged on the real rewind response; use dry-run
          // for the count, then perform the actual restore.
          const expected = dryRun.filesChanged?.length ?? 0;
          const rewind = await runner.rewindFiles(threadId, targetUuid, false);
          if (rewind?.canRewind) {
            restoredFiles = rewind.filesChanged?.length ?? expected;
          }
        }
      }

      // When neither path restored anything but the user asked for files, still
      // succeed the transcript revert — the renderer surfaces the count. Only
      // fail hard when we had no desktop patches AND no live session (so the
      // user can see the "file restore wasn't available" fallback toast).
      if (restoredFiles === 0 && discardedChanges.length === 0 && !runner.isRunning(threadId)) {
        return { ok: false, error: "No file changes were recorded for the discarded turns, and no live session is available for file restore." } satisfies RevertResult;
      }
    }

    // Retire the warm session so the next send starts a forked process at the
    // truncated anchor instead of appending onto the pre-revert transcript.
    if (runner.isRunning(threadId)) {
      await runner.stopAndWait(threadId);
      runningModel.delete(threadId);
    }

    const truncatedState = await store.truncateThreadAt(threadId, messageId);
    return { ok: true, state: truncatedState, removedMessages, ...(wantFiles ? { restoredFiles } : {}) } satisfies RevertResult & { state?: unknown };
  });

  ipcMain.handle("git:status", async (_event, projectId: string) => readGitStatus(safeText(projectId, 100)));
  ipcMain.handle("git:branches", async (_event, projectId: string) => {
    const project = store.getProject(safeText(projectId, 100));
    if (!project) return { current: "", branches: [], dirty: false };
    const status = await readGitStatus(project.id);
    if (!status.isRepository) return { current: "", branches: [], dirty: false };
    const result = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], project.path);
    if (result.code !== 0) throw new Error("Git could not read the local branches.");
    return { current: status.branch, branches: result.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean), dirty: !status.clean };
  });
  ipcMain.handle("git:checkout", async (_event, projectId: string, requestedBranch: string) => {
    const project = store.getProject(safeText(projectId, 100));
    if (!project) throw new Error("Project not found.");
    const branch = safeText(requestedBranch, 200).trim();
    const branches = await runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], project.path);
    if (!branches.stdout.split(/\r?\n/).includes(branch)) throw new Error("That local branch does not exist.");
    const result = await runGit(["switch", branch], project.path);
    if (result.code !== 0) throw new Error("Git could not switch branches. Commit or stash conflicting changes first.");
    return readGitStatus(project.id);
  });
  ipcMain.handle("git:create-branch", async (_event, projectId: string, requestedBranch: string) => {
    const project = store.getProject(safeText(projectId, 100));
    if (!project) throw new Error("Project not found.");
    const branch = safeText(requestedBranch, 200).trim();
    if (!/^(?![.-])(?!.*(?:\.\.|\/\.|\.lock(?:\/|$)))[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Enter a valid Git branch name.");
    const result = await runGit(["switch", "-c", branch], project.path);
    if (result.code !== 0) throw new Error("Git could not create that branch. It may already exist or conflict with current changes.");
    return readGitStatus(project.id);
  });
  ipcMain.handle("git:diff", async (_event, projectId: string, requestedPath: string) => {
    const project = store.getProject(safeText(projectId, 100));
    if (!project) throw new Error("Project not found.");
    const requested = safeText(requestedPath, 2_000);
    const absolute = resolve(project.path, requested);
    const path = relative(project.path, absolute);
    if (!path || path.includes("\0")) throw new Error("That file is outside the project.");
    const insideProject = !path.startsWith("..") && !isAbsolute(path);
    if (!insideProject) {
      if (!isWithinPath(MAXIMO_PROJECTS_ROOT, absolute)) throw new Error("That file is outside the project.");
      if (!existsSync(absolute)) return { path: absolute, patch: "" };
      const external = await runGit(["diff", "--no-index", "--unified=4", "--", "/dev/null", absolute], project.path);
      return { path: absolute, patch: external.stdout };
    }
    const repository = await runGit(["rev-parse", "--show-toplevel"], project.path);
    if (repository.code !== 0) {
      if (!existsSync(absolute)) return { path, patch: "" };
      const noIndex = await runGit(["diff", "--no-index", "--unified=4", "--", "/dev/null", absolute], project.path);
      return { path, patch: noIndex.stdout };
    }
    const result = await runGit(["diff", "--no-ext-diff", "--unified=4", "HEAD", "--", path], project.path);
    if (result.stdout.trim()) return { path, patch: result.stdout };
    const status = await runGit(["status", "--porcelain=v1", "--", path], project.path);
    if (/^\?\?\s/.test(status.stdout.trim())) {
      const untracked = await runGit(["diff", "--no-index", "--unified=4", "/dev/null", path], project.path);
      return { path, patch: untracked.stdout };
    }
    return { path, patch: result.stdout };
  });
  ipcMain.handle("git:stage", async (_event, projectId: string, requestedPaths: unknown) => {
    const project = projectForId(projectId);
    const paths = safeRelativeGitPaths(requestedPaths);
    if (paths.length === 0) return readGitStatus(project.id);
    const result = await runGit(["add", "--", ...paths], project.path);
    if (result.code !== 0) throw new Error("Git could not stage those files.");
    return readGitStatus(project.id);
  });
  ipcMain.handle("git:unstage", async (_event, projectId: string, requestedPaths: unknown) => {
    const project = projectForId(projectId);
    const paths = safeRelativeGitPaths(requestedPaths);
    if (paths.length === 0) return readGitStatus(project.id);
    const result = await runGit(["reset", "HEAD", "--", ...paths], project.path);
    if (result.code !== 0) throw new Error("Git could not unstage those files.");
    return readGitStatus(project.id);
  });
  ipcMain.handle("git:commit-push", async (_event, projectId: string, requestedMessage: string) => {
    const project = projectForId(projectId);
    const message = safeText(requestedMessage, 200).trim();
    if (!message) throw new Error("Enter a commit message first.");
    const stage = await runGit(["add", "-A"], project.path);
    if (stage.code !== 0) throw new Error("Git could not stage the working tree.");
    const commit = await runGit(["commit", "-m", message], project.path);
    if (commit.code !== 0) throw new Error(commit.stdout.trim() || "Git could not create the commit.");
    const push = await runGit(["push"], project.path);
    if (push.code !== 0) throw new Error(push.stdout.trim() || "The commit was created, but Git could not push it.");
    return readGitStatus(project.id);
  });
  ipcMain.handle("git:remote", async (_event, projectId: string): Promise<GitRemote | null> => {
    const project = projectForId(projectId);
    const result = await runGit(["remote", "get-url", "origin"], project.path);
    const url = result.stdout.trim();
    return result.code === 0 && url ? { name: "origin", url } : null;
  });
  ipcMain.handle("files:list", async (_event, projectId: string, requestedPath?: string, query?: string) => {
    const project = projectForId(projectId);
    return listWorkspaceFiles(project.path, safeText(requestedPath ?? "", 2_000), safeText(query ?? "", 200));
  });
  ipcMain.handle("files:read", async (_event, projectId: string, requestedPath: string) => {
    const project = projectForId(projectId);
    return readWorkspaceFile(project.path, safeText(requestedPath, 2_000));
  });
  ipcMain.handle("files:write", async (_event, projectId: string, requestedPath: string, content: string, expectedModifiedAt?: number) => {
    const project = projectForId(projectId);
    return writeWorkspaceFile(project.path, safeText(requestedPath, 2_000), safeText(content, 2 * 1024 * 1024), typeof expectedModifiedAt === "number" ? expectedModifiedAt : undefined);
  });
  ipcMain.handle("servers:list", () => listLocalServers());
  ipcMain.handle("terminal:start", (_event, projectId: string) => {
    const project = projectForId(projectId);
    return terminalManager.start(project.path);
  });
  ipcMain.handle("terminal:input", (_event, sessionId: string, input: string) => terminalManager.input(safeText(sessionId, 100), safeText(input, 20_000)));
  ipcMain.handle("terminal:resize", (_event, sessionId: string, columns: number, rows: number) => terminalManager.resize(safeText(sessionId, 100), Math.max(20, Math.min(400, Number(columns) || 80)), Math.max(5, Math.min(200, Number(rows) || 24))));
  ipcMain.handle("terminal:stop", (_event, sessionId: string) => terminalManager.stop(safeText(sessionId, 100)));
  ipcMain.handle("path:reveal", async (_event, path: string) => { shell.showItemInFolder(safeText(path, 2_000)); });
  ipcMain.handle("path:open", async (_event, path: string) => {
    const target = safeText(path, 2_000);
    if (/^https?:\/\//i.test(target)) {
      await shell.openExternal(target);
      return "";
    }
    return shell.openPath(target);
  });
  ipcMain.handle("path:editor", async (_event, path: string) => {
    const target = safeText(path, 2_000);
    const editorUrl = `vscode://file${pathToFileURL(target).pathname}`;
    await shell.openExternal(editorUrl).catch(() => shell.openPath(target));
  });
}

async function runGit(args: string[], cwd: string): Promise<{ code: number | null; stdout: string }> {
  return runCommand("git", args, cwd);
}

async function readGitStatus(projectId: string): Promise<GitStatus> {
  const project = store.getProject(projectId);
  const empty: GitStatus = { isRepository: false, branch: "", additions: 0, deletions: 0, files: [], clean: true };
  if (!project) return empty;
  const branchResult = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], project.path);
  if (branchResult.code !== 0) return empty;
  const [statusResult, diffResult] = await Promise.all([
    runGit(["status", "--porcelain=v1", "-uall"], project.path),
    runGit(["diff", "--numstat", "HEAD"], project.path),
  ]);
  const counts = new Map<string, { additions: number; deletions: number }>();
  for (const line of diffResult.stdout.split(/\r?\n/)) {
    const [added, deleted, ...parts] = line.split("\t");
    if (!parts.length) continue;
    counts.set(parts.join("\t"), { additions: Number(added) || 0, deletions: Number(deleted) || 0 });
  }
  const files: GitFile[] = statusResult.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    let statusCode = line.slice(0, 2).trim() || "?";
    // Normalize untracked "??" to single "?" so the UI shows a clean badge
    // instead of "??". Synara's diff tree uses "U"/"?" with a single glyph.
    if (statusCode === "??") statusCode = "?";
    // For renames "R ", "RM" etc keep the primary char, but a sole "?" stays "?".
    if (statusCode.length > 1 && statusCode[0] !== "?") statusCode = statusCode[0]!;
    const rawPath = line.slice(3);
    // Git quotes paths with spaces/unicode; strip surrounding quotes when present.
    const unquoted = rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, -1).replace(/\\"/g, '"') : rawPath;
    const path = unquoted.includes(" -> ") ? unquoted.split(" -> ").pop()! : unquoted;
    const count = counts.get(path) ?? { additions: 0, deletions: 0 };
    return {
      path,
      status: statusCode,
      ...count,
      staged: indexStatus !== " " && indexStatus !== "?",
      unstaged: worktreeStatus !== " " && worktreeStatus !== "?",
    };
  });
  // For untracked files Git's HEAD diff has no entry so counts stay 0/0.
  // Fill in a useful estimate (line count) so the tree doesn't show "+0 -0"
  // for brand-new files — Synara's working-tree view does the same.
  for (const file of files) {
    if (file.status === "?" && file.additions === 0 && file.deletions === 0) {
      try {
        const absolute = resolve(project.path, file.path);
        if (existsSync(absolute)) {
          const content = readFileSync(absolute, "utf8");
          if (content.length > 0) {
            // Count lines: number of newline-terminated rows + last line if no trailing newline.
            const lines = content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
            file.additions = Math.max(0, lines);
          }
        }
      } catch { /* keep 0/0 if read fails */ }
    }
  }
  return {
    isRepository: true,
    branch: branchResult.stdout.trim(),
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
    clean: files.length === 0,
  };
}

async function listLocalServers(): Promise<LocalServer[]> {
  if (process.platform === "win32") return [];
  const result = await runCommand("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], process.cwd());
  if (result.code !== 0) return [];
  const servers: LocalServer[] = [];
  const seen = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /TCP\s+([^\s:]+|\[[^\]]+\]|\*):(\d+)\s+\(LISTEN\)/.exec(line);
    if (!match) continue;
    const address = match[1] === "*" ? "127.0.0.1" : match[1].replace(/^\[|\]$/g, "");
    const port = Number(match[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) continue;
    const key = `${address}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pid = /\s+(\d+)\s+/.exec(line)?.[1];
    servers.push({ address, port, protocol: "http", ...(pid ? { pid: Number(pid) } : {}) });
  }
  return servers.sort((left, right) => left.port - right.port).slice(0, 32);
}

async function runCommand(command: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", () => resolvePromise({ code: -1, stdout: "" }));
    child.on("close", (code) => resolvePromise({ code, stdout }));
  });
}

function applyLegacyMacDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;

  // macOS 26 (Darwin 25+) sizes and masks the bundle icon itself. Overriding
  // it with a raw PNG makes the Dock tile appear larger than native icons.
  const darwinMajor = Number.parseInt(osRelease().split(".")[0] ?? "", 10);
  if (!Number.isFinite(darwinMajor) || darwinMajor >= 25) return;

  const iconPath = join(app.getAppPath(), "assets", "app-icon.png");
  if (!existsSync(iconPath)) return;
  const image = nativeImage.createFromBuffer(readFileSync(iconPath));
  if (!image.isEmpty()) app.dock.setIcon(image);
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  applyLegacyMacDockIcon();
  const siblingCli = resolve(app.getAppPath(), "..", "maximo-syntax-cli");
  const suggestedProject = !app.isPackaged && existsSync(join(siblingCli, "package.json")) ? siblingCli : undefined;
  store = new StateStore(app.getPath("userData"), createInitialState(suggestedProject));
  await store.initialize();
  if (process.env.MAXIMO_DESKTOP_QA_ONBOARDED) {
    await store.update((draft) => {
      draft.onboardingComplete = true;
      if (process.env.MAXIMO_DESKTOP_QA_THEME === "dark") draft.settings.theme = "dark";
      if (process.env.MAXIMO_DESKTOP_QA_THEME === "light") draft.settings.theme = "light";
    });
    const firstProject = store.getFirstProject();
    if (process.env.MAXIMO_DESKTOP_QA_THREAD && !store.hasThreads() && firstProject) {
      await store.createThread(firstProject.id);
    }
  }
  nativeTheme.themeSource = store.getTheme();
  runtime = new RuntimeManager({
    appPath: app.getAppPath(),
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
    configuredPath: () => store.getCliPath(),
    onStatus: (status) => send("engine:status-changed", status),
  });
  terminalManager = new TerminalManager((event) => send("terminal:event", event));
  browserManager = new BrowserManager({
    onRequestOpenPanel: (threadId) => send("browser:open-panel-request", { threadId }),
  });
  browserManager.subscribe((state) => send("browser:state", state));
  browserManager.subscribeCopyLink((event) => send("browser:copy-link", event));
  browserHost = new BrowserHostServer(
    browserManager,
    resolveBrowserBridgePath(),
    { onRequestOpenPanel: (threadId) => send("browser:open-panel-request", { threadId }) },
  );
  appUpdater = new AppUpdater({
    currentVersion: app.getVersion(),
    openExternal: (url) => shell.openExternal(url),
    onStateChange: (state) => send("update:state", state),
    // Background polling is most useful for installed builds; dev can still check manually.
    enableBackgroundChecks: app.isPackaged || process.env.MAXIMO_DESKTOP_UPDATE_CHECKS === "1",
  });
  registerIpc();
  createApplicationMenu();
  await createWindow();
  browserManager.setWindow(mainWindow);
  await browserHost.start();
  appUpdater.start();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

const quitApplication = () => {
  isQuitting = true;
  app.quit();
};

process.on("SIGINT", quitApplication);
process.on("SIGTERM", quitApplication);
app.on("before-quit", () => {
  isQuitting = true;
  appUpdater?.dispose();
  runner.stopAll();
  terminalManager?.stopAll();
  void browserHost?.dispose();
  browserManager?.dispose();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
