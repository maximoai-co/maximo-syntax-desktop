import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { WebContents } from "electron";
import type { BrowserState, BrowserTabState } from "./types.js";
import type { BrowserAutomationRuntime, BrowserManager } from "./browser-manager.js";
import { collapseDuplicateBrowserScheme } from "./browser-url.js";

export const BROWSER_TOOL_NAMES = [
  "browser_status",
  "browser_tabs",
  "browser_open",
  "browser_navigate",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_snapshot",
  "browser_screenshot",
  "browser_logs",
  "browser_click",
  "browser_hover",
  "browser_type",
  "browser_select",
  "browser_upload",
  "browser_press",
  "browser_scroll",
  "browser_wait",
  "browser_evaluate",
  "browser_close",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export interface BrowserHostCall {
  capability: string;
  sessionId: string;
  provider: string;
  threadId: string;
  name: BrowserToolName;
  arguments: Record<string, unknown>;
  workspaceRoot?: string;
  signal?: AbortSignal;
}

export class BrowserHostError extends Error {
  constructor(readonly code: "BrowserTimeout" | "BrowserInterruptedByHuman" | "BrowserActionFailed", message: string) {
    super(message);
    this.name = code;
  }
}

export interface BrowserAutomationHostOptions {
  onRequestOpenPanel?: (threadId: string) => void;
}

interface SessionAffinity {
  provider: string;
  threadId: string;
  tabId: string | null;
}

interface SnapshotRef {
  ref: string;
  selector: string;
  tabId: string;
  point: { x: number; y: number };
}

interface SnapshotRecord {
  snapshotId: string;
  threadId: string;
  tabId: string;
  epoch: number;
  refs: Map<string, SnapshotRef>;
}

interface CdpRuntime {
  readonly webContents: WebContents;
  readonly tabId: string;
  readonly threadId: string;
  readonly expectAgentInput: BrowserAutomationRuntime["expectAgentInput"];
}

const MAX_EVALUATE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_ELEMENTS = 250;
const AI_CURSOR_ID = "__maximo_syntax_ai_cursor__";
const AI_CURSOR_HIDE_DELAY_MS = 1_600;
const AI_CURSOR_LONG_ACTION_HIDE_DELAY_MS = 30_000;

const TOOL_DESCRIPTIONS: Record<BrowserToolName, string> = {
  browser_status: "Check whether the Maximo in-app browser is available.",
  browser_tabs: "List the browser tabs in the current Maximo chat.",
  browser_open: "Open a URL in the shared Maximo browser, optionally reusing the current tab.",
  browser_navigate: "Navigate a browser tab to an HTTP or HTTPS URL.",
  browser_back: "Go back in the selected browser tab history.",
  browser_forward: "Go forward in the selected browser tab history.",
  browser_reload: "Reload the selected browser tab.",
  browser_snapshot: "Read a bounded semantic snapshot of visible browser controls and text.",
  browser_screenshot: "Capture a PNG screenshot of the current browser page.",
  browser_logs: "Read bounded browser diagnostics. Console and network collection is best effort.",
  browser_click: "Click a browser element by snapshot ref, CSS selector, or viewport point.",
  browser_hover: "Move the pointer over a browser element or viewport point.",
  browser_type: "Focus an editable browser element and insert literal text.",
  browser_select: "Select one or more option values in a browser select element.",
  browser_upload: "Upload workspace-relative files into a browser file input.",
  browser_press: "Press one or more page key chords such as Enter or Control+A.",
  browser_scroll: "Scroll the page or a browser scroll container.",
  browser_wait: "Wait for a bounded browser condition such as text, URL, selector, or delay.",
  browser_evaluate: "Evaluate a bounded page expression and return JSON-serializable data.",
  browser_close: "Close a browser tab.",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isBrowserToolName(value: string): value is BrowserToolName {
  return (BROWSER_TOOL_NAMES as readonly string[]).includes(value);
}

function normalizeUrl(value: string): string {
  const trimmed = collapseDuplicateBrowserScheme(value);
  if (trimmed === "about:blank") return trimmed;
  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Browser navigation only supports HTTP and HTTPS URLs.");
  return url.toString();
}

function tabSummary(tab: BrowserTabState, active: boolean) {
  return {
    tabId: tab.id,
    title: tab.title,
    url: tab.lastCommittedUrl ?? tab.url,
    active,
    loading: tab.isLoading,
    state: tab.status === "error" ? "error" : tab.status === "live" ? "live" : "suspended",
  };
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Browser action cancelled.");
}

async function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolvePromise, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("Browser action cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolvePromise(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function cdpCommand<T = Record<string, unknown>>(
  runtime: CdpRuntime,
  method: string,
  params: Record<string, unknown> = {},
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const debuggerSession = runtime.webContents.debugger;
  if (!debuggerSession.isAttached()) debuggerSession.attach("1.3");
  return raceAbort(debuggerSession.sendCommand(method, params) as Promise<T>, signal);
}

async function evaluatePage<T>(runtime: CdpRuntime, expression: string, signal: AbortSignal): Promise<T> {
  const result = await cdpCommand<{
    exceptionDetails?: { text?: string };
    result: { value?: T; description?: string; type?: string };
  }>(runtime, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, signal);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "The browser expression failed.");
  if (result.result?.type === "undefined") return undefined as T;
  return result.result?.value as T;
}

async function renderAutomationCursor(
  runtime: CdpRuntime,
  point: { x: number; y: number },
  label: string,
  pulse: boolean,
  signal: AbortSignal,
): Promise<void> {
  const x = Math.max(0, Math.min(100_000, Math.round(point.x)));
  const y = Math.max(0, Math.min(100_000, Math.round(point.y)));
  await evaluatePage(runtime, `(function(){
    const id=${JSON.stringify(AI_CURSOR_ID)};
    let host=document.getElementById(id);
    if(!host){
      host=document.createElement("div");
      host.id=id;
      host.setAttribute("aria-hidden","true");
      host.style.cssText="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;transition:left .22s cubic-bezier(.22,1,.36,1),top .22s cubic-bezier(.22,1,.36,1),opacity .16s ease;";
      const root=host.attachShadow({mode:"open"});
      root.innerHTML=\`<style>
        :host{display:block;width:190px;height:58px;overflow:visible;}
        .wrap{position:relative;width:100%;height:100%;}
        .halo{position:absolute;left:-7px;top:-7px;width:30px;height:30px;border:1px solid rgba(101,235,211,.7);border-radius:50%;box-shadow:0 0 8px rgba(55,215,187,.78),0 0 22px rgba(55,215,187,.45);opacity:.8;}
        .halo.pulse{animation:maximo-ai-cursor-pulse .58s ease-out 1;}
        .pointer{position:absolute;left:0;top:0;width:23px;height:27px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6)) drop-shadow(0 0 7px rgba(55,215,187,.86));}
        .badge{position:absolute;left:22px;top:21px;max-width:160px;padding:4px 8px;border:1px solid rgba(101,235,211,.55);border-radius:999px;background:rgba(11,25,26,.9);box-shadow:0 4px 16px rgba(0,0,0,.3),0 0 12px rgba(55,215,187,.22);color:#d9fff5;font:600 10px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        @keyframes maximo-ai-cursor-pulse{0%{transform:scale(.65);opacity:.15}45%{transform:scale(1.2);opacity:1}100%{transform:scale(1);opacity:.8}}
      </style><div class="wrap"><div class="halo"></div><svg class="pointer" viewBox="0 0 24 28" aria-hidden="true"><path d="M3 2v22l6-5.8 3.7 8 4-1.9-3.8-8H22L3 2Z" fill="#79ecd6" stroke="#062d2a" stroke-width="1.6" stroke-linejoin="round"/></svg><div class="badge"></div></div>\`;
      (document.body||document.documentElement).appendChild(host);
    }
    const root=host.shadowRoot;
    const badge=root&&root.querySelector(".badge");
    const halo=root&&root.querySelector(".halo");
    if(badge) badge.textContent=${JSON.stringify(label)};
    host.style.left=${x}+"px";
    host.style.top=${y}+"px";
    host.style.opacity="1";
    if(halo&&${pulse ? "true" : "false"}){halo.classList.remove("pulse");void halo.offsetWidth;halo.classList.add("pulse");}
  })()`, signal);
}

async function removeAutomationCursor(runtime: CdpRuntime): Promise<void> {
  try {
    await evaluatePage(runtime, `(document.getElementById(${JSON.stringify(AI_CURSOR_ID)})||{}).remove?.()`, new AbortController().signal);
  } catch {
    // Page teardown and navigation can remove the indicator before cleanup runs.
  }
}

function targetRecord(input: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(input.target);
  return nested ?? input;
}

function selectorForTarget(
  input: Record<string, unknown>,
  snapshot: SnapshotRecord | undefined,
  tabId: string,
): string | null {
  const target = targetRecord(input);
  const ref = asString(target.ref);
  if (ref && snapshot?.tabId === tabId) {
    return snapshot.refs.get(ref)?.selector ?? null;
  }
  const selector = asString(target.selector);
  if (!selector || selector.startsWith("javascript:")) return null;
  return selector.slice(0, 2_000);
}

function pointForTarget(input: Record<string, unknown>, snapshot: SnapshotRecord | undefined, tabId: string): { x: number; y: number } | null {
  const target = targetRecord(input);
  const point = asRecord(target.point);
  if (point && typeof point.x === "number" && typeof point.y === "number") return { x: point.x, y: point.y };
  const ref = asString(target.ref);
  if (ref && snapshot?.tabId === tabId) {
    const entry = snapshot.refs.get(ref);
    if (entry) return entry.point;
  }
  if (typeof target.x === "number" && typeof target.y === "number") return { x: target.x, y: target.y };
  return null;
}

function modifiersForKey(key: string): number {
  return key.split("+").slice(0, -1).reduce((value, modifier) => {
    const normalized = modifier.toLowerCase();
    if (normalized === "alt" || normalized === "option") return value | 1;
    if (normalized === "control" || normalized === "ctrl") return value | 2;
    if (normalized === "meta" || normalized === "command" || normalized === "cmd") return value | 4;
    if (normalized === "shift") return value | 8;
    return value;
  }, 0);
}

function baseKey(key: string): string {
  const value = key.split("+").at(-1) ?? key;
  const aliases: Record<string, string> = {
    esc: "Escape",
    escape: "Escape",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    space: " ",
    arrowup: "ArrowUp",
    arrowdown: "ArrowDown",
    arrowleft: "ArrowLeft",
    arrowright: "ArrowRight",
  };
  return aliases[value.toLowerCase()] ?? (value.length === 1 ? value : value);
}

function keyCode(key: string): string {
  if (key.length === 1 && /[a-z]/i.test(key)) return `Key${key.toUpperCase()}`;
  if (key.length === 1 && /[0-9]/.test(key)) return `Digit${key}`;
  return key;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Browser action cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    timer.unref?.();
  });
}

function safeWorkspacePath(root: string, requested: string): Promise<string> {
  if (!isAbsolute(root) || !requested || isAbsolute(requested) || requested.split(/[\\/]/u).includes("..")) {
    return Promise.reject(new Error("Browser uploads require a workspace-relative file path."));
  }
  const workspace = resolve(root);
  const candidate = resolve(workspace, requested);
  const relativePath = relative(workspace, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return Promise.reject(new Error("The upload path is outside the workspace."));
  return Promise.all([realpath(workspace), realpath(candidate), stat(candidate)]).then(([realWorkspace, realCandidate, details]) => {
    const realRelative = relative(realWorkspace, realCandidate);
    if (realRelative.startsWith("..") || isAbsolute(realRelative) || !details.isFile()) throw new Error("The upload path is not a workspace file.");
    return realCandidate;
  });
}

const SNAPSHOT_SCRIPT = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const selector = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 7) {
      let part = current.tagName.toLowerCase();
      if (current.classList.length) part += "." + Array.from(current.classList).slice(0, 2).map(CSS.escape).join(".");
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };
  const roleFor = (element) => element.getAttribute("role") || ({button:"button",a:"link",input:"textbox",textarea:"textbox",select:"combobox",option:"option"}[element.tagName.toLowerCase()] || "generic");
  const nameFor = (element) => (element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("placeholder") || element.innerText || element.value || "").replace(/\\s+/g, " ").trim().slice(0, 240);
  const nodes = Array.from(document.querySelectorAll("a,button,input,textarea,select,option,[role],summary,[contenteditable=true]"));
  const elements = nodes.filter(visible).slice(0, ${MAX_SNAPSHOT_ELEMENTS}).map((element, index) => {
    const rect = element.getBoundingClientRect();
    const states = [];
    if (element.disabled) states.push("disabled");
    if (element.checked) states.push("checked");
    if (document.activeElement === element) states.push("focused");
    if (element.readOnly) states.push("readonly");
    return { ref: "e" + (index + 1), selector: selector(element), role: roleFor(element), name: nameFor(element), value: typeof element.value === "string" ? element.value.slice(0, 240) : undefined, bounds: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}, states };
  });
  return { elements, visibleText: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 131072), url: location.href, title: document.title || location.hostname };
})()`;

export function browserToolDefinitions(): Array<Record<string, unknown>> {
  const target = {
    type: "object",
    properties: {
      ref: { type: "string", description: "Element ref from the latest browser_snapshot." },
      selector: { type: "string", description: "A CSS selector for one element." },
      point: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
    },
    additionalProperties: false,
  };
  return BROWSER_TOOL_NAMES.map((name) => {
    let inputSchema: Record<string, unknown> = { type: "object", additionalProperties: true };
    if (name === "browser_open") inputSchema = { type: "object", properties: { url: { type: "string" }, show: { type: "boolean" }, reuse: { type: "boolean" } }, additionalProperties: false };
    if (name === "browser_navigate") inputSchema = { type: "object", properties: { tabId: { type: "string" }, url: { type: "string" } }, required: ["url"], additionalProperties: false };
    if (["browser_back", "browser_forward", "browser_reload", "browser_close"].includes(name)) inputSchema = { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false };
    if (["browser_click", "browser_hover", "browser_type", "browser_select", "browser_scroll"].includes(name)) inputSchema = { type: "object", properties: { target, text: { type: "string" }, append: { type: "boolean" }, values: { type: "array", items: { type: "string" } }, direction: { type: "string" }, deltaX: { type: "number" }, deltaY: { type: "number" }, tabId: { type: "string" } }, additionalProperties: true };
    if (name === "browser_press") inputSchema = { type: "object", properties: { keys: { type: "array", items: { type: "string" } }, key: { type: "string" }, tabId: { type: "string" } }, additionalProperties: false };
    if (name === "browser_snapshot") inputSchema = { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false };
    if (name === "browser_screenshot") inputSchema = { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false };
    if (name === "browser_evaluate") inputSchema = { type: "object", properties: { expression: { type: "string" }, tabId: { type: "string" } }, required: ["expression"], additionalProperties: false };
    if (name === "browser_wait") inputSchema = { type: "object", properties: { tabId: { type: "string" }, timeoutMs: { type: "number" }, timeMs: { type: "number" }, conditions: { type: "array", items: { type: "object" } } }, additionalProperties: false };
    if (name === "browser_upload") inputSchema = { type: "object", properties: { tabId: { type: "string" }, target, paths: { type: "array", items: { type: "string" } } }, required: ["paths"], additionalProperties: false };
    const readOnly = ["browser_status", "browser_tabs", "browser_snapshot", "browser_screenshot", "browser_logs", "browser_wait", "browser_evaluate"].includes(name);
    return {
      name,
      description: `${TOOL_DESCRIPTIONS[name]} Use this Maximo browser tool directly when the user asks you to browse or interact with a website; do not wait for the user to name the tool.`,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: false,
        openWorldHint: true,
      },
    };
  });
}

export class BrowserAutomationHost {
  private readonly affinities = new Map<string, SessionAffinity>();
  private readonly snapshots = new Map<string, SnapshotRecord>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cursorHideTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cursorRuntimes = new Map<string, CdpRuntime>();

  constructor(private readonly manager: BrowserManager, private readonly options: BrowserAutomationHostOptions = {}) {}

  async execute(call: BrowserHostCall): Promise<unknown> {
    if (!call.capability) throw new Error("Browser authorization is required.");
    if (!isBrowserToolName(call.name)) throw new Error("Unknown browser tool.");
    const affinity = this.bindSession(call);
    if (call.name === "browser_status") return this.status();
    if (call.name === "browser_tabs") return this.tabs(call.threadId, affinity);

    const controller = new AbortController();
    const timeoutMs = Math.min(Math.max(Number(call.arguments.timeoutMs) || 30_000, 100), 30_000);
    const timer = setTimeout(() => controller.abort(new BrowserHostError("BrowserTimeout", "Browser action timed out.")), timeoutMs);
    const abortFromCaller = () => controller.abort(call.signal?.reason ?? new BrowserHostError("BrowserActionFailed", "Browser action cancelled."));
    call.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const unsubscribe = this.manager.subscribeHumanControl(call.threadId, () => {
      controller.abort(new BrowserHostError("BrowserInterruptedByHuman", "Browser action interrupted by human control."));
      void this.clearAutomationCursors(call.threadId);
    });
    try {
      return await this.withLock(`session:${call.sessionId}`, () => this.dispatch(call, affinity, controller.signal), controller.signal);
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", abortFromCaller);
      unsubscribe();
    }
  }

  private bindSession(call: BrowserHostCall): SessionAffinity {
    const existing = this.affinities.get(call.sessionId);
    if (existing) {
      if (existing.provider !== call.provider || existing.threadId !== call.threadId) throw new Error("Browser session scope does not match this chat.");
      return existing;
    }
    const affinity = { provider: call.provider, threadId: call.threadId, tabId: null };
    this.affinities.set(call.sessionId, affinity);
    return affinity;
  }

  private async withLock<T>(key: string, action: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const chain = previous.then(() => tail);
    this.locks.set(key, chain);
    try {
      await raceAbort(previous, signal);
      return await action();
    } finally {
      release();
      void chain.finally(() => {
        if (this.locks.get(key) === chain) this.locks.delete(key);
      });
    }
  }

  private status() {
    return {
      available: true,
      physicalScope: "visible-shared-electron-webview",
      authorization: "granted",
    };
  }

  private tabs(threadId: string, affinity: SessionAffinity) {
    const state = this.manager.getState({ threadId });
    return {
      tabs: state.tabs.map((tab) => tabSummary(tab, tab.id === state.activeTabId)),
      activeTabId: state.activeTabId,
      assignedTabId: affinity.tabId,
    };
  }

  private async dispatch(call: BrowserHostCall, affinity: SessionAffinity, signal: AbortSignal): Promise<unknown> {
    const input = call.arguments;
    if (call.name === "browser_open") {
      const url = input.url === undefined ? undefined : normalizeUrl(String(input.url));
      const state = await this.manager.automationOpen(call.threadId, url, input.reuse !== false);
      affinity.tabId = state.activeTabId;
      if (input.show !== false) this.options.onRequestOpenPanel?.(call.threadId);
      if (state.activeTabId) {
        const runtime = await this.manager.getAutomationRuntime(call.threadId, state.activeTabId);
        await this.showAutomationCursor(runtime, { x: 28, y: 28 }, "Maximo is navigating", signal);
      }
      return this.navigationOutput(state, state.activeTabId, "created");
    }

    const tabId = this.resolveTabId(call.threadId, affinity, input.tabId);
    if (call.name === "browser_navigate") {
      const state = await this.manager.automationNavigate(call.threadId, tabId, normalizeUrl(String(input.url)));
      affinity.tabId = tabId;
      if (input.show !== false) this.options.onRequestOpenPanel?.(call.threadId);
      const runtime = await this.manager.getAutomationRuntime(call.threadId, tabId);
      await this.showAutomationCursor(runtime, { x: 28, y: 28 }, "Maximo is navigating", signal);
      return this.navigationOutput(state, tabId, "reused");
    }
    if (call.name === "browser_back" || call.name === "browser_forward" || call.name === "browser_reload") {
      const direction = call.name === "browser_back" ? "back" : call.name === "browser_forward" ? "forward" : "reload";
      const runtime = await this.manager.getAutomationRuntime(call.threadId, tabId);
      await this.showAutomationCursor(runtime, { x: 28, y: 28 }, `Maximo is going ${direction}`, signal);
      const state = await this.manager.automationHistory({ threadId: call.threadId, tabId }, direction);
      await this.showAutomationCursor(runtime, { x: 28, y: 28 }, `Maximo finished ${direction}`, signal);
      return this.navigationOutput(state, tabId, "reused");
    }
    if (call.name === "browser_close") {
      await this.clearAutomationCursors(call.threadId);
      const state = await this.manager.automationCloseTab({ threadId: call.threadId, tabId });
      if (affinity.tabId === tabId) affinity.tabId = state.activeTabId;
      return { closedTabId: tabId, activeTabId: state.activeTabId };
    }

    const runtime = await this.manager.getAutomationRuntime(call.threadId, tabId);
    const cdpRuntime: CdpRuntime = runtime;
    this.cursorRuntimes.set(this.cursorKey(cdpRuntime), cdpRuntime);
    const cursorPoint = await this.resolveCursorPoint(call.sessionId, cdpRuntime, input, signal);
    await this.showAutomationCursor(cdpRuntime, cursorPoint, this.cursorLabel(call.name), signal, false, call.name === "browser_wait");
    if (call.name === "browser_snapshot") return this.snapshot(call.sessionId, cdpRuntime, signal);
    if (call.name === "browser_screenshot") return this.screenshot(cdpRuntime, signal);
    if (call.name === "browser_logs") return { tabId, entries: [], droppedCount: 0, truncated: false };
    if (call.name === "browser_evaluate") return this.evaluate(cdpRuntime, String(input.expression ?? ""), signal);
    if (call.name === "browser_click") return this.click(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_hover") return this.hover(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_type") return this.type(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_select") return this.select(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_press") return this.press(cdpRuntime, input, signal);
    if (call.name === "browser_scroll") return this.scroll(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_wait") return this.waitFor(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_upload") return this.upload(cdpRuntime, input, call.workspaceRoot, signal);
    throw new Error(`Browser tool ${call.name} is not implemented.`);
  }

  private resolveTabId(threadId: string, affinity: SessionAffinity, requested: unknown): string {
    const state = this.manager.getState({ threadId });
    const tabId = asString(requested) ?? affinity.tabId ?? state.activeTabId;
    if (!tabId || !state.tabs.some((tab) => tab.id === tabId)) throw new Error("The requested browser tab does not exist.");
    affinity.tabId = tabId;
    return tabId;
  }

  private navigationOutput(state: BrowserState, tabId: string | null, disposition: "created" | "reused") {
    const tab = tabId ? state.tabs.find((candidate) => candidate.id === tabId) : null;
    return {
      tabId: tab?.id ?? state.activeTabId,
      finalUrl: tab?.lastCommittedUrl ?? tab?.url ?? "about:blank",
      redirects: [],
      loadState: tab?.isLoading ? "loading" : "complete",
      disposition,
    };
  }

  private cursorKey(runtime: CdpRuntime): string {
    return `${runtime.threadId}:${runtime.tabId}`;
  }

  private cursorLabel(name: BrowserToolName): string {
    switch (name) {
      case "browser_snapshot": return "Maximo is reading";
      case "browser_screenshot": return "Maximo is capturing";
      case "browser_click": return "Maximo is clicking";
      case "browser_type": return "Maximo is typing";
      case "browser_press": return "Maximo is pressing a key";
      case "browser_scroll": return "Maximo is scrolling";
      case "browser_wait": return "Maximo is waiting";
      case "browser_evaluate": return "Maximo is inspecting";
      default: return "Maximo is working";
    }
  }

  private async resolveCursorPoint(
    sessionId: string,
    runtime: CdpRuntime,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ x: number; y: number }> {
    const snapshot = this.snapshotFor(sessionId, runtime.tabId);
    const directPoint = pointForTarget(input, snapshot, runtime.tabId);
    if (directPoint) return directPoint;
    const selector = selectorForTarget(input, snapshot, runtime.tabId);
    if (selector) {
      const point = await evaluatePage<{ x: number; y: number }>(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("Element not found");const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`, signal).catch(() => null);
      if (point) return point;
    }
    return evaluatePage<{ x: number; y: number }>(runtime, "({x:Math.max(24,innerWidth*.5),y:Math.max(28,innerHeight*.18)})", signal).catch(() => ({ x: 28, y: 28 }));
  }

  private async showAutomationCursor(
    runtime: CdpRuntime,
    point: { x: number; y: number },
    label: string,
    signal: AbortSignal,
    pulse = false,
    keepVisible = false,
  ): Promise<void> {
    const key = this.cursorKey(runtime);
    const previousTimer = this.cursorHideTimers.get(key);
    if (previousTimer) clearTimeout(previousTimer);
    this.cursorHideTimers.delete(key);
    this.cursorRuntimes.set(key, runtime);
    await renderAutomationCursor(runtime, point, label, pulse, signal).catch(() => undefined);
    const timer = setTimeout(() => {
      this.cursorHideTimers.delete(key);
      this.cursorRuntimes.delete(key);
      void removeAutomationCursor(runtime);
    }, keepVisible ? AI_CURSOR_LONG_ACTION_HIDE_DELAY_MS : AI_CURSOR_HIDE_DELAY_MS);
    timer.unref?.();
    this.cursorHideTimers.set(key, timer);
  }

  private async clearAutomationCursors(threadId: string): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [key, runtime] of this.cursorRuntimes) {
      if (runtime.threadId !== threadId) continue;
      const timer = this.cursorHideTimers.get(key);
      if (timer) clearTimeout(timer);
      this.cursorHideTimers.delete(key);
      this.cursorRuntimes.delete(key);
      pending.push(removeAutomationCursor(runtime));
    }
    await Promise.all(pending);
  }

  private async snapshot(sessionId: string, runtime: CdpRuntime, signal: AbortSignal) {
    const raw = await evaluatePage<{
      elements: Array<{ ref: string; selector: string; role: string; name: string; value?: string; bounds: { x: number; y: number; width: number; height: number }; states: string[] }>;
      visibleText: string;
      url: string;
      title: string;
    }>(runtime, SNAPSHOT_SCRIPT, signal);
    const snapshotId = randomUUID();
    const refs = new Map<string, SnapshotRef>();
    const elements = raw.elements.slice(0, MAX_SNAPSHOT_ELEMENTS).map((element) => {
      refs.set(element.ref, {
        ref: element.ref,
        selector: element.selector,
        tabId: runtime.tabId,
        point: {
          x: element.bounds.x + element.bounds.width / 2,
          y: element.bounds.y + element.bounds.height / 2,
        },
      });
      const { selector: _selector, ...publicElement } = element;
      return publicElement;
    });
    this.snapshots.set(sessionId, {
      snapshotId,
      threadId: runtime.threadId,
      tabId: runtime.tabId,
      epoch: this.manager.getHumanControlEpoch(runtime.threadId),
      refs,
    });
    return {
      snapshotId,
      tabId: runtime.tabId,
      url: raw.url,
      title: raw.title,
      capturedAt: new Date().toISOString(),
      semanticSource: "bounded-dom",
      elements,
      visibleText: raw.visibleText.slice(0, 131_072),
      diagnostics: [],
      truncationReasons: raw.elements.length > MAX_SNAPSHOT_ELEMENTS ? ["element-limit"] : [],
    };
  }

  private async screenshot(runtime: CdpRuntime, signal: AbortSignal) {
    throwIfAborted(signal);
    const metrics: {
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
      cssContentSize?: { width?: number; height?: number };
    } = await cdpCommand(runtime, "Page.getLayoutMetrics", {}, signal).catch(() => ({}));
    const image = (await runtime.webContents.capturePage()).toPNG();
    if (image.byteLength > 8 * 1024 * 1024) throw new Error("The browser screenshot is too large.");
    const width = Math.max(1, Math.round(metrics.cssVisualViewport?.clientWidth ?? metrics.cssContentSize?.width ?? 1));
    const height = Math.max(1, Math.round(metrics.cssVisualViewport?.clientHeight ?? metrics.cssContentSize?.height ?? 1));
    return {
      tabId: runtime.tabId,
      url: runtime.webContents.getURL(),
      capturedAt: new Date().toISOString(),
      mode: "viewport",
      clipped: false,
      image: { mimeType: "image/png", width, height, byteLength: image.byteLength, data: image.toString("base64") },
    };
  }

  private snapshotFor(sessionId: string, tabId: string): SnapshotRecord | undefined {
    const snapshot = this.snapshots.get(sessionId);
    return snapshot?.tabId === tabId && snapshot.epoch === this.manager.getHumanControlEpoch(snapshot.threadId) ? snapshot : undefined;
  }

  private async click(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const snapshot = this.snapshotFor(sessionId, runtime.tabId);
    const point = pointForTarget(input, snapshot, runtime.tabId);
    if (point) {
      const release = runtime.expectAgentInput({ kind: "mouse", type: "mouseDown", x: point.x, y: point.y, button: "left" });
      try {
        await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, signal);
        await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, signal);
      } finally {
        release();
      }
    } else {
      const selector = selectorForTarget(input, snapshot, runtime.tabId);
      if (!selector) throw new Error("Click requires a snapshot ref, CSS selector, or point.");
      await evaluatePage(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("Element not found");e.scrollIntoView({block:"center",inline:"center"});e.click();return true})()`, signal);
    }
    await this.showAutomationCursor(runtime, point ?? await this.resolveCursorPoint(sessionId, runtime, input, signal), "Maximo clicked", signal, true);
    return { tabId: runtime.tabId, target: {}, point: point ?? { x: 0, y: 0 } };
  }

  private async hover(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const point = pointForTarget(input, this.snapshotFor(sessionId, runtime.tabId), runtime.tabId);
    if (!point) throw new Error("Hover requires a point or a snapshot ref with bounds.");
    await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y }, signal);
    return { tabId: runtime.tabId, point };
  }

  private async type(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const selector = selectorForTarget(input, this.snapshotFor(sessionId, runtime.tabId), runtime.tabId);
    if (!selector) throw new Error("Type requires a snapshot ref or CSS selector.");
    const text = String(input.text ?? "");
    if (text.length > 65_536) throw new Error("Typed browser text is too long.");
    await evaluatePage(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("Element not found");e.focus();${input.append === true ? "" : "if(\"value\" in e)e.value=\"\";"}return true})()`, signal);
    await cdpCommand(runtime, "Input.insertText", { text }, signal);
    return { tabId: runtime.tabId, resultingValue: { kind: "text", length: text.length, value: text.slice(0, 4_096) } };
  }

  private async select(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const selector = selectorForTarget(input, this.snapshotFor(sessionId, runtime.tabId), runtime.tabId);
    const values = Array.isArray(input.values) ? input.values.filter((value): value is string => typeof value === "string").slice(0, 64) : [];
    if (!selector || values.length === 0) throw new Error("Select requires a target and values.");
    return evaluatePage(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.tagName.toLowerCase()!=="select")throw new Error("Select element not found");const wanted=${JSON.stringify(values)};for(const o of e.options)o.selected=wanted.includes(o.value);e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return {tabId:${JSON.stringify(runtime.tabId)},selectedValues:Array.from(e.selectedOptions).map(o=>o.value)}})()`, signal);
  }

  private async press(runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const rawKeys = Array.isArray(input.keys) && input.keys.length > 0
      ? input.keys
      : typeof input.key === "string"
        ? [input.key]
        : [];
    if (rawKeys.length === 0) throw new Error("Press requires at least one key.");
    for (const raw of rawKeys) {
      const chord = String(raw);
      const key = baseKey(chord);
      const modifiers = modifiersForKey(chord);
      const release = runtime.expectAgentInput({ kind: "key", key, alt: Boolean(modifiers & 1), control: Boolean(modifiers & 2), meta: Boolean(modifiers & 4), shift: Boolean(modifiers & 8) });
      try {
        await cdpCommand(runtime, "Input.dispatchKeyEvent", { type: "keyDown", key, code: keyCode(key), modifiers, ...(key.length === 1 ? { text: key } : {}) }, signal);
        await cdpCommand(runtime, "Input.dispatchKeyEvent", { type: "keyUp", key, code: keyCode(key), modifiers }, signal);
      } finally {
        release();
      }
    }
    return { tabId: runtime.tabId, emitted: rawKeys.map(String), modifiersReleased: true };
  }

  private async scroll(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const selector = selectorForTarget(input, this.snapshotFor(sessionId, runtime.tabId), runtime.tabId);
    const mode = String(input.mode ?? (input.direction ? "direction" : "pixels"));
    const direction = String(input.direction ?? "down");
    const amount = Math.min(Math.max(Number(input.amount) || 600, 1), 100_000);
    const deltaX = typeof input.deltaX === "number" ? input.deltaX : 0;
    const deltaY = typeof input.deltaY === "number" ? input.deltaY : 0;
    const pagesX = typeof input.pagesX === "number" ? input.pagesX : 0;
    const pagesY = typeof input.pagesY === "number" ? input.pagesY : 0;
    const expression = `(function(){
      const target=${selector ? `document.querySelector(${JSON.stringify(selector)})` : "null"};
      if (${selector ? "!target" : "false"}) throw new Error("Scroll target not found");
      const viewport=target||document.scrollingElement||document.documentElement;
      const before={x:target?target.scrollLeft:window.scrollX,y:target?target.scrollTop:window.scrollY};
      const mode=${JSON.stringify(mode)};
      const direction=${JSON.stringify(direction)};
      const amount=${amount};
      let dx=${deltaX};
      let dy=${deltaY};
      if(mode==="pages") { dx=${pagesX}*(target?target.clientWidth:window.innerWidth); dy=${pagesY}*(target?target.clientHeight:window.innerHeight); }
      if(mode==="direction") { dx=direction==="left"?-amount:direction==="right"?amount:0; dy=direction==="up"||direction==="start"?-amount:direction==="down"||direction==="end"?amount:0; }
      const options={left:dx,top:dy,behavior:"instant"};
      if(target) target.scrollBy(options); else window.scrollBy(options);
      const after={x:target?target.scrollLeft:window.scrollX,y:target?target.scrollTop:window.scrollY};
      const maxX=Math.max(0,viewport.scrollWidth-viewport.clientWidth);
      const maxY=Math.max(0,viewport.scrollHeight-viewport.clientHeight);
      return {tabId:${JSON.stringify(runtime.tabId)},before,after,reachedBoundary:{top:after.y<=0,right:after.x>=maxX,bottom:after.y>=maxY,left:after.x<=0}};
    })()`;
    return evaluatePage(runtime, expression, signal);
  }

  private async waitFor(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const timeout = Math.min(Math.max(Number(input.timeoutMs) || Number(input.timeMs) || 5_000, 100), 30_000);
    const deadline = Date.now() + timeout;
    const startedAt = Date.now();
    const conditions = Array.isArray(input.conditions) ? input.conditions : [];
    if (conditions.length === 0 && Number(input.timeMs) > 0) {
      await wait(Math.min(Number(input.timeMs), 29_000), signal);
      return { tabId: runtime.tabId, satisfiedConditionIndexes: [0], observed: { url: runtime.webContents.getURL(), loadState: "complete" } };
    }
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const results = await Promise.all(conditions.map(async (condition) => {
        const item = asRecord(condition) ?? {};
        if (item.kind === "delay") {
          const delayMs = Math.min(Math.max(Number(item.timeMs) || 1, 1), 29_000);
          return Date.now() - startedAt >= delayMs;
        }
        if (item.kind === "url") return runtime.webContents.getURL() === String(item.exact ?? "");
        if (item.kind === "text") {
          const text = await evaluatePage<string>(runtime, `(document.body?.innerText||"").includes(${JSON.stringify(String(item.text ?? ""))})`, signal);
          return item.state === "absent" ? !text : Boolean(text);
        }
        if (item.kind === "selector" || item.kind === "target") {
          return evaluatePage<boolean>(runtime, `Boolean(document.querySelector(${JSON.stringify(String(item.selector ?? item.ref ?? ""))}))`, signal);
        }
        return false;
      }));
      if (results.length > 0 && (input.mode === "any" ? results.some(Boolean) : results.every(Boolean))) {
        return { tabId: runtime.tabId, satisfiedConditionIndexes: results.flatMap((value, index) => value ? [index] : []), observed: { url: runtime.webContents.getURL(), loadState: "complete" } };
      }
      await wait(100, signal);
    }
    throw new Error("Browser wait timed out.");
  }

  private async evaluate(runtime: CdpRuntime, expression: string, signal: AbortSignal) {
    if (!expression.trim() || expression.length > 16_384) throw new Error("Browser expression is empty or too long.");
    if (/\b(?:require|process|child_process|ipcRenderer|webContents)\b/u.test(expression)) throw new Error("That browser expression uses a restricted host API.");
    const value = await evaluatePage(runtime, expression, signal);
    if (jsonSize(value) > MAX_EVALUATE_BYTES) throw new Error("Browser evaluation returned too much data.");
    return { tabId: runtime.tabId, value, serializedByteCount: jsonSize(value) };
  }

  private async upload(runtime: CdpRuntime, input: Record<string, unknown>, workspaceRoot: string | undefined, signal: AbortSignal) {
    if (!workspaceRoot) throw new Error("The browser upload workspace is unavailable.");
    const selector = selectorForTarget(input, undefined, runtime.tabId);
    const paths = Array.isArray(input.paths) ? input.paths.filter((path): path is string => typeof path === "string").slice(0, 32) : [];
    if (!selector || paths.length === 0) throw new Error("Upload requires a file input target and paths.");
    const files = await Promise.all(paths.map((path) => safeWorkspacePath(workspaceRoot, path)));
    const document = await cdpCommand<{ root: { nodeId: number } }>(runtime, "DOM.getDocument", { depth: 0 }, signal);
    const node = await cdpCommand<{ nodeId: number }>(runtime, "DOM.querySelector", { nodeId: document.root.nodeId, selector }, signal);
    await cdpCommand(runtime, "DOM.setFileInputFiles", { nodeId: node.nodeId, files }, signal);
    return { tabId: runtime.tabId, files: files.map((path) => ({ name: path.split(/[\\/]/u).at(-1) ?? path, byteLength: 0 })) };
  }
}
