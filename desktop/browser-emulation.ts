// FILE: browser-emulation.ts
// Purpose: Per-tab device/viewport emulation for the shared browser so the AI
// can view and interact with pages as desktop, laptop, tablet, or mobile —
// including touch input and mobile identity overrides.
// Layer: Desktop browser automation

import type { WebContents } from "electron";

import {
  buildMobileChromeClientHints,
  deriveAndroidChromeUserAgent,
} from "./browser-identity.js";

export type BrowserDevicePreset = "desktop" | "laptop" | "tablet" | "mobile" | "panel";

export interface BrowserEmulationState {
  preset: BrowserDevicePreset;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  touch: boolean;
}

export const DEVICE_PRESETS: Record<Exclude<BrowserDevicePreset, "panel">, Omit<BrowserEmulationState, "preset">> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, touch: false },
  laptop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, touch: false },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, touch: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true },
};

const MIN_WIDTH = 320;
const MAX_WIDTH = 3840;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 2160;

export interface ResizeRequest {
  preset?: string;
  width?: number;
  height?: number;
  orientation?: string;
}

/**
 * Resolves a resize tool request into concrete emulated metrics. A named
 * preset wins; otherwise explicit width/height are required. Presets ship
 * their natural orientation; requesting the opposite swaps the dimensions.
 * Returns null for the "panel" reset (caller clears the override).
 */
export function resolveResizeRequest(request: ResizeRequest): BrowserEmulationState | null {
  const orientation = typeof request.orientation === "string" ? request.orientation.toLowerCase() : null;
  if (request.preset !== undefined) {
    const presetName = String(request.preset).toLowerCase();
    if (presetName === "panel") return null;
    const preset = DEVICE_PRESETS[presetName as Exclude<BrowserDevicePreset, "panel">];
    if (!preset) throw new Error("Unknown device preset. Use one of: desktop, laptop, tablet, mobile, panel.");
    const useSwapped =
      (orientation === "landscape" && preset.height > preset.width) ||
      (orientation === "portrait" && preset.width > preset.height);
    return {
      preset: presetName as BrowserDevicePreset,
      width: useSwapped ? preset.height : preset.width,
      height: useSwapped ? preset.width : preset.height,
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.mobile,
      touch: preset.touch,
    };
  }

  const width = Number(request.width);
  const height = Number(request.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Provide a preset (desktop, laptop, tablet, mobile, panel) or numeric width and height.");
  }
  return {
    preset: "desktop",
    width: clamp(width, MIN_WIDTH, MAX_WIDTH),
    height: clamp(height, MIN_HEIGHT, MAX_HEIGHT),
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

interface EmulationTarget {
  readonly webContents: WebContents;
}

// Per-tab emulation bookkeeping lives on the automation host, keyed by tab key.
export class TabEmulationController {
  private readonly states = new Map<string, BrowserEmulationState>();

  async apply(key: string, target: EmulationTarget, state: BrowserEmulationState | null): Promise<BrowserEmulationState> {
    if (state === null) {
      this.states.delete(key);
      await clearOverride(target.webContents);
      return this.current(key);
    }
    this.states.set(key, state);
    await overrideMetrics(target.webContents, state);
    return state;
  }

  /** The stored state for a tab key, or null when the panel is authoritative. */
  stored(key: string): BrowserEmulationState | null {
    return this.states.get(key) ?? null;
  }

  current(key: string): BrowserEmulationState {
    return this.states.get(key) ?? { ...PANEL_DEFAULT_STATE };
  }

  forget(key: string): void {
    this.states.delete(key);
  }

  /** Reapplies the stored override after a navigation clears it. */
  async reapply(key: string, target: EmulationTarget): Promise<void> {
    const state = this.states.get(key);
    if (state) await overrideMetrics(target.webContents, state);
  }
}

export const PANEL_DEFAULT_STATE: BrowserEmulationState = {
  preset: "panel",
  width: 0,
  height: 0,
  deviceScaleFactor: 1,
  mobile: false,
  touch: false,
};

/** Applies (or clears, when state is null) device metrics + identity for a tab. */
export async function applyEmulationOverride(webContents: WebContents, state: BrowserEmulationState | null): Promise<void> {
  if (state === null) {
    await clearOverride(webContents);
    return;
  }
  await overrideMetrics(webContents, state);
}

async function overrideMetrics(webContents: WebContents, state: BrowserEmulationState): Promise<void> {
  const debuggerSession = webContents.debugger;
  const wasAttached = debuggerSession.isAttached();
  if (!wasAttached) debuggerSession.attach("1.3");
  try {
    await debuggerSession.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: state.width,
      height: state.height,
      deviceScaleFactor: state.deviceScaleFactor,
      mobile: state.mobile,
    });
    await debuggerSession.sendCommand("Emulation.setTouchEmulationEnabled", {
      enabled: state.touch,
      maxTouchPoints: state.touch ? 5 : 1,
    });
    if (state.mobile) {
      // Mobile presets also present an Android Chrome identity via UA + hints.
      const desktopUa = webContents.session.getUserAgent();
      const mobileUa = deriveAndroidChromeUserAgent(desktopUa);
      if (mobileUa) {
        const hints = buildMobileChromeClientHints(mobileUa);
        await debuggerSession.sendCommand("Network.setUserAgentOverride", {
          userAgent: mobileUa,
          ...(hints ? { useragentmetadata: {
            brands: [
              { brand: "Chromium", version: hints["sec-ch-ua"].match(/Chromium";v="(\d+)"/)?.[1] ?? "131" },
              { brand: "Google Chrome", version: hints["sec-ch-ua"].match(/Google Chrome";v="(\d+)"/)?.[1] ?? "131" },
              { brand: "Not=A?Brand", version: "24" },
            ],
            fullVersionList: [],
            fullVersion: "",
            platform: "Android",
            platformVersion: "10.0.0",
            architecture: "arm",
            model: "",
            mobile: true,
            bitness: "64",
            wow64: false,
          } } : {}),
        });
      }
    } else {
      await debuggerSession.sendCommand("Network.setUserAgentOverride", { userAgent: webContents.session.getUserAgent() });
    }
  } finally {
    if (!wasAttached) debuggerSession.detach();
  }
}

async function clearOverride(webContents: WebContents): Promise<void> {
  const debuggerSession = webContents.debugger;
  const wasAttached = debuggerSession.isAttached();
  if (!wasAttached) debuggerSession.attach("1.3");
  try {
    await debuggerSession.sendCommand("Emulation.clearDeviceMetricsOverride", {});
    await debuggerSession.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
    await debuggerSession.sendCommand("Network.setUserAgentOverride", { userAgent: webContents.session.getUserAgent() });
  } finally {
    if (!wasAttached) debuggerSession.detach();
  }
}
