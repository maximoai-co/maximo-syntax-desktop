import { randomUUID } from "node:crypto";
import {
  app,
  BrowserWindow,
  WebContentsView,
  clipboard,
  nativeImage,
  session,
} from "electron";
import type { WebContents } from "electron";
import type {
  BrowserCopyLinkEvent,
  BrowserNewTabInput,
  BrowserOpenInput,
  BrowserPanelBounds,
  BrowserScreenshotResult,
  BrowserSetPanelBoundsInput,
  BrowserState,
  BrowserTabInput,
  BrowserTabState,
  BrowserThreadInput,
  BrowserNavigateInput,
} from "./types.js";
import { flushPersistentBrowserSession } from "./browser-session-persistence.js";
import { collapseDuplicateBrowserScheme } from "./browser-url.js";

export const BROWSER_SESSION_PARTITION = "persist:maximo-browser";
export const BROWSER_BLANK_URL = "about:blank";

type BrowserStateListener = (state: BrowserState) => void;
type HumanControlListener = () => void;

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
  };
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
  private readonly session = session.fromPartition(BROWSER_SESSION_PARTITION);
  private disposed = false;

  constructor(private readonly options: BrowserManagerOptions = {}) {
    const baseUserAgent = app.userAgentFallback || "";
    const userAgent = baseUserAgent.replace(/\sElectron\/\S+/gi, "").replace(/\s{2,}/g, " ").trim();
    if (userAgent) this.session.setUserAgent(userAgent);
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
    if (this.activeThreadId === input.threadId) this.detachAttachedRuntime();
    for (const tab of state.tabs) this.destroyRuntime(input.threadId, tab.id);
    state.open = false;
    state.activeTabId = null;
    state.tabs = [];
    state.lastError = null;
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
      state.activeTabId = input.tabId;
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

  flushPersistentStorage(): Promise<void> {
    return flushPersistentBrowserSession(this.session);
  }

  dispose(): void {
    this.disposed = true;
    this.detachAttachedRuntime();
    for (const runtime of [...this.runtimes.values()]) this.destroyRuntime(runtime.threadId, runtime.tabId);
    this.states.clear();
    this.listeners.clear();
    this.humanListeners.clear();
    this.expectedInputs.clear();
    this.window = null;
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
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
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
      if ((input.meta || input.control) && input.key.toLowerCase() === "l") {
        event.preventDefault();
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
    for (const event of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated", "page-favicon-updated"] as const) {
      (webContents.on as (eventName: string, listener: (...args: unknown[]) => void) => void)(event, sync);
      runtime.disposers.push(() => (webContents.removeListener as (eventName: string, listener: (...args: unknown[]) => void) => void)(event, sync));
    }
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
    const changed =
      tab.url !== nextUrl ||
      tab.title !== nextTitle ||
      tab.isLoading !== runtime.webContents.isLoading() ||
      tab.canGoBack !== canGoBack(runtime.webContents) ||
      tab.canGoForward !== canGoForward(runtime.webContents) ||
      tab.status !== "live" ||
      tab.lastCommittedUrl !== (nextUrl === BROWSER_BLANK_URL ? null : nextUrl) ||
      tab.lastError !== null;
    tab.url = nextUrl;
    tab.title = nextTitle;
    tab.isLoading = runtime.webContents.isLoading();
    tab.canGoBack = canGoBack(runtime.webContents);
    tab.canGoForward = canGoForward(runtime.webContents);
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
    for (const dispose of runtime.disposers.splice(0)) dispose();
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
