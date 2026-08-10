import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  session,
  shell,
} from "electron";
import type { DownloadItem, WebContents } from "electron";
import type {
  BrowserClearDataInput,
  BrowserCommandEvent,
  BrowserCopyLinkEvent,
  BrowserCredentialPromptResponse,
  BrowserDownloadActionInput,
  BrowserDownloadState,
  BrowserFindInput,
  BrowserHistoryEntry,
  BrowserHistorySearchInput,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserPanelBounds,
  BrowserPermissionPromptResponse,
  BrowserProfileSettingsInput,
  BrowserProfileSnapshot,
  BrowserScreenshotResult,
  BrowserSetPanelBoundsInput,
  BrowserState,
  BrowserTabInput,
  BrowserTabState,
  BrowserThreadInput,
  BrowserNavigateInput,
  BrowserZoomInput,
} from "./types.js";
import { BrowserProfileStore, normalizeBrowserOrigin } from "./browser-profile-store.js";
import { flushPersistentBrowserSession } from "./browser-session-persistence.js";
import { collapseDuplicateBrowserScheme } from "./browser-url.js";

export const BROWSER_SESSION_PARTITION = "persist:maximo-browser";
export const BROWSER_BLANK_URL = "about:blank";

type BrowserStateListener = (state: BrowserState) => void;
type HumanControlListener = () => void;
type BrowserCommandListener = (event: BrowserCommandEvent) => void;

type ExpectedInput =
  | {
      kind: "key";
      key: string;
      alt: boolean;
      control: boolean;
      meta: boolean;
      shift: boolean;
    }
  | {
      kind: "mouse";
      type: "mouseDown" | "mouseWheel" | "contextMenu";
      x: number;
      y: number;
      button?: string;
    };

interface PendingExpectedInput {
  signal: ExpectedInput;
  expiresAt: number;
}

export interface BrowserAutomationRuntime {
  readonly threadId: string;
  readonly tabId: string;
  readonly webContents: WebContents;
  expectAgentInput: (signal: ExpectedInput) => () => void;
}

export interface BrowserManagerOptions {
  profile: BrowserProfileStore;
  defaultDownloadDirectory: string;
  onRequestOpenPanel?: (threadId: string) => void;
}

interface BrowserRuntime {
  readonly key: string;
  readonly threadId: string;
  readonly tabId: string;
  readonly view: WebContentsView;
  readonly webContents: WebContents;
  readonly disposers: Array<() => void>;
}

interface PendingCredential {
  readonly id: string;
  readonly threadId: string;
  readonly origin: string;
  readonly username: string;
  readonly password: string;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface PendingPermission {
  readonly id: string;
  readonly threadId: string;
  readonly origin: string;
  readonly permission: string;
  readonly callback: (allowed: boolean) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ActiveDownload {
  readonly item: DownloadItem;
  readonly threadId: string;
}

const CREDENTIAL_LOOKUP_CHANNEL = "maximo-browser:credential-lookup";
const CREDENTIAL_SUBMIT_CHANNEL = "maximo-browser:credential-submitted";
const CREDENTIAL_USERNAME_CHANNEL = "maximo-browser:username-observed";
const CREDENTIAL_CHANGED_CHANNEL = "maximo-browser:credentials-changed";
const PROFILE_FLUSH_DELAY_MS = 750;
const CREDENTIAL_PROMPT_TIMEOUT_MS = 2 * 60_000;
const PERMISSION_PROMPT_TIMEOUT_MS = 30_000;
const MAX_DOWNLOADS = 20;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 2;
const ZOOM_STEP = 0.1;

const PERMISSION_LABELS: Record<string, string> = {
  camera: "use your camera",
  microphone: "use your microphone",
  media: "use your camera or microphone",
  geolocation: "know your location",
  notifications: "send notifications",
  midi: "use MIDI devices",
  midiSysex: "use MIDI devices with system access",
  pointerLock: "control the pointer",
  fullscreen: "enter full screen",
  "clipboard-read": "read your clipboard",
  "clipboard-sanitized-write": "write to your clipboard",
  idleDetection: "detect when you are idle",
};

const ALWAYS_ALLOWED_PERMISSIONS = new Set(["fullscreen", "clipboard-sanitized-write"]);
const UNSUPPORTED_DEVICE_PERMISSIONS = new Set(["hid", "serial", "usb", "bluetooth"]);

function runtimeKey(threadId: string, tabId: string): string {
  return `${threadId}:${tabId}`;
}

function defaultTitle(url: string): string {
  if (url === BROWSER_BLANK_URL) return "New tab";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function normalizeUrl(input: string | undefined): string {
  const value = collapseDuplicateBrowserScheme(input);
  if (!value) return BROWSER_BLANK_URL;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "about:") {
      return parsed.toString();
    }
  } catch {
    // Continue with browser-style input heuristics.
  }

  if (value.includes(" ")) {
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }
  const looksLikeHost = value.includes(".") || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(value);
  if (looksLikeHost) {
    const scheme = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(value) ? "http" : "https";
    try {
      return new URL(`${scheme}://${value}`).toString();
    } catch {
      // Fall through to a search URL.
    }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function isAllowedNavigation(url: string): boolean {
  if (url === BROWSER_BLANK_URL) return true;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function cloneState(state: BrowserState): BrowserState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => ({ ...tab })),
    credentialPrompt: state.credentialPrompt ? { ...state.credentialPrompt } : null,
    permissionPrompt: state.permissionPrompt ? { ...state.permissionPrompt } : null,
    find: state.find ? { ...state.find } : null,
    downloads: state.downloads.map((download) => ({ ...download })),
  };
}

function createTab(url = BROWSER_BLANK_URL): BrowserTabState {
  return {
    id: randomUUID(),
    url,
    title: defaultTitle(url),
    status: "suspended",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    faviconUrl: null,
    lastCommittedUrl: url === BROWSER_BLANK_URL ? null : url,
    lastError: null,
    zoomFactor: 1,
  };
}

function sanitizedDownloadFilename(value: string): string {
  const name = basename(value).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").trim();
  return (name || `download-${Date.now()}`).slice(0, 240);
}

function uniqueDownloadPath(directory: string, filename: string): string {
  const safeName = sanitizedDownloadFilename(filename);
  const dot = safeName.lastIndexOf(".");
  const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
  const extension = dot > 0 ? safeName.slice(dot) : "";
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = join(directory, index === 0 ? safeName : `${stem} (${index})${extension}`);
    if (!existsSync(candidate)) return candidate;
  }
  return join(directory, `${stem}-${Date.now()}${extension}`);
}

function permissionOrigin(webContents: WebContents, requestingUrl?: string): string | null {
  return normalizeBrowserOrigin(requestingUrl || webContents.getURL());
}

function permissionLabel(permission: string): string {
  return PERMISSION_LABELS[permission] ?? `use ${permission.replace(/[-_]/g, " ")}`;
}

function normalizeBounds(bounds: BrowserPanelBounds | null): BrowserPanelBounds | null {
  if (!bounds) return null;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return null;
  const width = Math.max(0, Math.floor(bounds.width));
  const height = Math.max(0, Math.floor(bounds.height));
  if (width === 0 || height === 0) return null;
  return {
    x: Math.max(0, Math.floor(bounds.x)),
    y: Math.max(0, Math.floor(bounds.y)),
    width,
    height,
  };
}

function canGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoBack() ?? webContents.canGoBack();
}

function canGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory?.canGoForward() ?? webContents.canGoForward();
}

function normalizeKey(value: string): string {
  return value.length === 1 ? value.toLocaleLowerCase("en-US") : value;
}

function expectedInputMatches(expected: ExpectedInput, actual: ExpectedInput): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "key" && actual.kind === "key") {
    return (
      normalizeKey(expected.key) === normalizeKey(actual.key) &&
      expected.alt === actual.alt &&
      expected.control === actual.control &&
      expected.meta === actual.meta &&
      expected.shift === actual.shift
    );
  }
  if (expected.kind !== "mouse" || actual.kind !== "mouse") return false;
  return (
    expected.type === actual.type &&
    (expected.button === undefined || expected.button === actual.button) &&
    Math.abs(expected.x - actual.x) <= 2 &&
    Math.abs(expected.y - actual.y) <= 2
  );
}

function screenshotName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    return `${host || "browser"}-${Date.now()}.png`;
  } catch {
    return `browser-${Date.now()}.png`;
  }
}

export class BrowserManager {
  private window: BrowserWindow | null = null;
  private activeThreadId: string | null = null;
  private activeBounds: BrowserPanelBounds | null = null;
  private attachedRuntimeKey: string | null = null;
  private readonly states = new Map<string, BrowserState>();
  private readonly runtimes = new Map<string, BrowserRuntime>();
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Set<BrowserStateListener>();
  private readonly humanListeners = new Map<string, Set<HumanControlListener>>();
  private readonly humanEpochs = new Map<string, number>();
  private readonly expectedInputs = new Map<string, PendingExpectedInput[]>();
  private readonly copyLinkListeners = new Set<(event: BrowserCopyLinkEvent) => void>();
  private readonly commandListeners = new Set<BrowserCommandListener>();
  private readonly session = session.fromPartition(BROWSER_SESSION_PARTITION);
  private readonly pendingCredentials = new Map<string, PendingCredential>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly observedUsernames = new Map<string, string>();
  private readonly activeDownloads = new Map<string, ActiveDownload>();
  private readonly downloads: BrowserDownloadState[] = [];
  private profileFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private downloadEmitTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: BrowserManagerOptions) {
    const baseUserAgent = app.userAgentFallback || "";
    const userAgent = baseUserAgent.replace(/\sElectron\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
    if (userAgent) this.session.setUserAgent(userAgent);
    this.session.spellCheckerEnabled = true;
    this.session.cookies.on("changed", this.handleCookieChanged);
    this.session.on("will-download", this.handleWillDownload);
    this.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
      if (ALWAYS_ALLOWED_PERMISSIONS.has(permission)) return true;
      if (UNSUPPORTED_DEVICE_PERMISSIONS.has(permission)) return false;
      const origin = normalizeBrowserOrigin(requestingOrigin);
      return Boolean(origin && this.options.profile.permission(origin, permission) === "allow");
    });
    this.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
      this.handlePermissionRequest(webContents, permission, callback, details.requestingUrl);
    });
  }

  setWindow(window: BrowserWindow | null): void {
    if (this.window === window) return;
    this.detachAttachedRuntime();
    if (this.window && this.window !== window) {
      for (const runtime of [...this.runtimes.values()]) {
        this.destroyRuntime(runtime.threadId, runtime.tabId);
      }
    }
    this.window = window;
    if (window && this.activeThreadId && this.activeBounds) {
      this.attachActiveRuntime();
    }
  }

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeCopyLink(listener: (event: BrowserCopyLinkEvent) => void): () => void {
    this.copyLinkListeners.add(listener);
    return () => this.copyLinkListeners.delete(listener);
  }

  subscribeCommand(listener: BrowserCommandListener): () => void {
    this.commandListeners.add(listener);
    return () => this.commandListeners.delete(listener);
  }

  subscribeHumanControl(threadId: string, listener: HumanControlListener): () => void {
    const listeners = this.humanListeners.get(threadId) ?? new Set<HumanControlListener>();
    listeners.add(listener);
    this.humanListeners.set(threadId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.humanListeners.delete(threadId);
    };
  }

  getHumanControlEpoch(threadId: string): number {
    return this.humanEpochs.get(threadId) ?? 0;
  }

  requestOpenPanel(threadId: string): void {
    try {
      this.options.onRequestOpenPanel?.(threadId);
    } catch {
      // Browser automation must continue if the renderer is unavailable.
    }
  }

  open(input: BrowserOpenInput): BrowserState {
    const state = this.ensureWorkspace(input.threadId, input.initialUrl);
    state.open = true;
    const tab = this.activeTab(state);
    if (this.activeThreadId === input.threadId && this.activeBounds) this.attachActiveRuntime();
    if (input.initialUrl !== undefined && tab && normalizeUrl(input.initialUrl) !== tab.url) {
      this.markHumanControl(input.threadId);
      return this.navigateInternal(input.threadId, tab.id, normalizeUrl(input.initialUrl), true);
    }
    this.emitState(input.threadId);
    return this.snapshot(input.threadId);
  }

  close(input: BrowserThreadInput): BrowserState {
    this.markHumanControl(input.threadId);
    const state = this.ensureWorkspace(input.threadId);
    this.dismissCredentialPrompt(input.threadId);
    this.resolvePermissionPrompt(input.threadId, false);
    if (this.activeThreadId === input.threadId) this.detachAttachedRuntime();
    for (const tab of state.tabs) this.destroyRuntime(input.threadId, tab.id);
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
    state.find = null;
    this.changed(input.threadId);
    this.emitState(input.threadId);
    return this.snapshot(input.threadId);
  }

  hide(input: BrowserThreadInput): void {
    this.markHumanControl(input.threadId);
    if (this.activeThreadId === input.threadId) {
      this.detachAttachedRuntime();
      this.activeThreadId = null;
      this.activeBounds = null;
    }
  }

  getState(input: BrowserThreadInput): BrowserState {
    return this.snapshot(input.threadId);
  }

  setPanelBounds(input: BrowserSetPanelBoundsInput): void {
    const bounds = normalizeBounds(input.bounds);
    this.activeBounds = bounds;
    if (!bounds) {
      if (this.activeThreadId === input.threadId) {
        this.detachAttachedRuntime();
        this.activeThreadId = null;
      }
      return;
    }
    const state = this.ensureWorkspace(input.threadId);
    if (!state.open) return;
    this.activeThreadId = input.threadId;
    this.attachActiveRuntime();
  }

  navigate(input: BrowserNavigateInput): BrowserState {
    this.markHumanControl(input.threadId);
    const state = this.ensureWorkspace(input.threadId);
    const tab = this.resolveTab(state, input.tabId);
    return this.navigateInternal(input.threadId, tab.id, normalizeUrl(input.url), true);
  }

  reload(input: BrowserTabInput): BrowserState {
    this.markHumanControl(input.threadId);
    const runtime = this.runtimeFor(input.threadId, input.tabId);
    runtime.webContents.reload();
    return this.snapshot(input.threadId);
  }

  goBack(input: BrowserTabInput): BrowserState {
    this.markHumanControl(input.threadId);
    const runtime = this.runtimeFor(input.threadId, input.tabId);
    if (canGoBack(runtime.webContents)) runtime.webContents.goBack();
    return this.snapshot(input.threadId);
  }

  goForward(input: BrowserTabInput): BrowserState {
    this.markHumanControl(input.threadId);
    const runtime = this.runtimeFor(input.threadId, input.tabId);
    if (canGoForward(runtime.webContents)) runtime.webContents.goForward();
    return this.snapshot(input.threadId);
  }

  newTab(input: BrowserNewTabInput): BrowserState {
    this.markHumanControl(input.threadId);
    return this.newTabInternal(input.threadId, input.url, input.activate !== false);
  }

  closeTab(input: BrowserTabInput): BrowserState {
    this.markHumanControl(input.threadId);
    return this.closeTabInternal(input.threadId, input.tabId);
  }

  selectTab(input: BrowserTabInput): BrowserState {
    this.markHumanControl(input.threadId);
    const state = this.ensureWorkspace(input.threadId);
    this.resolveTab(state, input.tabId);
    if (state.activeTabId !== input.tabId) {
      const previousRuntime = state.activeTabId ? this.runtimes.get(runtimeKey(input.threadId, state.activeTabId)) : null;
      if (state.find && previousRuntime && !previousRuntime.webContents.isDestroyed()) previousRuntime.webContents.stopFindInPage("clearSelection");
      state.activeTabId = input.tabId;
      state.find = null;
      this.changed(input.threadId);
      this.emitState(input.threadId);
    }
    if (this.activeThreadId === input.threadId && this.activeBounds) this.attachActiveRuntime();
    return this.snapshot(input.threadId);
  }

  async captureScreenshot(input: BrowserTabInput): Promise<BrowserScreenshotResult> {
    // Use the live runtime only — do not reload via getAutomationRuntime, which can
    // blank the page and produce a white freeze-frame under modal overlays.
    const runtime = this.runtimeFor(input.threadId, input.tabId);
    if (this.activeThreadId === input.threadId && this.activeBounds) {
      this.attachActiveRuntime();
    }
    const png = await runtime.webContents.capturePage();
    const buffer = png.toPNG();
    if (!buffer.length) throw new Error("Could not capture the browser page.");
    const bytes = Uint8Array.from(buffer);
    return {
      name: screenshotName(runtime.webContents.getURL()),
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      bytes,
      dataUrl: `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`,
    };
  }

  async copyScreenshotToClipboard(input: BrowserTabInput): Promise<void> {
    const screenshot = await this.captureScreenshot(input);
    const image = nativeImage.createFromBuffer(Buffer.from(screenshot.bytes));
    if (image.isEmpty()) throw new Error("Could not copy the browser screenshot.");
    clipboard.writeImage(image);
  }

  copyLink(input: BrowserTabInput): void {
    const state = this.ensureWorkspace(input.threadId);
    const tab = this.resolveTab(state, input.tabId);
    const runtime = this.runtimes.get(runtimeKey(input.threadId, input.tabId));
    const url = runtime && !runtime.webContents.isDestroyed() ? runtime.webContents.getURL() : tab.url;
    if (!url || url === BROWSER_BLANK_URL) return;
    clipboard.writeText(url);
    const event = { threadId: input.threadId, url };
    for (const listener of this.copyLinkListeners) listener(event);
  }

  openDevTools(input: BrowserTabInput): void {
    this.markHumanControl(input.threadId);
    this.runtimeFor(input.threadId, input.tabId).webContents.openDevTools({ mode: "detach" });
  }

  searchHistory(input: BrowserHistorySearchInput): BrowserHistoryEntry[] {
    return this.options.profile.searchHistory(input.query, input.limit);
  }

  getProfile(): BrowserProfileSnapshot {
    const settings = this.options.profile.settings();
    return {
      ...settings,
      persistent: this.session.isPersistent(),
      passwordStorageAvailable: this.options.profile.isPasswordStorageAvailable(),
      historyCount: this.options.profile.historyCount(),
      credentialCount: this.options.profile.credentialCount(),
      permissionCount: this.options.profile.permissionCount(),
      storagePath: this.session.getStoragePath(),
      defaultDownloadDirectory: this.options.defaultDownloadDirectory,
    };
  }

  async updateProfileSettings(input: BrowserProfileSettingsInput): Promise<BrowserProfileSnapshot> {
    await this.options.profile.updateSettings(input);
    if (input.savePasswords === false) {
      for (const threadId of this.states.keys()) this.dismissCredentialPrompt(threadId);
    }
    return this.getProfile();
  }

  async chooseDownloadDirectory(): Promise<string | null> {
    const options = {
      title: "Choose browser download folder",
      defaultPath: this.options.profile.settings().downloadDirectory ?? this.options.defaultDownloadDirectory,
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    };
    const result = this.window
      ? await dialog.showOpenDialog(this.window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  async clearData(input: BrowserClearDataInput): Promise<BrowserProfileSnapshot> {
    await this.options.profile.clear({
      history: input.history === true,
      passwords: input.passwords === true,
      permissions: input.permissions === true,
    });
    const dataTypes: Electron.ClearDataOptions["dataTypes"] = [];
    if (input.cookiesAndSiteData) dataTypes.push("cookies", "localStorage", "indexedDB", "serviceWorkers", "fileSystems");
    if (input.cache) dataTypes.push("cache");
    if (dataTypes.length > 0) {
      await this.session.clearData({ dataTypes });
      await this.session.closeAllConnections();
    }
    if (input.passwords) {
      for (const threadId of this.states.keys()) this.dismissCredentialPrompt(threadId);
      for (const runtime of this.runtimes.values()) {
        if (!runtime.webContents.isDestroyed()) runtime.webContents.send(CREDENTIAL_CHANGED_CHANNEL);
      }
    }
    if (input.permissions) {
      for (const threadId of this.states.keys()) this.resolvePermissionPrompt(threadId, false);
    }
    this.scheduleProfileFlush();
    return this.getProfile();
  }

  async respondToCredentialPrompt(input: BrowserCredentialPromptResponse): Promise<BrowserState> {
    const pending = this.pendingCredentials.get(input.promptId);
    if (!pending || pending.threadId !== input.threadId) return this.snapshot(input.threadId);
    clearTimeout(pending.timeout);
    this.pendingCredentials.delete(pending.id);
    const state = this.ensureWorkspace(input.threadId);
    if (state.credentialPrompt?.id === pending.id) state.credentialPrompt = null;
    if (input.action === "save") {
      await this.options.profile.saveCredential(pending.origin, pending.username, pending.password);
      for (const runtime of this.runtimes.values()) {
        if (!runtime.webContents.isDestroyed()) runtime.webContents.send(CREDENTIAL_CHANGED_CHANNEL);
      }
    } else if (input.action === "never") {
      await this.options.profile.neverSavePasswordsFor(pending.origin);
    }
    this.changed(input.threadId);
    this.emitState(input.threadId);
    return this.snapshot(input.threadId);
  }

  async respondToPermissionPrompt(input: BrowserPermissionPromptResponse): Promise<BrowserState> {
    const pending = this.pendingPermissions.get(input.promptId);
    if (!pending || pending.threadId !== input.threadId) return this.snapshot(input.threadId);
    if (input.action === "allow-always") await this.options.profile.setPermission(pending.origin, pending.permission, "allow");
    if (input.action === "block") await this.options.profile.setPermission(pending.origin, pending.permission, "block");
    this.resolvePermissionPrompt(input.threadId, input.action !== "block", pending.id);
    return this.snapshot(input.threadId);
  }

  findInPage(input: BrowserFindInput): BrowserState {
    this.markHumanControl(input.threadId);
    const runtime = this.runtimeFor(input.threadId, input.tabId);
    const state = this.ensureWorkspace(input.threadId);
    const query = input.query.slice(0, 1_000);
    if (!query) {
      runtime.webContents.stopFindInPage("clearSelection");
      state.find = null;
    } else {
      state.find = {
        query,
        activeMatch: state.find?.query === query ? state.find.activeMatch : 0,
        matches: state.find?.query === query ? state.find.matches : 0,
      };
      runtime.webContents.findInPage(query, {
        forward: input.forward !== false,
        findNext: input.findNext === true,
      });
    }
    this.changed(input.threadId);
    this.emitState(input.threadId);
    return this.snapshot(input.threadId);
  }

  stopFindInPage(input: BrowserTabInput): BrowserState {
    const state = this.ensureWorkspace(input.threadId);
    const runtime = this.runtimes.get(runtimeKey(input.threadId, input.tabId));
    if (runtime && !runtime.webContents.isDestroyed()) runtime.webContents.stopFindInPage("clearSelection");
    state.find = null;
    this.changed(input.threadId);
    this.emitState(input.threadId);
    return this.snapshot(input.threadId);
  }

  zoom(input: BrowserZoomInput): BrowserState {
    this.markHumanControl(input.threadId);
    const runtime = this.runtimeFor(input.threadId, input.tabId);
    const current = runtime.webContents.getZoomFactor();
    const requested = input.action === "reset" ? 1 : current + (input.action === "in" ? ZOOM_STEP : -ZOOM_STEP);
    runtime.webContents.setZoomFactor(Math.max(MIN_ZOOM_FACTOR, Math.min(MAX_ZOOM_FACTOR, Math.round(requested * 10) / 10)));
    this.syncRuntimeState(input.threadId, input.tabId);
    return this.snapshot(input.threadId);
  }

  async downloadAction(input: BrowserDownloadActionInput): Promise<void> {
    const state = this.downloads.find((download) => download.id === input.downloadId);
    const active = this.activeDownloads.get(input.downloadId);
    if (!state) return;
    if (input.action === "cancel" && active) active.item.cancel();
    if (input.action === "resume" && active && active.item.canResume()) active.item.resume();
    if (input.action === "open" && state.status === "completed" && state.path) await shell.openPath(state.path);
    if (input.action === "show" && state.path) shell.showItemInFolder(state.path);
    if (input.action === "remove") {
      const index = this.downloads.findIndex((download) => download.id === input.downloadId);
      if (index >= 0) this.downloads.splice(index, 1);
      this.activeDownloads.delete(input.downloadId);
      this.emitDownloads();
    }
  }

  async automationOpen(threadId: string, url: string | undefined, reuse: boolean): Promise<BrowserState> {
    const state = this.ensureWorkspace(threadId, url);
    state.open = true;
    let tab = reuse ? this.activeTab(state) : null;
    if (!tab) {
      const next = createTab(normalizeUrl(url));
      state.tabs.push(next);
      tab = next;
    }
    state.activeTabId = tab.id;
    if (url !== undefined) await this.loadTab(threadId, tab.id, normalizeUrl(url), true);
    else await this.getAutomationRuntime(threadId, tab.id);
    this.changed(threadId);
    this.emitState(threadId);
    return this.snapshot(threadId);
  }

  async automationNavigate(threadId: string, tabId: string, url: string): Promise<BrowserState> {
    const state = this.ensureWorkspace(threadId);
    this.resolveTab(state, tabId);
    await this.loadTab(threadId, tabId, normalizeUrl(url), true);
    this.changed(threadId);
    this.emitState(threadId);
    return this.snapshot(threadId);
  }

  async automationHistory(input: BrowserTabInput, direction: "back" | "forward" | "reload"): Promise<BrowserState> {
    const runtime = await this.getAutomationRuntime(input.threadId, input.tabId);
    let started = false;
    if (direction === "back" && canGoBack(runtime.webContents)) {
      started = true;
      runtime.webContents.goBack();
    }
    if (direction === "forward" && canGoForward(runtime.webContents)) {
      started = true;
      runtime.webContents.goForward();
    }
    if (direction === "reload") {
      started = true;
      runtime.webContents.reload();
    }
    if (started) await this.waitForRuntimeNavigation(input.threadId, input.tabId, runtime.webContents);
    return this.snapshot(input.threadId);
  }

  async automationSelectTab(input: BrowserTabInput): Promise<BrowserState> {
    const state = this.ensureWorkspace(input.threadId);
    this.resolveTab(state, input.tabId);
    state.activeTabId = input.tabId;
    await this.getAutomationRuntime(input.threadId, input.tabId);
    this.changed(input.threadId);
    this.emitState(input.threadId);
    return this.snapshot(input.threadId);
  }

  async automationCloseTab(input: BrowserTabInput): Promise<BrowserState> {
    return this.closeTabInternal(input.threadId, input.tabId);
  }

  async getAutomationRuntime(threadId: string, tabId: string): Promise<BrowserAutomationRuntime> {
    const state = this.ensureWorkspace(threadId);
    const tab = this.resolveTab(state, tabId);
    const runtime = this.ensureRuntime(threadId, tab.id);
    const expectedUrl = normalizeUrl(tab.lastCommittedUrl ?? tab.url);
    const currentUrl = runtime.webContents.getURL();
    if (currentUrl !== expectedUrl && expectedUrl !== BROWSER_BLANK_URL) {
      await this.loadTab(threadId, tab.id, expectedUrl, true);
    } else if (!currentUrl) {
      await runtime.webContents.loadURL(BROWSER_BLANK_URL);
    }
    return {
      threadId,
      tabId: tab.id,
      webContents: runtime.webContents,
      expectAgentInput: (signal) => this.expectAgentInput(threadId, tab.id, signal),
    };
  }

  async flushPersistentStorage(): Promise<void> {
    if (this.profileFlushTimer) {
      clearTimeout(this.profileFlushTimer);
      this.profileFlushTimer = null;
    }
    await Promise.all([
      flushPersistentBrowserSession(this.session),
      this.options.profile.flush(),
    ]);
  }

  dispose(): void {
    this.disposed = true;
    if (this.profileFlushTimer) clearTimeout(this.profileFlushTimer);
    this.profileFlushTimer = null;
    if (this.downloadEmitTimer) clearTimeout(this.downloadEmitTimer);
    this.downloadEmitTimer = null;
    this.session.cookies.removeListener("changed", this.handleCookieChanged);
    this.session.removeListener("will-download", this.handleWillDownload);
    this.session.setPermissionCheckHandler(null);
    this.session.setPermissionRequestHandler(null);
    for (const pending of this.pendingCredentials.values()) clearTimeout(pending.timeout);
    this.pendingCredentials.clear();
    for (const pending of this.pendingPermissions.values()) {
      clearTimeout(pending.timeout);
      pending.callback(false);
    }
    this.pendingPermissions.clear();
    this.detachAttachedRuntime();
    for (const runtime of [...this.runtimes.values()]) this.destroyRuntime(runtime.threadId, runtime.tabId);
    this.states.clear();
    this.listeners.clear();
    this.commandListeners.clear();
    this.humanListeners.clear();
    this.expectedInputs.clear();
    this.activeDownloads.clear();
    this.window = null;
  }

  private readonly handleCookieChanged = () => {
    this.scheduleProfileFlush();
  };

  private scheduleProfileFlush(): void {
    if (this.disposed) return;
    if (this.profileFlushTimer) clearTimeout(this.profileFlushTimer);
    this.profileFlushTimer = setTimeout(() => {
      this.profileFlushTimer = null;
      void Promise.all([
        flushPersistentBrowserSession(this.session),
        this.options.profile.flush(),
      ]).catch((error) => console.error("[browser] failed to persist profile data:", error));
    }, PROFILE_FLUSH_DELAY_MS);
    this.profileFlushTimer.unref?.();
  }

  private emitCommand(threadId: string, command: BrowserCommandEvent["command"]): void {
    const event = { threadId, command } satisfies BrowserCommandEvent;
    for (const listener of this.commandListeners) listener(event);
  }

  private runtimeForWebContents(webContents: WebContents): BrowserRuntime | null {
    for (const runtime of this.runtimes.values()) {
      if (runtime.webContents === webContents) return runtime;
    }
    return null;
  }

  private async handleCredentialSubmission(runtime: BrowserRuntime, input: unknown): Promise<void> {
    if (this.disposed || runtime.webContents.isDestroyed()) return;
    const source = input && typeof input === "object"
      ? input as { origin?: unknown; username?: unknown; password?: unknown }
      : {};
    const origin = normalizeBrowserOrigin(source.origin);
    const currentOrigin = normalizeBrowserOrigin(runtime.webContents.getURL());
    const password = typeof source.password === "string" ? source.password.slice(0, 16_384) : "";
    if (!origin || origin !== currentOrigin || !password || !this.options.profile.shouldOfferPasswordSave(origin)) return;

    let username = typeof source.username === "string" ? source.username.trim().slice(0, 512) : "";
    if (!username) username = this.observedUsernames.get(`${runtime.key}:${origin}`) ?? "";
    if (!username) username = (await this.options.profile.lookupCredential(origin))?.username ?? "";
    if (!username) return;

    const existing = this.options.profile.credentialMetadata(origin, username);
    if (existing) {
      const stored = await this.options.profile.lookupCredential(origin, username);
      if (stored?.password === password) {
        await this.options.profile.markCredentialUsed(existing.id);
        return;
      }
    }

    this.dismissCredentialPrompt(runtime.threadId);
    const id = randomUUID();
    const timeout = setTimeout(() => this.dismissCredentialPrompt(runtime.threadId, id), CREDENTIAL_PROMPT_TIMEOUT_MS);
    timeout.unref?.();
    this.pendingCredentials.set(id, {
      id,
      threadId: runtime.threadId,
      origin,
      username,
      password,
      timeout,
    });
    const state = this.ensureWorkspace(runtime.threadId);
    state.credentialPrompt = {
      id,
      origin,
      host: new URL(origin).host,
      username,
      mode: existing ? "update" : "save",
    };
    this.changed(runtime.threadId);
    this.emitState(runtime.threadId);
    this.requestOpenPanel(runtime.threadId);
  }

  private dismissCredentialPrompt(threadId: string, promptId?: string): void {
    let removed = false;
    for (const [id, pending] of this.pendingCredentials) {
      if (pending.threadId !== threadId || (promptId && id !== promptId)) continue;
      clearTimeout(pending.timeout);
      this.pendingCredentials.delete(id);
      removed = true;
    }
    const state = this.states.get(threadId);
    if (!state?.credentialPrompt || (promptId && state.credentialPrompt.id !== promptId)) return;
    state.credentialPrompt = null;
    if (removed || state) {
      this.changed(threadId);
      this.emitState(threadId);
    }
  }

  private handlePermissionRequest(
    webContents: WebContents,
    permission: string,
    callback: (allowed: boolean) => void,
    requestingUrl?: string,
  ): void {
    if (this.disposed || webContents.isDestroyed()) {
      callback(false);
      return;
    }
    if (ALWAYS_ALLOWED_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    if (UNSUPPORTED_DEVICE_PERMISSIONS.has(permission)) {
      callback(false);
      return;
    }
    const runtime = this.runtimeForWebContents(webContents);
    const origin = permissionOrigin(webContents, requestingUrl);
    if (!runtime || !origin) {
      callback(false);
      return;
    }
    const stored = this.options.profile.permission(origin, permission);
    if (stored) {
      callback(stored === "allow");
      return;
    }

    this.resolvePermissionPrompt(runtime.threadId, false);
    const id = randomUUID();
    const timeout = setTimeout(() => this.resolvePermissionPrompt(runtime.threadId, false, id), PERMISSION_PROMPT_TIMEOUT_MS);
    timeout.unref?.();
    this.pendingPermissions.set(id, {
      id,
      threadId: runtime.threadId,
      origin,
      permission,
      callback,
      timeout,
    });
    const state = this.ensureWorkspace(runtime.threadId);
    state.permissionPrompt = {
      id,
      origin,
      host: new URL(origin).host,
      permission,
      label: permissionLabel(permission),
    };
    this.changed(runtime.threadId);
    this.emitState(runtime.threadId);
    this.requestOpenPanel(runtime.threadId);
  }

  private resolvePermissionPrompt(threadId: string, allowed: boolean, promptId?: string): void {
    let resolved = false;
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.threadId !== threadId || (promptId && id !== promptId)) continue;
      clearTimeout(pending.timeout);
      this.pendingPermissions.delete(id);
      pending.callback(allowed);
      resolved = true;
    }
    const state = this.states.get(threadId);
    if (!state?.permissionPrompt || (promptId && state.permissionPrompt.id !== promptId)) return;
    state.permissionPrompt = null;
    if (resolved || state) {
      this.changed(threadId);
      this.emitState(threadId);
    }
  }

  private readonly handleWillDownload = (_event: Electron.Event, item: DownloadItem, webContents: WebContents) => {
    const runtime = this.runtimeForWebContents(webContents);
    if (!runtime) return;
    const id = randomUUID();
    const download: BrowserDownloadState = {
      id,
      filename: sanitizedDownloadFilename(item.getFilename()),
      path: null,
      url: item.getURL().slice(0, 8_192),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      status: "progressing",
      startedAt: Date.now(),
      canResume: item.canResume(),
    };
    this.downloads.unshift(download);
    this.downloads.splice(MAX_DOWNLOADS);
    this.activeDownloads.set(id, { item, threadId: runtime.threadId });
    this.emitDownloadsSoon(true);

    const update = (_downloadEvent: Electron.Event, state: "progressing" | "interrupted") => {
      download.receivedBytes = item.getReceivedBytes();
      download.totalBytes = item.getTotalBytes();
      download.status = state;
      download.canResume = item.canResume();
      const savePath = item.getSavePath();
      if (savePath) download.path = savePath;
      this.emitDownloadsSoon();
    };
    const done = (_downloadEvent: Electron.Event, state: "completed" | "cancelled" | "interrupted") => {
      download.receivedBytes = item.getReceivedBytes();
      download.totalBytes = item.getTotalBytes();
      download.status = state;
      download.canResume = item.canResume();
      const savePath = item.getSavePath();
      if (savePath) download.path = savePath;
      if (state !== "interrupted") this.activeDownloads.delete(id);
      this.emitDownloadsSoon(true);
    };
    item.on("updated", update);
    item.once("done", done);

    const settings = this.options.profile.settings();
    if (settings.askWhereToSaveDownloads) {
      item.pause();
      void this.chooseDownloadPath(download.filename).then((path) => {
        if (!path) {
          item.cancel();
          return;
        }
        download.path = path;
        item.setSavePath(path);
        if (item.isPaused()) item.resume();
        this.emitDownloadsSoon(true);
      }).catch(() => item.cancel());
      return;
    }

    const directory = settings.downloadDirectory ?? this.options.defaultDownloadDirectory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const savePath = uniqueDownloadPath(directory, download.filename);
    download.path = savePath;
    item.setSavePath(savePath);
  };

  private async chooseDownloadPath(filename: string): Promise<string | null> {
    const options = {
      title: "Save browser download",
      defaultPath: join(this.options.profile.settings().downloadDirectory ?? this.options.defaultDownloadDirectory, filename),
    };
    const result = this.window
      ? await dialog.showSaveDialog(this.window, options)
      : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  private emitDownloadsSoon(immediate = false): void {
    if (this.downloadEmitTimer) clearTimeout(this.downloadEmitTimer);
    if (immediate) {
      this.downloadEmitTimer = null;
      this.emitDownloads();
      return;
    }
    this.downloadEmitTimer = setTimeout(() => {
      this.downloadEmitTimer = null;
      this.emitDownloads();
    }, 100);
    this.downloadEmitTimer.unref?.();
  }

  private emitDownloads(): void {
    for (const [threadId, state] of this.states) {
      state.downloads = this.downloads.map((download) => ({ ...download }));
      this.changed(threadId);
      this.emitState(threadId);
    }
  }

  private showContextMenu(runtime: BrowserRuntime, params: Electron.ContextMenuParams): void {
    if (!this.window || this.window.isDestroyed()) return;
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({ label: suggestion, click: () => runtime.webContents.replaceMisspelling(suggestion) });
      }
      if (params.dictionarySuggestions.length > 0) template.push({ type: "separator" });
      template.push({
        label: "Add to dictionary",
        click: () => this.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
      template.push({ type: "separator" });
    }
    if (params.isEditable) {
      template.push(
        { role: "undo", enabled: params.editFlags.canUndo },
        { role: "redo", enabled: params.editFlags.canRedo },
        { type: "separator" },
        { role: "cut", enabled: params.editFlags.canCut && params.formControlType !== "input-password" },
        { role: "copy", enabled: params.editFlags.canCopy && params.formControlType !== "input-password" },
        { role: "paste", enabled: params.editFlags.canPaste },
        { role: "selectAll", enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText) {
      template.push({ role: "copy" });
    }
    if (params.linkURL && isAllowedNavigation(params.linkURL)) {
      if (template.length > 0) template.push({ type: "separator" });
      template.push(
        { label: "Open link in new tab", click: () => this.newTabInternal(runtime.threadId, params.linkURL, true) },
        { label: "Copy link address", click: () => clipboard.writeText(params.linkURL) },
      );
    }
    if (params.mediaType === "image" && params.srcURL && isAllowedNavigation(params.srcURL)) {
      if (template.length > 0) template.push({ type: "separator" });
      template.push(
        { label: "Copy image", click: () => runtime.webContents.copyImageAt(params.x, params.y) },
        { label: "Save image as…", click: () => runtime.webContents.downloadURL(params.srcURL) },
      );
    }
    if (template.length > 0) template.push({ type: "separator" });
    template.push(
      { label: "Back", enabled: canGoBack(runtime.webContents), click: () => runtime.webContents.goBack() },
      { label: "Forward", enabled: canGoForward(runtime.webContents), click: () => runtime.webContents.goForward() },
      { label: "Reload", click: () => runtime.webContents.reload() },
      { type: "separator" },
      { label: "Inspect", click: () => runtime.webContents.inspectElement(params.x, params.y) },
    );
    Menu.buildFromTemplate(template).popup({ window: this.window, frame: params.frame ?? undefined });
  }

  private ensureWorkspace(threadId: string, initialUrl?: string): BrowserState {
    const existing = this.states.get(threadId);
    if (existing) {
      if (!existing.activeTabId && existing.tabs.length > 0) existing.activeTabId = existing.tabs[0]!.id;
      return existing;
    }
    const tab = createTab(normalizeUrl(initialUrl));
    const state: BrowserState = {
      threadId,
      version: 0,
      open: false,
      activeTabId: tab.id,
      tabs: [tab],
      lastError: null,
      credentialPrompt: null,
      permissionPrompt: null,
      find: null,
      downloads: this.downloads.map((download) => ({ ...download })),
    };
    this.states.set(threadId, state);
    this.versions.set(threadId, 0);
    return state;
  }

  private snapshot(threadId: string): BrowserState {
    return cloneState(this.ensureWorkspace(threadId));
  }

  private activeTab(state: BrowserState): BrowserTabState | null {
    return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0] ?? null;
  }

  private resolveTab(state: BrowserState, tabId?: string): BrowserTabState {
    const tab = (tabId ? state.tabs.find((candidate) => candidate.id === tabId) : this.activeTab(state)) ?? state.tabs[0];
    if (!tab) {
      const fallback = createTab();
      state.tabs = [fallback];
      state.activeTabId = fallback.id;
      return fallback;
    }
    return tab;
  }

  private changed(threadId: string): void {
    const next = (this.versions.get(threadId) ?? 0) + 1;
    this.versions.set(threadId, next);
    const state = this.states.get(threadId);
    if (state) state.version = next;
  }

  private emitState(threadId: string): void {
    const state = this.snapshot(threadId);
    for (const listener of this.listeners) listener(state);
  }

  private markHumanControl(threadId: string): void {
    const next = (this.humanEpochs.get(threadId) ?? 0) + 1;
    this.humanEpochs.set(threadId, next);
    const prefix = `${threadId}:`;
    for (const key of this.expectedInputs.keys()) {
      if (key.startsWith(prefix)) this.expectedInputs.delete(key);
    }
    for (const listener of [...(this.humanListeners.get(threadId) ?? [])]) listener();
  }

  private expectAgentInput(threadId: string, tabId: string, signal: ExpectedInput): () => void {
    const key = runtimeKey(threadId, tabId);
    const pending = this.expectedInputs.get(key) ?? [];
    const entry: PendingExpectedInput = { signal, expiresAt: Date.now() + 1_500 };
    pending.push(entry);
    this.expectedInputs.set(key, pending.slice(-64));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const now = Date.now();
      const current = (this.expectedInputs.get(key) ?? []).filter((candidate) => candidate.expiresAt > now);
      if (current.includes(entry)) entry.expiresAt = Math.min(entry.expiresAt, now + 150);
      if (current.length > 0) this.expectedInputs.set(key, current);
      else this.expectedInputs.delete(key);
    };
  }

  private consumeExpectedInput(threadId: string, tabId: string, actual: ExpectedInput): boolean {
    const key = runtimeKey(threadId, tabId);
    const current = (this.expectedInputs.get(key) ?? []).filter((entry) => entry.expiresAt > Date.now());
    const index = current.findIndex((entry) => expectedInputMatches(entry.signal, actual));
    if (index < 0) {
      if (current.length > 0) this.expectedInputs.set(key, current);
      else this.expectedInputs.delete(key);
      return false;
    }
    current.splice(index, 1);
    if (current.length > 0) this.expectedInputs.set(key, current);
    else this.expectedInputs.delete(key);
    return true;
  }

  private navigateInternal(threadId: string, tabId: string, url: string, load: boolean): BrowserState {
    const state = this.ensureWorkspace(threadId);
    const tab = this.resolveTab(state, tabId);
    if (state.activeTabId === tabId) state.find = null;
    tab.url = url;
    tab.title = defaultTitle(url);
    tab.lastCommittedUrl = url === BROWSER_BLANK_URL ? null : null;
    tab.lastError = null;
    if (load) {
      const runtime = this.runtimes.get(runtimeKey(threadId, tab.id));
      if (runtime) void this.loadTab(threadId, tab.id, url, true);
    }
    this.changed(threadId);
    this.emitState(threadId);
    return this.snapshot(threadId);
  }

  private newTabInternal(threadId: string, url: string | undefined, activate: boolean): BrowserState {
    const state = this.ensureWorkspace(threadId);
    const tab = createTab(normalizeUrl(url));
    state.tabs.push(tab);
    if (activate || !state.activeTabId) state.activeTabId = tab.id;
    if (this.activeThreadId === threadId && this.activeBounds && state.activeTabId === tab.id) this.attachActiveRuntime();
    this.changed(threadId);
    this.emitState(threadId);
    return this.snapshot(threadId);
  }

  private closeTabInternal(threadId: string, tabId: string): BrowserState {
    const state = this.ensureWorkspace(threadId);
    const index = state.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return this.snapshot(threadId);
    if (state.activeTabId === tabId) state.find = null;
    this.destroyRuntime(threadId, tabId);
    state.tabs.splice(index, 1);
    if (state.tabs.length === 0) {
      const replacement = createTab();
      state.tabs = [replacement];
      state.activeTabId = replacement.id;
    } else if (state.activeTabId === tabId) {
      state.activeTabId = state.tabs[Math.max(0, index - 1)]?.id ?? state.tabs[0]!.id;
    }
    this.changed(threadId);
    if (this.activeThreadId === threadId && this.activeBounds) this.attachActiveRuntime();
    this.emitState(threadId);
    return this.snapshot(threadId);
  }

  private ensureRuntime(threadId: string, tabId: string): BrowserRuntime {
    const key = runtimeKey(threadId, tabId);
    const existing = this.runtimes.get(key);
    if (existing && !existing.webContents.isDestroyed()) return existing;
    if (existing) this.destroyRuntime(threadId, tabId);

    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_SESSION_PARTITION,
        preload: join(app.getAppPath(), "dist-electron", "browser-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
      },
    });
    const runtime: BrowserRuntime = {
      key,
      threadId,
      tabId,
      view,
      webContents: view.webContents,
      disposers: [],
    };
    this.configureRuntime(runtime);
    this.runtimes.set(key, runtime);
    const tab = this.ensureWorkspace(threadId).tabs.find((candidate) => candidate.id === tabId);
    if (tab) {
      tab.status = "live";
      tab.lastError = null;
      this.changed(threadId);
    }
    return runtime;
  }

  private configureRuntime(runtime: BrowserRuntime): void {
    const { threadId, tabId, webContents } = runtime;
    const navigationGuard = (event: Electron.Event, url: string) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    };
    webContents.on("will-navigate", navigationGuard);
    runtime.disposers.push(() => webContents.removeListener("will-navigate", navigationGuard));

    webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedNavigation(url)) {
        setImmediate(() => {
          if (!this.disposed) this.newTabInternal(threadId, url, true);
        });
      }
      return { action: "deny" };
    });

    webContents.ipc.handle(CREDENTIAL_LOOKUP_CHANNEL, async (event, input: unknown) => {
      if (event.senderFrame !== webContents.mainFrame || webContents.isDestroyed()) return null;
      const source = input && typeof input === "object" ? input as { origin?: unknown } : {};
      const requestedOrigin = normalizeBrowserOrigin(source.origin);
      const currentOrigin = normalizeBrowserOrigin(webContents.getURL());
      if (!requestedOrigin || requestedOrigin !== currentOrigin) return null;
      const credential = await this.options.profile.lookupCredential(requestedOrigin);
      return credential ? { username: credential.username, password: credential.password } : null;
    });
    runtime.disposers.push(() => webContents.ipc.removeHandler(CREDENTIAL_LOOKUP_CHANNEL));

    const observeUsername = (event: Electron.IpcMainEvent, input: unknown) => {
      if (event.senderFrame !== webContents.mainFrame) return;
      const source = input && typeof input === "object" ? input as { origin?: unknown; username?: unknown } : {};
      const origin = normalizeBrowserOrigin(source.origin);
      const currentOrigin = normalizeBrowserOrigin(webContents.getURL());
      const username = typeof source.username === "string" ? source.username.trim().slice(0, 512) : "";
      if (origin && origin === currentOrigin && username) this.observedUsernames.set(`${runtime.key}:${origin}`, username);
    };
    webContents.ipc.on(CREDENTIAL_USERNAME_CHANNEL, observeUsername);
    runtime.disposers.push(() => webContents.ipc.removeListener(CREDENTIAL_USERNAME_CHANNEL, observeUsername));

    const submitCredential = (event: Electron.IpcMainEvent, input: unknown) => {
      if (event.senderFrame !== webContents.mainFrame) return;
      void this.handleCredentialSubmission(runtime, input);
    };
    webContents.ipc.on(CREDENTIAL_SUBMIT_CHANNEL, submitCredential);
    runtime.disposers.push(() => webContents.ipc.removeListener(CREDENTIAL_SUBMIT_CHANNEL, submitCredential));

    const beforeInput = (event: Electron.Event, input: Electron.Input) => {
      if (input.type !== "keyDown") return;
      const actual: ExpectedInput = {
        kind: "key",
        key: input.key,
        alt: input.alt === true,
        control: input.control === true,
        meta: input.meta === true,
        shift: input.shift === true,
      };
      if (!this.consumeExpectedInput(threadId, tabId, actual)) this.markHumanControl(threadId);
      const commandModifier = input.meta || input.control;
      const key = input.key.toLocaleLowerCase("en-US");
      if (commandModifier && key === "l") {
        event.preventDefault();
        this.emitCommand(threadId, "focus-address");
      } else if (commandModifier && key === "f") {
        event.preventDefault();
        this.emitCommand(threadId, "toggle-find");
      } else if (commandModifier && key === "t") {
        event.preventDefault();
        this.newTabInternal(threadId, undefined, true);
        this.emitCommand(threadId, "focus-address");
      } else if (commandModifier && key === "w") {
        event.preventDefault();
        setImmediate(() => {
          if (!this.disposed) this.closeTabInternal(threadId, tabId);
        });
      } else if (commandModifier && key === "r") {
        event.preventDefault();
        webContents.reload();
      } else if (commandModifier && (key === "+" || key === "=")) {
        event.preventDefault();
        this.zoom({ threadId, tabId, action: "in" });
      } else if (commandModifier && key === "-") {
        event.preventDefault();
        this.zoom({ threadId, tabId, action: "out" });
      } else if (commandModifier && key === "0") {
        event.preventDefault();
        this.zoom({ threadId, tabId, action: "reset" });
      } else if ((input.alt || input.meta) && input.key === "ArrowLeft") {
        event.preventDefault();
        if (canGoBack(webContents)) webContents.goBack();
      } else if ((input.alt || input.meta) && input.key === "ArrowRight") {
        event.preventDefault();
        if (canGoForward(webContents)) webContents.goForward();
      }
    };
    webContents.on("before-input-event", beforeInput);
    runtime.disposers.push(() => webContents.removeListener("before-input-event", beforeInput));

    const beforeMouse = (_event: Electron.Event, input: Electron.MouseInputEvent) => {
      if (input.type !== "mouseDown" && input.type !== "mouseWheel" && input.type !== "contextMenu") return;
      const actual: ExpectedInput = {
        kind: "mouse",
        type: input.type,
        x: input.x,
        y: input.y,
        ...(input.button === undefined ? {} : { button: input.button }),
      };
      if (!this.consumeExpectedInput(threadId, tabId, actual)) this.markHumanControl(threadId);
    };
    webContents.on("before-mouse-event", beforeMouse);
    runtime.disposers.push(() => webContents.removeListener("before-mouse-event", beforeMouse));

    const sync = () => this.syncRuntimeState(threadId, tabId);
    for (const event of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated", "zoom-changed"] as const) {
      (webContents.on as (eventName: string, listener: (...args: unknown[]) => void) => void)(event, sync);
      runtime.disposers.push(() => (webContents.removeListener as (eventName: string, listener: (...args: unknown[]) => void) => void)(event, sync));
    }
    const recordNavigation = (_event: Electron.Event, url: string) => {
      if (!isAllowedNavigation(url) || url === BROWSER_BLANK_URL) return;
      const state = this.states.get(threadId);
      const tab = state?.tabs.find((candidate) => candidate.id === tabId);
      void this.options.profile.recordVisit(url, webContents.getTitle() || defaultTitle(url), tab?.faviconUrl);
      this.scheduleProfileFlush();
    };
    const recordInPageNavigation = (_event: Electron.Event, url: string, isMainFrame: boolean) => {
      if (isMainFrame) recordNavigation(_event, url);
    };
    webContents.on("did-navigate", recordNavigation);
    webContents.on("did-navigate-in-page", recordInPageNavigation);
    runtime.disposers.push(() => {
      webContents.removeListener("did-navigate", recordNavigation);
      webContents.removeListener("did-navigate-in-page", recordInPageNavigation);
    });

    const updateHistoryTitle = (_event: Electron.Event, title: string) => {
      const url = webContents.getURL();
      if (isAllowedNavigation(url) && url !== BROWSER_BLANK_URL) void this.options.profile.updateHistoryTitle(url, title);
    };
    webContents.on("page-title-updated", updateHistoryTitle);
    runtime.disposers.push(() => webContents.removeListener("page-title-updated", updateHistoryTitle));

    const updateFavicon = (_event: Electron.Event, favicons: string[]) => {
      const state = this.states.get(threadId);
      const tab = state?.tabs.find((candidate) => candidate.id === tabId);
      if (!state || !tab) return;
      const favicon = favicons.find((value) => /^https?:|^data:image\//i.test(value)) ?? null;
      if (tab.faviconUrl === favicon) return;
      tab.faviconUrl = favicon;
      this.changed(threadId);
      this.emitState(threadId);
      if (favicon) void this.options.profile.updateHistoryFavicon(webContents.getURL(), favicon);
    };
    webContents.on("page-favicon-updated", updateFavicon);
    runtime.disposers.push(() => webContents.removeListener("page-favicon-updated", updateFavicon));

    const foundInPage = (_event: Electron.Event, result: Electron.FoundInPageResult) => {
      const state = this.states.get(threadId);
      if (!state?.find || state.activeTabId !== tabId) return;
      state.find = {
        ...state.find,
        activeMatch: result.activeMatchOrdinal,
        matches: result.matches,
      };
      this.changed(threadId);
      this.emitState(threadId);
    };
    webContents.on("found-in-page", foundInPage);
    runtime.disposers.push(() => webContents.removeListener("found-in-page", foundInPage));

    const contextMenu = (_event: Electron.Event, params: Electron.ContextMenuParams) => this.showContextMenu(runtime, params);
    webContents.on("context-menu", contextMenu);
    runtime.disposers.push(() => webContents.removeListener("context-menu", contextMenu));
    const failed = (_event: Electron.Event, code: number, _description: string, validatedUrl: string, isMainFrame: boolean) => {
      if (!isMainFrame || code === -3) return;
      const state = this.states.get(threadId);
      const tab = state?.tabs.find((candidate) => candidate.id === tabId);
      if (!state || !tab) return;
      tab.isLoading = false;
      tab.lastError = code === -105 ? "Could not resolve this address." : "Could not open this page.";
      if (validatedUrl) tab.url = validatedUrl;
      state.lastError = state.activeTabId === tabId ? tab.lastError : state.lastError;
      this.changed(threadId);
      this.emitState(threadId);
    };
    webContents.on("did-fail-load", failed);
    runtime.disposers.push(() => webContents.removeListener("did-fail-load", failed));

    const lost = () => {
      if (this.runtimes.get(runtime.key) !== runtime) return;
      this.destroyRuntime(threadId, tabId);
      const state = this.states.get(threadId);
      const tab = state?.tabs.find((candidate) => candidate.id === tabId);
      if (!state || !tab) return;
      tab.status = "error";
      tab.isLoading = false;
      tab.lastError = "This tab stopped unexpectedly.";
      state.lastError = state.activeTabId === tabId ? tab.lastError : state.lastError;
      this.changed(threadId);
      this.emitState(threadId);
    };
    webContents.on("render-process-gone", lost);
    webContents.on("destroyed", lost);
    runtime.disposers.push(() => {
      webContents.removeListener("render-process-gone", lost);
      webContents.removeListener("destroyed", lost);
    });
  }

  private syncRuntimeState(threadId: string, tabId: string): void {
    const runtime = this.runtimes.get(runtimeKey(threadId, tabId));
    const state = this.states.get(threadId);
    const tab = state?.tabs.find((candidate) => candidate.id === tabId);
    if (!runtime || !state || !tab || runtime.webContents.isDestroyed()) return;
    const url = runtime.webContents.getURL() || tab.url;
    const title = runtime.webContents.getTitle();
    const nextUrl = url || BROWSER_BLANK_URL;
    const nextTitle = title && title !== BROWSER_BLANK_URL ? title : defaultTitle(nextUrl);
    const zoomFactor = Math.round(runtime.webContents.getZoomFactor() * 100) / 100;
    const changed =
      tab.url !== nextUrl ||
      tab.title !== nextTitle ||
      tab.isLoading !== runtime.webContents.isLoading() ||
      tab.canGoBack !== canGoBack(runtime.webContents) ||
      tab.canGoForward !== canGoForward(runtime.webContents) ||
      tab.zoomFactor !== zoomFactor ||
      tab.status !== "live" ||
      tab.lastCommittedUrl !== (nextUrl === BROWSER_BLANK_URL ? null : nextUrl) ||
      tab.lastError !== null;
    tab.url = nextUrl;
    tab.title = nextTitle;
    tab.isLoading = runtime.webContents.isLoading();
    tab.canGoBack = canGoBack(runtime.webContents);
    tab.canGoForward = canGoForward(runtime.webContents);
    tab.zoomFactor = zoomFactor;
    tab.status = "live";
    tab.lastCommittedUrl = nextUrl === BROWSER_BLANK_URL ? null : nextUrl;
    tab.lastError = null;
    if (state.activeTabId === tabId) state.lastError = null;
    if (changed) {
      this.changed(threadId);
      this.emitState(threadId);
    }
  }

  private async loadTab(threadId: string, tabId: string, url: string, force: boolean): Promise<void> {
    if (!isAllowedNavigation(url)) throw new Error("This browser only supports HTTP and HTTPS pages.");
    const runtime = this.ensureRuntime(threadId, tabId);
    const state = this.ensureWorkspace(threadId);
    const tab = this.resolveTab(state, tabId);
    if (!force && runtime.webContents.getURL() === url) {
      this.syncRuntimeState(threadId, tabId);
      return;
    }
    if (tab.url !== url) tab.faviconUrl = null;
    tab.url = url;
    tab.title = defaultTitle(url);
    tab.isLoading = true;
    tab.lastError = null;
    tab.status = "live";
    this.changed(threadId);
    this.emitState(threadId);
    try {
      await runtime.webContents.loadURL(url);
      this.syncRuntimeState(threadId, tabId);
    } catch (error) {
      if (error instanceof Error && /ERR_ABORTED|\(-3\)/i.test(error.message)) return;
      tab.isLoading = false;
      tab.lastError = error instanceof Error ? error.message.slice(0, 240) : "Could not open this page.";
      state.lastError = state.activeTabId === tabId ? tab.lastError : state.lastError;
      this.changed(threadId);
      this.emitState(threadId);
      throw error;
    }
  }

  private waitForRuntimeNavigation(threadId: string, tabId: string, webContents: WebContents): Promise<void> {
    return new Promise((resolvePromise) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        webContents.removeListener("did-navigate", finish);
        webContents.removeListener("did-navigate-in-page", finish);
        webContents.removeListener("did-stop-loading", finish);
        webContents.removeListener("did-fail-load", finish);
        this.syncRuntimeState(threadId, tabId);
        resolvePromise();
      };
      const timeout = setTimeout(finish, 15_000);
      webContents.once("did-navigate", finish);
      webContents.once("did-navigate-in-page", finish);
      webContents.once("did-stop-loading", finish);
      webContents.once("did-fail-load", finish);
    });
  }

  private runtimeFor(threadId: string, tabId: string): BrowserRuntime {
    const state = this.ensureWorkspace(threadId);
    this.resolveTab(state, tabId);
    return this.ensureRuntime(threadId, tabId);
  }

  private attachActiveRuntime(): void {
    if (!this.window || !this.activeThreadId || !this.activeBounds) return;
    const state = this.states.get(this.activeThreadId);
    const tab = state ? this.activeTab(state) : null;
    if (!state || !tab || !state.open) return;
    const runtime = this.ensureRuntime(this.activeThreadId, tab.id);
    if (this.attachedRuntimeKey === runtime.key) {
      runtime.view.setBounds(this.activeBounds);
      return;
    }
    this.detachAttachedRuntime();
    this.window.contentView.addChildView(runtime.view);
    runtime.view.setBounds(this.activeBounds);
    this.attachedRuntimeKey = runtime.key;
    const expectedUrl = normalizeUrl(tab.lastCommittedUrl ?? tab.url);
    if (runtime.webContents.getURL() !== expectedUrl) {
      void this.loadTab(this.activeThreadId, tab.id, expectedUrl, false).catch(() => undefined);
    }
  }

  private detachAttachedRuntime(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.attachedRuntimeKey = null;
      return;
    }
    for (const runtime of this.runtimes.values()) {
      try {
        this.window.contentView.removeChildView(runtime.view);
      } catch {
        // The view may already be detached.
      }
    }
    this.attachedRuntimeKey = null;
  }

  private destroyRuntime(threadId: string, tabId: string): void {
    const key = runtimeKey(threadId, tabId);
    const runtime = this.runtimes.get(key);
    if (!runtime) return;
    if (this.attachedRuntimeKey === key) this.attachedRuntimeKey = null;
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.contentView.removeChildView(runtime.view);
      } catch {
        // The view may already be detached.
      }
    }
    this.runtimes.delete(key);
    for (const usernameKey of this.observedUsernames.keys()) {
      if (usernameKey.startsWith(`${key}:`)) this.observedUsernames.delete(usernameKey);
    }
    for (const dispose of runtime.disposers.splice(0)) dispose();
    this.scheduleProfileFlush();
    if (!runtime.webContents.isDestroyed()) {
      try {
        runtime.webContents.close({ waitForBeforeUnload: false });
      } catch {
        // Electron can destroy the guest concurrently during shutdown.
      }
    }
  }
}

export type { ExpectedInput as BrowserExpectedInput };
