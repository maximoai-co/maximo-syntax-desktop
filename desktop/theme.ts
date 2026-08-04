import { DEFAULT_THEME_PACKS } from "./types.js";
import type { ThemeMode, ThemePack, ThemePresetId, ThemeVariant, UiDensity } from "./types.js";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const THEME_SHARE_PREFIX = "maximo-theme-v1:";

type RgbColor = { red: number; green: number; blue: number };

/**
 * Appearance presets shown in Settings → Appearance.
 * Includes Maximo originals plus the Synara/Codex catalog (accent/surface/ink seeds).
 * Some catalog themes only ship a dark or light seed — `variants` controls which pack they appear for.
 */
export const THEME_PRESETS: ReadonlyArray<{ id: Exclude<ThemePresetId, "custom">; label: string; variants: readonly ThemeVariant[] }> = [
  { id: "maximo", label: "Maximo", variants: ["light", "dark"] },
  { id: "codex", label: "Codex", variants: ["light", "dark"] },
  { id: "ocean", label: "Ocean", variants: ["light", "dark"] },
  { id: "forest", label: "Forest", variants: ["light", "dark"] },
  { id: "rose", label: "Rose", variants: ["light", "dark"] },
  { id: "synara", label: "Synara", variants: ["light", "dark"] },
  { id: "absolutely", label: "Absolutely", variants: ["light", "dark"] },
  { id: "ayu", label: "Ayu", variants: ["dark"] },
  { id: "catppuccin", label: "Catppuccin", variants: ["light", "dark"] },
  { id: "dracula", label: "Dracula", variants: ["dark"] },
  { id: "everforest", label: "Everforest", variants: ["light", "dark"] },
  { id: "github", label: "GitHub", variants: ["light", "dark"] },
  { id: "gruvbox", label: "Gruvbox", variants: ["light", "dark"] },
  { id: "linear", label: "Linear", variants: ["light", "dark"] },
  { id: "lobster", label: "Lobster", variants: ["dark"] },
  { id: "material", label: "Material", variants: ["dark"] },
  { id: "matrix", label: "Matrix", variants: ["dark"] },
  { id: "monokai", label: "Monokai", variants: ["dark"] },
  { id: "night-owl", label: "Night Owl", variants: ["dark"] },
  { id: "nord", label: "Nord", variants: ["dark"] },
  { id: "notion", label: "Notion", variants: ["light", "dark"] },
  { id: "one", label: "One", variants: ["light", "dark"] },
  { id: "oscurange", label: "Oscurange", variants: ["dark"] },
  { id: "proof", label: "Proof", variants: ["light"] },
  { id: "raycast", label: "Raycast", variants: ["light", "dark"] },
  { id: "rose-pine", label: "Rose Pine", variants: ["light", "dark"] },
  { id: "sentry", label: "Sentry", variants: ["dark"] },
  { id: "solarized", label: "Solarized", variants: ["light", "dark"] },
  { id: "temple", label: "Temple", variants: ["dark"] },
  { id: "tokyo-night", label: "Tokyo Night", variants: ["dark"] },
  { id: "vercel", label: "Vercel", variants: ["light", "dark"] },
  { id: "vscode-plus", label: "VS Code Plus", variants: ["light", "dark"] },
];

const PRESET_COLORS: Record<Exclude<ThemePresetId, "custom">, Partial<Record<ThemeVariant, Pick<ThemePack, "accent" | "background" | "foreground">>>> = {
  maximo: {
    light: { accent: "#00ad92", background: "#f8fbfa", foreground: "#173334" },
    dark: { accent: "#43bea4", background: "#1c1d1e", foreground: "#d6dcdb" },
  },
  codex: {
    light: { accent: "#0169cc", background: "#ffffff", foreground: "#0d0d0d" },
    dark: { accent: "#0169cc", background: "#111111", foreground: "#fcfcfc" },
  },
  ocean: {
    light: { accent: "#168fa3", background: "#f2fbfc", foreground: "#14323a" },
    dark: { accent: "#39bfd0", background: "#10272f", foreground: "#e4f9fb" },
  },
  forest: {
    light: { accent: "#278b52", background: "#f5faf6", foreground: "#18351f" },
    dark: { accent: "#60c58a", background: "#14241a", foreground: "#e5f4e9" },
  },
  rose: {
    light: { accent: "#c2417b", background: "#fff7fb", foreground: "#3b1e2e" },
    dark: { accent: "#f08bb8", background: "#26161f", foreground: "#ffe8f1" },
  },
  synara: {
    light: { accent: "#526fff", background: "#fcfcfc", foreground: "#262626" },
    dark: { accent: "#6073cc", background: "#0e0e0e", foreground: "#f5f5f5" },
  },
  absolutely: {
    light: { accent: "#cc7d5e", background: "#f9f9f7", foreground: "#2d2d2b" },
    dark: { accent: "#cc7d5e", background: "#2d2d2b", foreground: "#f9f9f7" },
  },
  ayu: {
    dark: { accent: "#e6b450", background: "#0b0e14", foreground: "#bfbdb6" },
  },
  catppuccin: {
    light: { accent: "#8839ef", background: "#eff1f5", foreground: "#4c4f69" },
    dark: { accent: "#cba6f7", background: "#1e1e2e", foreground: "#cdd6f4" },
  },
  dracula: {
    dark: { accent: "#ff79c6", background: "#282a36", foreground: "#f8f8f2" },
  },
  everforest: {
    light: { accent: "#93b259", background: "#fdf6e3", foreground: "#5c6a72" },
    dark: { accent: "#a7c080", background: "#2d353b", foreground: "#d3c6aa" },
  },
  github: {
    light: { accent: "#0969da", background: "#ffffff", foreground: "#1f2328" },
    dark: { accent: "#1f6feb", background: "#0d1117", foreground: "#e6edf3" },
  },
  gruvbox: {
    light: { accent: "#458588", background: "#fbf1c7", foreground: "#3c3836" },
    dark: { accent: "#458588", background: "#282828", foreground: "#ebdbb2" },
  },
  linear: {
    light: { accent: "#5e6ad2", background: "#fcfcfd", foreground: "#1b1b1b" },
    dark: { accent: "#606acc", background: "#0f0f11", foreground: "#e3e4e6" },
  },
  lobster: {
    dark: { accent: "#ff5c5c", background: "#111827", foreground: "#e4e4e7" },
  },
  material: {
    dark: { accent: "#80cbc4", background: "#212121", foreground: "#eeffff" },
  },
  matrix: {
    dark: { accent: "#1eff5a", background: "#040805", foreground: "#b8ffca" },
  },
  monokai: {
    dark: { accent: "#99947c", background: "#272822", foreground: "#f8f8f2" },
  },
  "night-owl": {
    dark: { accent: "#44596b", background: "#011627", foreground: "#d6deeb" },
  },
  nord: {
    dark: { accent: "#88c0d0", background: "#2e3440", foreground: "#d8dee9" },
  },
  notion: {
    light: { accent: "#3183d8", background: "#ffffff", foreground: "#37352f" },
    dark: { accent: "#3183d8", background: "#191919", foreground: "#d9d9d8" },
  },
  one: {
    light: { accent: "#526fff", background: "#fafafa", foreground: "#383a42" },
    dark: { accent: "#4d78cc", background: "#282c34", foreground: "#abb2bf" },
  },
  oscurange: {
    dark: { accent: "#f9b98c", background: "#0b0b0f", foreground: "#e6e6e6" },
  },
  proof: {
    light: { accent: "#3d755d", background: "#f5f3ed", foreground: "#2f312d" },
  },
  raycast: {
    light: { accent: "#ff6363", background: "#ffffff", foreground: "#030303" },
    dark: { accent: "#ff6363", background: "#101010", foreground: "#fefefe" },
  },
  "rose-pine": {
    light: { accent: "#d7827e", background: "#faf4ed", foreground: "#575279" },
    dark: { accent: "#ea9a97", background: "#232136", foreground: "#e0def4" },
  },
  sentry: {
    dark: { accent: "#7055f6", background: "#2d2935", foreground: "#e6dff9" },
  },
  solarized: {
    light: { accent: "#b58900", background: "#fdf6e3", foreground: "#657b83" },
    dark: { accent: "#d30102", background: "#002b36", foreground: "#839496" },
  },
  temple: {
    dark: { accent: "#e4f222", background: "#02120c", foreground: "#c7e6da" },
  },
  "tokyo-night": {
    dark: { accent: "#3d59a1", background: "#1a1b26", foreground: "#a9b1d6" },
  },
  vercel: {
    light: { accent: "#006aff", background: "#ffffff", foreground: "#171717" },
    dark: { accent: "#006efe", background: "#000000", foreground: "#ededed" },
  },
  "vscode-plus": {
    light: { accent: "#007acc", background: "#ffffff", foreground: "#000000" },
    dark: { accent: "#007acc", background: "#1e1e1e", foreground: "#d4d4d4" },
  },
};

const THEME_PRESET_IDS = new Set<string>([...THEME_PRESETS.map((preset) => preset.id), "custom"]);

const DENSITY_SCALE: Record<UiDensity, number> = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.15,
};

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === "string" && THEME_PRESET_IDS.has(value);
}

/** Presets that include a color seed for the requested light/dark pack. */
export function getAvailableThemePresets(variant: ThemeVariant): typeof THEME_PRESETS {
  return THEME_PRESETS.filter((preset) => preset.variants.includes(variant));
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return HEX_COLOR_RE.test(normalized) ? normalized : fallback;
}

export function normalizeFontFamily(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value.replace(/["';{}<>\n\r]/g, "").trim().slice(0, 256);
}

export function normalizeThemePack(value: unknown, fallback: ThemePack): ThemePack {
  const source = value && typeof value === "object" ? value as Partial<ThemePack> : {};
  const fonts = source.fonts && typeof source.fonts === "object" ? source.fonts as Partial<ThemePack["fonts"]> : {};
  return {
    preset: isThemePresetId(source.preset) ? source.preset : fallback.preset,
    accent: normalizeHexColor(source.accent, fallback.accent),
    background: normalizeHexColor(source.background, fallback.background),
    foreground: normalizeHexColor(source.foreground, fallback.foreground),
    fonts: {
      ui: normalizeFontFamily(fonts.ui, fallback.fonts.ui),
      code: normalizeFontFamily(fonts.code, fallback.fonts.code),
    },
    translucentSidebar: typeof source.translucentSidebar === "boolean" ? source.translucentSidebar : fallback.translucentSidebar,
    contrast: typeof source.contrast === "number" && Number.isFinite(source.contrast)
      ? Math.min(100, Math.max(0, Math.round(source.contrast)))
      : fallback.contrast,
  };
}

export function getThemePreset(id: ThemePresetId, variant: ThemeVariant): ThemePack {
  const presetId = id === "custom" ? "maximo" : id;
  const colors = PRESET_COLORS[presetId]?.[variant] ?? PRESET_COLORS.maximo[variant] ?? DEFAULT_THEME_PACKS[variant];
  const fallback = DEFAULT_THEME_PACKS[variant];
  return {
    ...fallback,
    preset: id === "custom" ? "maximo" : id,
    accent: colors.accent,
    background: colors.background,
    foreground: colors.foreground,
    fonts: { ...fallback.fonts },
  };
}

export function resolveThemeVariant(mode: ThemeMode, systemDark: boolean): ThemeVariant {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

export function createThemeShareString(variant: ThemeVariant, pack: ThemePack): string {
  return `${THEME_SHARE_PREFIX}${JSON.stringify({ variant, pack })}`;
}

export function parseThemeShareString(value: string, targetVariant: ThemeVariant): ThemePack {
  const trimmed = value.trim();
  if (!trimmed.startsWith(THEME_SHARE_PREFIX)) {
    throw new Error(`Theme strings must start with ${THEME_SHARE_PREFIX}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(THEME_SHARE_PREFIX.length));
  } catch {
    throw new Error("The theme string is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("The theme string is not a theme object.");
  const payload = parsed as { variant?: unknown; pack?: unknown };
  if (payload.variant !== targetVariant) throw new Error(`This theme belongs to the ${String(payload.variant)} theme slot.`);
  return normalizeThemePack(payload.pack, DEFAULT_THEME_PACKS[targetVariant]);
}

export function buildThemeCssVariables(
  pack: ThemePack,
  variant: ThemeVariant,
  options: {
    systemUiFont: boolean;
    uiDensity: UiDensity;
    chatFontSizePx: number;
    terminalFontSizePx: number;
    terminalFontFamily: string;
  },
): Record<string, string> {
  const dark = variant === "dark";
  const contrast = Math.min(100, Math.max(0, pack.contrast)) / 100;
  const background = normalizeHexColor(pack.background, DEFAULT_THEME_PACKS[variant].background);
  const foreground = normalizeHexColor(pack.foreground, DEFAULT_THEME_PACKS[variant].foreground);
  const accent = normalizeHexColor(pack.accent, DEFAULT_THEME_PACKS[variant].accent);
  const underSurface = dark
    ? mixHex(background, "#000000", 0.6 - contrast * 0.12)
    : mixHex(background, foreground, 0.94 - contrast * 0.02);
  const softSurface = dark
    ? mixHex(underSurface, background, 0.58)
    : mixHex(underSurface, background, 0.62);
  const textStrong = dark ? mixHex(foreground, "#ffffff", 0.16) : mixHex(foreground, "#000000", 0.18);
  const muted = mixHex(foreground, underSurface, dark ? 0.64 : 0.58);
  const faint = mixHex(foreground, underSurface, dark ? 0.43 : 0.38);
  const hoverAlpha = (dark ? 0.06 : 0.06) + contrast * (dark ? 0.04 : 0.05);
  const activeAlpha = hoverAlpha + (dark ? 0.04 : 0.05);
  const borderAlpha = (dark ? 0.075 : 0.12) + contrast * 0.05;
  const strongBorderAlpha = (dark ? 0.13 : 0.2) + contrast * 0.06;
  const accentStrong = dark ? mixHex(accent, "#ffffff", 0.72) : mixHex(accent, foreground, 0.72);
  const translucent = pack.translucentSidebar;
  const sidebarSurface = translucent ? rgba(background, dark ? 0.72 : 0.64) : background;
  const codeSurface = dark ? mixHex(background, "#000000", 0.7) : mixHex(background, foreground, 0.94);
  const terminalBackground = dark ? mixHex(background, "#000000", 0.55) : "#0b0d0e";
  const terminalForeground = dark ? foreground : "#d6e2df";
  const uiFont = options.systemUiFont
    ? "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    : fontStack(pack.fonts.ui, '"Manrope", ui-sans-serif, system-ui, -apple-system, sans-serif');
  const displayFont = options.systemUiFont || pack.fonts.ui.trim().length > 0 ? uiFont : '"Space Grotesk", sans-serif';
  const codeFont = fontStack(pack.fonts.code, "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
  const terminalFont = fontStack(options.terminalFontFamily, "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
  const baseFontSize = clamp(options.chatFontSizePx, 11, 18);
  const densityScale = DENSITY_SCALE[options.uiDensity];

  return {
    "--bg": underSurface,
    "--bg-soft": softSurface,
    "--surface": translucent ? rgba(background, dark ? 0.72 : 0.64) : background,
    "--surface-solid": background,
    "--surface-hover": rgba(foreground, hoverAlpha),
    "--surface-active": rgba(foreground, activeAlpha),
    "--menu-hover": rgba(foreground, hoverAlpha),
    "--menu-active": rgba(foreground, activeAlpha),
    "--sidebar": sidebarSurface,
    "--sidebar-surface": sidebarSurface,
    "--sidebar-surface-shadow": dark ? "inset 0 1px 0 rgba(255,255,255,.024)" : "inset 0 1px 0 rgba(0,0,0,.025)",
    "--sidebar-surface-filter": translucent ? "blur(8px) saturate(135%)" : "none",
    "--border": rgba(foreground, borderAlpha),
    "--border-strong": rgba(foreground, strongBorderAlpha),
    "--text": foreground,
    "--text-strong": textStrong,
    "--muted": muted,
    "--faint": faint,
    "--accent": accent,
    "--accent-strong": accentStrong,
    "--accent-soft": rgba(accent, dark ? 0.09 : 0.12),
    "--blue": accentStrong,
    "--link": accentStrong,
    "--accent-foreground": readableInk(accent, dark),
    "--code-surface": codeSurface,
    "--code-foreground": foreground,
    "--terminal-background": terminalBackground,
    "--terminal-foreground": terminalForeground,
    "--danger": dark ? "#ff737b" : "#d84b53",
    "--warning": dark ? "#ffab5b" : "#d57a22",
    "--shadow": dark ? "0 20px 60px rgba(0,0,0,.32), 0 2px 8px rgba(0,0,0,.22)" : "0 18px 55px rgba(25,71,65,.11), 0 2px 8px rgba(25,71,65,.05)",
    "--shadow-soft": dark ? "0 8px 24px rgba(0,0,0,.18)" : "0 7px 22px rgba(25,71,65,.07)",
    "--theme-ui-font-family": uiFont,
    "--theme-display-font-family": displayFont,
    "--theme-code-font-family": codeFont,
    "--terminal-font-family": terminalFont,
    "--app-font-size-base": `${baseFontSize}px`,
    "--app-font-size-ui": `${baseFontSize}px`,
    "--app-font-size-ui-lg": `${Math.round(baseFontSize * 1.08 * 10) / 10}px`,
    "--app-font-size-ui-sm": `${Math.round(baseFontSize * 0.88 * 10) / 10}px`,
    "--app-font-size-ui-xs": `${Math.round(baseFontSize * 0.78 * 10) / 10}px`,
    "--app-font-size-ui-2xs": `${Math.round(baseFontSize * 0.68 * 10) / 10}px`,
    "--app-font-size-ui-meta": `${Math.round(baseFontSize * 0.82 * 10) / 10}px`,
    "--app-font-size-ui-timestamp": `${Math.round(baseFontSize * 0.74 * 10) / 10}px`,
    "--app-font-size-chat": `${baseFontSize}px`,
    "--app-font-size-chat-code": `${Math.round(baseFontSize * 0.9 * 10) / 10}px`,
    "--app-font-size-chat-meta": `${Math.round(baseFontSize * 0.82 * 10) / 10}px`,
    "--app-font-size-chat-tiny": `${Math.round(baseFontSize * 0.72 * 10) / 10}px`,
    "--app-font-size-terminal": `${clamp(options.terminalFontSizePx, 10, 22)}px`,
    "--chat-font-size": `${baseFontSize}px`,
    "--terminal-font-size": `${clamp(options.terminalFontSizePx, 10, 22)}px`,
    "--density-scale": String(densityScale),
    "--app-density-row-height": `${1.75 * densityScale}rem`,
    "--app-density-row-padding-y": `${0.125 * densityScale}rem`,
    "--app-density-row-gap": `${0.5 * densityScale}rem`,
    "--app-density-settings-row-padding-y": `${0.625 * densityScale}rem`,
    "--app-density-chat-gutter-x": `${0.75 * densityScale}rem`,
    "--app-density-chat-gutter-x-lg": `${1.25 * densityScale}rem`,
    "--app-density-chat-gutter-total": `${2.5 * densityScale}rem`,
    "--app-density-composer-wrap-padding-x": `${1.125 * densityScale}rem`,
    "--app-density-composer-wrap-padding-top": `${0.5 * densityScale}rem`,
    "--app-density-composer-wrap-padding-bottom": `${0.75 * densityScale}rem`,
    "--app-density-composer-editor-padding-top": `${0.75 * densityScale}rem`,
    "--app-density-composer-editor-padding-bottom": `${0.5 * densityScale}rem`,
    "--app-density-composer-editor-padding-x": `${0.75 * densityScale}rem`,
    "--app-density-composer-footer-padding": `${0.375 * densityScale}rem`,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

function parseHex(value: string): RgbColor {
  const normalized = normalizeHexColor(value, "#000000").slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function mixHex(first: string, second: string, firstWeight: number): string {
  const left = parseHex(first);
  const right = parseHex(second);
  const weight = clamp(firstWeight, 0, 1);
  const channel = (a: number, b: number) => Math.round(a * weight + b * (1 - weight));
  return `#${[channel(left.red, right.red), channel(left.green, right.green), channel(left.blue, right.blue)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rgba(hex: string, alpha: number): string {
  const color = parseHex(hex);
  return `rgba(${color.red},${color.green},${color.blue},${clamp(alpha, 0, 1).toFixed(3)})`;
}

function readableInk(hex: string, dark: boolean): string {
  const color = parseHex(hex);
  const luminance = (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
  if (luminance > 0.62) return dark ? "#111111" : "#173334";
  return "#ffffff";
}

function fontStack(value: string, fallback: string): string {
  const normalized = normalizeFontFamily(value);
  if (!normalized) return fallback;
  const families = normalized.split(",").map((family) => family.trim()).filter(Boolean).map((family) => {
    const unquoted = family.replace(/^['"]|['"]$/g, "");
    return `"${unquoted}"`;
  });
  return families.length > 0 ? `${families.join(", ")}, ${fallback}` : fallback;
}
