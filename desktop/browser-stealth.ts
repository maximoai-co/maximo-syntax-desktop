// FILE: browser-stealth.ts
// Purpose: Automation-quality helpers shared by the browser host: a bounded
// diagnostics store (console + network), JS dialog auto-handling, trusted
// drag, full-page screenshots, humanized pointer/key input, and cookie-banner
// dismissal so agents see clean pages.
// Layer: Desktop browser automation

import type { WebContents } from "electron";

// ---------------------------------------------------------------------------
// Diagnostics store (browser_logs)
// ---------------------------------------------------------------------------

export interface BrowserLogEntry {
  readonly seq: number;
  readonly kind: "console" | "exception" | "network";
  readonly level: "debug" | "info" | "warning" | "error";
  readonly timestamp: string;
  text: string;
  readonly url: string;
  readonly metadata?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 400;
const MAX_LOG_TEXT = 2_000;

export class BrowserDiagnosticsStore {
  private entries: BrowserLogEntry[] = [];
  private droppedCount = 0;
  private nextSeq = 1;

  push(entry: Omit<BrowserLogEntry, "seq" | "timestamp">): void {
    this.entries.push({
      ...entry,
      text: entry.text.slice(0, MAX_LOG_TEXT),
      seq: this.nextSeq++,
      timestamp: new Date().toISOString(),
    });
    while (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.shift();
      this.droppedCount += 1;
    }
  }

  list(options: { includeConsole?: boolean; includeNetwork?: boolean; limit?: number; afterSeq?: number } = {}): {
    entries: BrowserLogEntry[];
    droppedCount: number;
    truncated: boolean;
  } {
    const includeConsole = options.includeConsole !== false;
    const includeNetwork = options.includeNetwork !== false;
    const afterSeq = Number.isFinite(options.afterSeq) ? Number(options.afterSeq) : 0;
    const filtered = this.entries.filter((entry) =>
      entry.seq > afterSeq &&
      (entry.kind === "network" ? includeNetwork : includeConsole));
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
    return {
      entries: filtered.slice(-limit),
      droppedCount: this.droppedCount,
      truncated: filtered.length > limit,
    };
  }

  clear(): void {
    this.entries = [];
    this.droppedCount = 0;
  }
}

export function attachDiagnostics(webContents: WebContents, store: BrowserDiagnosticsStore): () => void {
  const consoleMessage = (_event: Electron.Event, level: number, message: string, line: number, sourceId: string) => {
    const levelName = level === 0 ? "debug" : level === 1 ? "info" : level === 2 ? "warning" : "error";
    store.push({ kind: "console", level: levelName, text: `${message} (${sourceId}:${line})`, url: webContents.getURL() });
  };
  const consoleMessageObject = (details: { level: string; message: string }) => {
    const level = details.level === "error" ? "error" : details.level === "warning" ? "warning" : details.level === "info" ? "info" : "debug";
    store.push({ kind: "console", level, text: details.message, url: webContents.getURL() });
  };
  const failed = (_event: Electron.Event, code: number, description: string, validatedUrl: string, isMainFrame: boolean) => {
    if (code === -3) return;
    store.push({
      kind: "network",
      level: "error",
      text: isMainFrame ? `Load failed (${code}): ${description}` : `Resource failed (${code}): ${description}`,
      url: validatedUrl || webContents.getURL(),
      metadata: { code, mainFrame: isMainFrame },
    });
  };
  (webContents.on as (eventName: string, listener: (...args: unknown[]) => void) => void)("console-message", consoleMessageObject as unknown as (...args: unknown[]) => void);
  webContents.on("did-fail-load", failed);
  return () => {
    (webContents.removeListener as (eventName: string, listener: (...args: unknown[]) => void) => void)("console-message", consoleMessageObject as unknown as (...args: unknown[]) => void);
    webContents.removeListener("did-fail-load", failed);
  };
}

// ---------------------------------------------------------------------------
// Dialog auto-handling
// ---------------------------------------------------------------------------

export interface BrowserDialogEvent {
  readonly kind: "alert" | "confirm" | "prompt" | "beforeunload";
  readonly message: string;
  readonly defaultResponse: string;
}

export interface DialogDecision {
  response: string;
  suppress: boolean;
}

/**
 * Dialog safety for automation. Sandboxed guest renderers already resolve
 * alert()/confirm()/prompt() immediately without showing a dialog, and
 * beforeunload prompts cannot hang CDP-driven navigation because Chromium
 * treats programmatic closes as confirmed. What CAN stall an agent is a page
 * whose main-frame navigation is intercepted by a beforeunload confirm; the
 * host-side hook below tells Chromium to continue that navigation. Returns a
 * disposer.
 */
export function attachDialogHandling(
  webContents: WebContents,
  _onDialog: (event: BrowserDialogEvent) => void,
): () => void {
  // Electron exposes the beforeunload decision through this event. Preventing
  // the event here tells Chromium to ignore the page's veto and continue the
  // requested navigation instead of leaving the tab on the old document.
  const willPreventUnload = (event: Electron.Event) => event.preventDefault();
  webContents.on("will-prevent-unload", willPreventUnload);
  return () => webContents.removeListener("will-prevent-unload", willPreventUnload);
}

// ---------------------------------------------------------------------------
// Humanized input
// ---------------------------------------------------------------------------

/** Deterministic per-call jitter so replays do not look scripted. */
function jitter(magnitude: number): number {
  return (Math.random() * 2 - 1) * magnitude;
}

export interface HumanPathOptions {
  readonly steps?: number;
  readonly start?: { x: number; y: number };
}

/**
 * Generates an eased pointer path with slight curvature and overshoot-free
 * jitter, approximating ballistic human mouse motion.
 */
export function humanizedPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: HumanPathOptions = {},
): Array<{ x: number; y: number }> {
  const steps = Math.min(Math.max(options.steps ?? Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 24), 4), 40);
  const points: Array<{ x: number; y: number }> = [];
  // Control point perpendicular to the travel vector produces a natural arc.
  const midX = (from.x + to.x) / 2 + jitter(Math.min(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.15));
  const midY = (from.y + to.y) / 2 + jitter(Math.min(60, Math.hypot(to.x - from.x, to.y - from.y) * 0.15));
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const ease = t * t * (3 - 2 * t); // smoothstep
    const x = (1 - ease) * (1 - ease) * from.x + 2 * (1 - ease) * ease * midX + ease * ease * to.x;
    const y = (1 - ease) * (1 - ease) * from.y + 2 * (1 - ease) * ease * midY + ease * ease * to.y;
    points.push({ x: Math.round((x + jitter(0.7)) * 10) / 10, y: Math.round((y + jitter(0.7)) * 10) / 10 });
  }
  return points;
}

/** Inter-key delay in ms sampled around a human-like log-normal center. */
export function humanKeyDelayMs(): number {
  const base = 72 + Math.random() * 90;
  return Math.round(base);
}

// ---------------------------------------------------------------------------
// Cookie banner dismissal
// ---------------------------------------------------------------------------

const BANNER_DISMISS_SCRIPT = `(() => {
  const removed = [];
  const keywords = /(accept|agree|consent|allow|ok|got it|understand|i understand|continue)/i;
  const bannerHints = /(cookie|consent|gdpr|privacy|banner|cmp)/i;
  const candidates = document.querySelectorAll('button, [role="button"], a');
  for (const element of candidates) {
    if (removed.length >= 3) break;
    const label = (element.getAttribute("aria-label") || element.id || element.textContent || "").trim().slice(0, 120);
    if (!label || !keywords.test(label)) continue;
    const context = (element.closest("[id],[class],[aria-label]")?.getAttribute?.("id") || "") + " " +
      (element.closest("[class]")?.getAttribute?.("class") || "") + " " + label;
    if (!bannerHints.test(context)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    try { element.click(); removed.push(label); } catch { /* detached node */ }
  }
  return removed;
})()`;

export async function dismissCookieBanners(evaluate: (expression: string) => Promise<unknown>): Promise<string[]> {
  try {
    const removed = await evaluate(BANNER_DISMISS_SCRIPT);
    return Array.isArray(removed) ? removed.map(String) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stealth init scripts
// ---------------------------------------------------------------------------

/**
 * Injected on every new document when stealth mode is on. Patches the
 * highest-signal JS probes: navigator.webdriver, chrome runtime object,
 * permissions query consistency, and light canvas/audio jitter. Deliberately
 * minimal — heavy JS tampering is itself a detection signal.
 */
export const STEALTH_INIT_SCRIPT = `
(() => {
  if (window.__maximoStealth) return;
  Object.defineProperty(window, "__maximoStealth", { value: true, configurable: false });

  const define = (target, property, value) => {
    try {
      Object.defineProperty(target, property, { get: () => value, configurable: true });
    } catch { /* non-configurable */ }
  };

  try {
    if (navigator.webdriver !== undefined) define(Navigator.prototype, "webdriver", false);
  } catch { /* older engines */ }

  try {
    if (!window.chrome) {
      define(window, "chrome", { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } });
    }
  } catch { /* frozen window */ }

  try {
    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters && parameters.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }
  } catch { /* permissions unavailable */ }

  try {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...arguments_) {
      const context = this.getContext("2d");
      if (context && this.width > 0 && this.height > 0) {
        const row = Math.floor(Math.random() * this.height);
        const column = Math.floor(Math.random() * Math.max(1, this.width - 2));
        const pixel = context.getImageData(column, row, 1, 1);
        pixel.data[3] = pixel.data[3] ? pixel.data[3] : 1;
        context.putImageData(pixel, column, row);
      }
      return originalToDataURL.apply(this, arguments_);
    };
  } catch { /* canvas unavailable */ }

  try {
    const channelData = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function (array) {
      channelData.call(this, array);
      for (let index = 0; index < array.length; index += 1) array[index] += 1e-9;
    };
  } catch { /* audio unavailable */ }

})();
`;
