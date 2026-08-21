import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { WebContents } from "electron";
import type { BrowserState, BrowserTabState } from "./types.js";
import type { BrowserAutomationRuntime, BrowserManager } from "./browser-manager.js";
import { collapseDuplicateBrowserScheme } from "./browser-url.js";
import {
  PANEL_DEFAULT_STATE,
  TabEmulationController,
  resolveResizeRequest,
} from "./browser-emulation.js";
import {
  BrowserDiagnosticsStore,
  attachDialogHandling,
  dismissCookieBanners,
  humanKeyDelayMs,
  humanizedPath,
} from "./browser-stealth.js";

export const BROWSER_TOOL_NAMES = [
  "browser_status",
  "browser_tabs",
  "browser_open",
  "browser_navigate",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_resize",
  "browser_snapshot",
  "browser_screenshot",
  "browser_logs",
  "browser_click",
  "browser_hover",
  "browser_drag",
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
  browser_resize: "Resize the page view: desktop, laptop, tablet, or mobile presets (with touch + mobile emulation), custom width/height, orientation, or reset to panel.",
  browser_snapshot: "Read a bounded semantic snapshot of visible browser controls and text.",
  browser_screenshot: "Capture a PNG screenshot of the current browser page, optionally full page.",
  browser_logs: "Read bounded browser diagnostics. Console and network collection is best effort.",
  browser_click: "Click a browser element by snapshot ref, CSS selector, or viewport point.",
  browser_hover: "Move the pointer over a browser element or viewport point.",
  browser_drag: "Drag from a source to a target element using trusted pointer steps.",
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
      host.style.cssText="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;transition:left .16s cubic-bezier(.22,1,.36,1),top .16s cubic-bezier(.22,1,.36,1),opacity .12s ease;";
      const root=host.attachShadow({mode:"open"});
      root.innerHTML=\`<style>
        :host{display:block;width:28px;height:30px;overflow:visible;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
        .wrap{position:relative;width:28px;height:30px;isolation:isolate;}
        .click-pulse{position:absolute;z-index:0;left:-4px;top:-4px;width:18px;height:18px;border:1px solid rgba(88,239,212,.82);border-radius:50%;box-shadow:0 0 8px rgba(44,210,182,.55);opacity:0;transform:scale(.5);}
        .click-pulse.pulse{animation:maximo-ai-cursor-pulse .46s cubic-bezier(.2,.75,.25,1) 1;}
        .pointer{position:absolute;z-index:1;left:0;top:0;width:18px;height:22px;overflow:visible;filter:drop-shadow(0 1px 1px rgba(0,0,0,.72)) drop-shadow(0 0 2px rgba(181,255,241,.95)) drop-shadow(0 0 7px rgba(43,211,181,.72));}
        .label{position:absolute;z-index:2;left:14px;top:14px;height:22px;max-width:124px;padding:0 7px 0 6px;display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:linear-gradient(180deg,rgba(18,26,28,.94),rgba(7,13,15,.94));box-shadow:0 4px 14px rgba(0,0,0,.34),0 0 0 1px rgba(48,218,188,.08);backdrop-filter:blur(12px) saturate(140%);-webkit-backdrop-filter:blur(12px) saturate(140%);color:rgba(244,252,250,.96);font-size:11px;font-weight:600;line-height:1;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .label::before{content:"";width:4px;height:4px;flex:0 0 auto;border-radius:50%;background:#58ebd0;box-shadow:0 0 6px rgba(55,215,187,.9);}
        .label.flip-x{left:auto;right:14px;}
        .label.flip-y{top:auto;bottom:16px;}
        @keyframes maximo-ai-cursor-pulse{0%{transform:scale(.45);opacity:.9}100%{transform:scale(1.45);opacity:0}}
        @media (prefers-reduced-motion:reduce){.click-pulse.pulse{animation:none}.click-pulse.pulse{opacity:.55;transform:scale(1)}}
      </style><div class="wrap"><div class="click-pulse"></div><svg class="pointer" viewBox="0 0 18 22" aria-hidden="true"><path d="M2.1 1.7 2.05 18.9l4.7-4.28 3.35 6.12 3.2-1.75-3.27-5.93h5.94L2.1 1.7Z" fill="#0b1113" stroke="#f4fffd" stroke-width="1.35" stroke-linejoin="round"/></svg><div class="label"></div></div>\`;
      (document.body||document.documentElement).appendChild(host);
    }
    const root=host.shadowRoot;
    const clickPulse=root&&root.querySelector(".click-pulse");
    const labelEl=root&&root.querySelector(".label");
    if(labelEl){
      labelEl.textContent=${JSON.stringify(label)};
      labelEl.classList.remove("flip-x","flip-y");
      const labelWidth=labelEl.getBoundingClientRect().width;
      labelEl.classList.toggle("flip-x",${x}+14+labelWidth>innerWidth-6);
      labelEl.classList.toggle("flip-y",${y}+36>innerHeight-6);
    }
    host.style.left=${x}+"px";
    host.style.top=${y}+"px";
    host.style.opacity="1";
    if(clickPulse&&${pulse ? "true" : "false"}){clickPulse.classList.remove("pulse");void clickPulse.offsetWidth;clickPulse.classList.add("pulse");}
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
    if (name === "browser_resize") inputSchema = { type: "object", properties: { preset: { type: "string", description: "desktop | laptop | tablet | mobile | panel (reset to the visible panel)" }, width: { type: "number", description: "Custom viewport width 320-3840 when no preset." }, height: { type: "number", description: "Custom viewport height 240-2160 when no preset." }, orientation: { type: "string", description: "portrait or landscape for presets." }, tabId: { type: "string" } }, additionalProperties: false };
    if (name === "browser_drag") inputSchema = { type: "object", properties: { source: target, target, tabId: { type: "string" } }, required: ["source", "target"], additionalProperties: false };
    if (name === "browser_press") inputSchema = { type: "object", properties: { keys: { type: "array", items: { type: "string" } }, key: { type: "string" }, tabId: { type: "string" } }, additionalProperties: false };
    if (name === "browser_snapshot") inputSchema = { type: "object", properties: { tabId: { type: "string" } }, additionalProperties: false };
    if (name === "browser_screenshot") inputSchema = { type: "object", properties: { fullPage: { type: "boolean", description: "Capture the bounded full document instead of only the visible viewport; oversized pages clip at 16384px." }, tabId: { type: "string" } }, additionalProperties: false };
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
  private readonly emulation = new TabEmulationController();
  private readonly diagnostics = new Map<string, BrowserDiagnosticsStore>();

  constructor(private readonly manager: BrowserManager, private readonly options: BrowserAutomationHostOptions = {}) {}

  private diagnosticsFor(runtime: CdpRuntime): BrowserDiagnosticsStore {
    const key = this.cursorKey(runtime);
    let store = this.diagnostics.get(key);
    if (!store) {
      store = new BrowserDiagnosticsStore();
      this.diagnostics.set(key, store);
      this.manager.attachRuntimeDiagnostics(runtime.threadId, runtime.tabId, store);
    }
    return store;
  }

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
      // Reveal the shared browser before navigation starts. Waiting for the
      // page load meant slow or failed navigations could run entirely out of
      // sight and never open the panel at all.
      if (input.show !== false) this.options.onRequestOpenPanel?.(call.threadId);
      const state = await this.manager.automationOpen(call.threadId, url, input.reuse !== false);
      affinity.tabId = state.activeTabId;
      if (state.activeTabId) {
        const runtime = await this.manager.getAutomationRuntime(call.threadId, state.activeTabId);
        await this.showAutomationCursor(runtime, { x: 28, y: 28 }, "Opened page", signal);
      }
      return this.navigationOutput(state, state.activeTabId, "created");
    }

    if (call.name === "browser_resize") {
      // Validate before resolving the tab or acquiring a runtime so bad input
      // never touches a live page.
      let requested;
      try {
        requested = resolveResizeRequest(input as { preset?: string; width?: number; height?: number; orientation?: string });
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : "Invalid browser resize request.");
      }
      const tabId = this.resolveTabId(call.threadId, affinity, input.tabId);
      const runtime = await this.manager.getAutomationRuntime(call.threadId, tabId);
      const key = `${call.threadId}:${tabId}`;
      const applied = await this.emulation.apply(key, runtime, requested);
      this.manager.setRuntimeEmulation(call.threadId, tabId, requested);
      await this.showAutomationCursor(runtime, { x: 28, y: 28 }, requested ? "Resized" : "View reset", signal);
      return {
        tabId,
        preset: applied.preset,
        viewport: { width: applied.width, height: applied.height, deviceScaleFactor: applied.deviceScaleFactor },
        mobile: applied.mobile,
        touch: applied.touch,
      };
    }

    const tabId = this.resolveTabId(call.threadId, affinity, input.tabId);
    if (call.name === "browser_navigate") {
      const url = normalizeUrl(String(input.url));
      if (input.show !== false) this.options.onRequestOpenPanel?.(call.threadId);
      const state = await this.manager.automationNavigate(call.threadId, tabId, url);
      affinity.tabId = tabId;
      const runtime = await this.manager.getAutomationRuntime(call.threadId, tabId);
      // Emulation overrides reset on cross-document navigation; reapply them
      // so a resized/emulated view survives browser_navigate.
      await this.emulation.reapply(`${call.threadId}:${tabId}`, runtime);
      await dismissCookieBanners((expression) => evaluatePage(runtime, expression, signal));
      await this.showAutomationCursor(runtime, { x: 28, y: 28 }, "Navigated", signal);
      return this.navigationOutput(state, tabId, "reused");
    }
    if (call.name === "browser_close") {
      await this.clearAutomationCursors(call.threadId);
      this.emulation.forget(`${call.threadId}:${tabId}`);
      this.manager.setRuntimeEmulation(call.threadId, tabId, null);
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
    if (call.name === "browser_screenshot") return this.screenshot(cdpRuntime, input.fullPage === true, signal);
    if (call.name === "browser_logs") {
      const store = this.diagnosticsFor(cdpRuntime);
      const result = store.list({
        includeConsole: input.includeConsole !== false,
        includeNetwork: input.includeNetwork !== false,
        limit: typeof input.limit === "number" ? input.limit : 100,
      });
      return { tabId, ...result };
    }
    if (call.name === "browser_evaluate") return this.evaluate(cdpRuntime, String(input.expression ?? ""), signal);
    if (call.name === "browser_click") return this.click(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_hover") return this.hover(call.sessionId, cdpRuntime, input, signal);
    if (call.name === "browser_drag") return this.drag(call.sessionId, cdpRuntime, input, signal);
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
      case "browser_snapshot": return "Reading";
      case "browser_screenshot": return "Capturing";
      case "browser_logs": return "Checking logs";
      case "browser_click": return "Clicking";
      case "browser_hover": return "Hovering";
      case "browser_drag": return "Dragging";
      case "browser_type": return "Typing";
      case "browser_select": return "Selecting";
      case "browser_upload": return "Uploading";
      case "browser_press": return "Pressing key";
      case "browser_scroll": return "Scrolling";
      case "browser_wait": return "Waiting";
      case "browser_evaluate": return "Inspecting";
      default: return "Working";
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

  private async screenshot(runtime: CdpRuntime, fullPage: boolean, signal: AbortSignal) {
    throwIfAborted(signal);
    const metrics: {
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
      cssContentSize?: { width?: number; height?: number };
    } = await cdpCommand(runtime, "Page.getLayoutMetrics", {}, signal).catch(() => ({}));
    const viewWidth = Math.max(1, Math.round(metrics.cssVisualViewport?.clientWidth ?? metrics.cssContentSize?.width ?? 1));
    const viewHeight = Math.max(1, Math.round(metrics.cssVisualViewport?.clientHeight ?? metrics.cssContentSize?.height ?? 1));
    let image: Buffer | null = null;
    let mode: "viewport" | "fullPage" = "viewport";
    let clipped = false;
    if (fullPage) {
      // Bounded full-page capture via CDP; oversized documents clip at 16384px
      // (Chromium's capture ceiling) and report the clip rather than failing.
      const contentHeight = Math.round(metrics.cssContentSize?.height ?? viewHeight);
      const captureHeight = Math.min(contentHeight, 16_384);
      clipped = contentHeight > captureHeight;
      const captured = await cdpCommand<{ data?: string }>(runtime, "Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: viewWidth, height: captureHeight, scale: 1 },
        captureBeyondViewport: true,
      }, signal).catch(() => null);
      if (captured?.data) {
        image = Buffer.from(captured.data, "base64");
        mode = "fullPage";
      }
    }
    if (!image) image = (await runtime.webContents.capturePage()).toPNG();
    if (image.byteLength > 8 * 1024 * 1024) throw new Error("The browser screenshot is too large.");
    return {
      tabId: runtime.tabId,
      url: runtime.webContents.getURL(),
      capturedAt: new Date().toISOString(),
      mode,
      clipped,
      image: { mimeType: "image/png", width: mode === "fullPage" ? viewWidth : viewWidth, height: mode === "fullPage" ? Math.round(metrics.cssContentSize?.height ?? viewHeight) : viewHeight, byteLength: image.byteLength, data: image.toString("base64") },
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
      const release = runtime.expectAgentInput({ kind: "mouse", type: "mouseDown", x: Math.round(point.x), y: Math.round(point.y), button: "left" });
      try {
        // Humanized approach: eased multi-step move with slight arc + jitter,
        // then press/release with sub-pixel landing jitter.
        const from = { x: Math.max(0, point.x - 90), y: Math.max(0, point.y - 70) };
        const path = humanizedPath(from, point);
        for (const step of path) {
          await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mouseMoved", x: step.x, y: step.y }, signal);
        }
        const landX = Math.round(point.x), landY = Math.round(point.y);
        await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mousePressed", x: landX, y: landY, button: "left", clickCount: 1 }, signal);
        await wait(humanKeyDelayMs() / 2, signal).catch(() => undefined);
        await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mouseReleased", x: landX, y: landY, button: "left", clickCount: 1 }, signal);
      } finally {
        release();
      }
    } else {
      const selector = selectorForTarget(input, snapshot, runtime.tabId);
      if (!selector) throw new Error("Click requires a snapshot ref, CSS selector, or point.");
      await evaluatePage(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error("Element not found");e.scrollIntoView({block:"center",inline:"center"});e.click();return true})()`, signal);
    }
    await this.showAutomationCursor(runtime, point ?? await this.resolveCursorPoint(sessionId, runtime, input, signal), "Clicked", signal, true);
    return { tabId: runtime.tabId, target: {}, point: point ?? { x: 0, y: 0 } };
  }

  private async drag(sessionId: string, runtime: CdpRuntime, input: Record<string, unknown>, signal: AbortSignal) {
    const snapshot = this.snapshotFor(sessionId, runtime.tabId);
    const sourceInput = asRecord(input.source);
    if (!sourceInput) throw new Error("Drag requires a source target.");
    const destinationInput = asRecord(input.target);
    if (!destinationInput) throw new Error("Drag requires a target.");
    const source = pointForTarget(sourceInput, snapshot, runtime.tabId)
      ?? (selectorForTarget(sourceInput, snapshot, runtime.tabId)
        ? await evaluatePage<{ x: number; y: number } | null>(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selectorForTarget(sourceInput, snapshot, runtime.tabId))});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`, signal).catch(() => null)
        : null);
    const destination = pointForTarget(destinationInput, snapshot, runtime.tabId)
      ?? (selectorForTarget(destinationInput, snapshot, runtime.tabId)
        ? await evaluatePage<{ x: number; y: number } | null>(runtime, `(function(){const e=document.querySelector(${JSON.stringify(selectorForTarget(destinationInput, snapshot, runtime.tabId))});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`, signal).catch(() => null)
        : null);
    if (!source || !destination) throw new Error("Both drag endpoints must resolve to elements or points.");
    const release = runtime.expectAgentInput({ kind: "mouse", type: "mouseDown", x: Math.round(source.x), y: Math.round(source.y), button: "left" });
    try {
      await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mousePressed", x: source.x, y: source.y, button: "left", clickCount: 1 }, signal);
      const steps = humanizedPath(source, destination, { steps: 16 });
      for (const step of steps) {
        await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mouseMoved", x: step.x, y: step.y, button: "left" }, signal);
      }
      await wait(60, signal).catch(() => undefined);
      await cdpCommand(runtime, "Input.dispatchMouseEvent", { type: "mouseReleased", x: destination.x, y: destination.y, button: "left", clickCount: 1 }, signal);
    } finally {
      release();
    }
    await this.showAutomationCursor(runtime, destination, "Dragged", signal, true);
    return { tabId: runtime.tabId, source, point: destination };
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
    // Short text goes through per-character trusted key events with a
    // human-like cadence; long text falls back to atomic insert so the tool
    // stays fast and bounded.
    if (text.length <= 80 && !/\n/.test(text)) {
      for (const character of text) {
        await cdpCommand(runtime, "Input.dispatchKeyEvent", { type: "keyDown", key: character, code: keyCode(character), text: character }, signal).catch(() => undefined);
        await cdpCommand(runtime, "Input.dispatchKeyEvent", { type: "keyUp", key: character, code: keyCode(character) }, signal).catch(() => undefined);
        await wait(humanKeyDelayMs(), signal).catch(() => undefined);
      }
      await cdpCommand(runtime, "Input.insertText", { text: "" }, signal).catch(() => undefined);
    } else {
      await cdpCommand(runtime, "Input.insertText", { text }, signal);
    }
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
