import { describe, expect, it } from "vitest";
import {
  buildThemeCssVariables,
  createThemeShareString,
  getAvailableThemePresets,
  getThemePreset,
  isThemePresetId,
  normalizeThemePack,
  parseThemeShareString,
  THEME_PRESETS,
} from "./theme";
import { DEFAULT_THEME_PACKS } from "./types";

describe("theme appearance", () => {
  it("normalizes persisted colors, fonts, contrast, and sidebar settings", () => {
    const normalized = normalizeThemePack({
      accent: "#ABCDEF",
      background: "not-a-color",
      foreground: "#123456",
      fonts: { ui: "Fira Code; color: red", code: "JetBrains Mono" },
      translucentSidebar: false,
      contrast: 140,
      preset: "unknown",
    }, DEFAULT_THEME_PACKS.dark);

    expect(normalized.accent).toBe("#abcdef");
    expect(normalized.background).toBe(DEFAULT_THEME_PACKS.dark.background);
    expect(normalized.foreground).toBe("#123456");
    expect(normalized.fonts.ui).toBe("Fira Code color: red");
    expect(normalized.translucentSidebar).toBe(false);
    expect(normalized.contrast).toBe(100);
    expect(normalized.preset).toBe("maximo");
  });

  it("projects a theme pack into app-wide surface, type, and density variables", () => {
    const variables = buildThemeCssVariables({
      ...DEFAULT_THEME_PACKS.light,
      accent: "#c2417b",
      background: "#fff7fb",
      foreground: "#3b1e2e",
      fonts: { ui: "Avenir", code: "Fira Code" },
      translucentSidebar: false,
      contrast: 80,
    }, "light", {
      systemUiFont: false,
      uiDensity: "spacious",
      chatFontSizePx: 16,
      terminalFontSizePx: 18,
      terminalFontFamily: "Iosevka",
    });

    expect(variables["--accent"]).toBe("#c2417b");
    expect(variables["--surface-solid"]).toBe("#fff7fb");
    expect(variables["--text"]).toBe("#3b1e2e");
    expect(variables["--sidebar-surface-filter"]).toBe("none");
    expect(variables["--theme-ui-font-family"]).toContain('"Avenir"');
    expect(variables["--theme-code-font-family"]).toContain('"Fira Code"');
    expect(variables["--terminal-font-family"]).toContain('"Iosevka"');
    expect(variables["--app-font-size-base"]).toBe("16px");
    expect(variables["--density-scale"]).toBe("1.15");
  });

  it("round-trips a theme share string for the correct variant", () => {
    const source = { ...DEFAULT_THEME_PACKS.dark, accent: "#0169cc" };
    const encoded = createThemeShareString("dark", source);
    expect(parseThemeShareString(encoded, "dark")).toEqual(source);
    expect(() => parseThemeShareString(encoded, "light")).toThrow(/dark theme slot/);
  });

  it("keeps light surfaces light and dark surfaces at the original depth", () => {
    const baseOptions = {
      systemUiFont: false,
      uiDensity: "comfortable" as const,
      chatFontSizePx: 13,
      terminalFontSizePx: 12,
      terminalFontFamily: "",
    };
    const light = buildThemeCssVariables(DEFAULT_THEME_PACKS.light, "light", baseOptions);
    const dark = buildThemeCssVariables(DEFAULT_THEME_PACKS.dark, "dark", baseOptions);

    expect(light["--bg"]).toBe("#eaefee");
    expect(light["--bg-soft"]).toBe("#eff4f3");
    expect(light["--surface-solid"]).toBe(DEFAULT_THEME_PACKS.light.background);

    expect(dark["--bg"]).toBe("#111112");
    expect(dark["--accent-strong"]).toBe("#78d0bd");
    expect(dark["--surface-solid"]).toBe(DEFAULT_THEME_PACKS.dark.background);
  });

  it("exposes the Synara catalog and filters dark-only or light-only seeds by pack", () => {
    expect(THEME_PRESETS.length).toBeGreaterThan(20);
    expect(isThemePresetId("dracula")).toBe(true);
    expect(isThemePresetId("rose-pine")).toBe(true);
    expect(isThemePresetId("tokyo-night")).toBe(true);
    expect(isThemePresetId("not-a-theme")).toBe(false);

    const lightIds = getAvailableThemePresets("light").map((preset) => preset.id);
    const darkIds = getAvailableThemePresets("dark").map((preset) => preset.id);
    expect(lightIds).toContain("maximo");
    expect(lightIds).toContain("proof");
    expect(lightIds).not.toContain("dracula");
    expect(darkIds).toContain("dracula");
    expect(darkIds).toContain("tokyo-night");
    expect(darkIds).not.toContain("proof");

    const dracula = getThemePreset("dracula", "dark");
    expect(dracula.accent).toBe("#ff79c6");
    expect(dracula.background).toBe("#282a36");
    expect(dracula.preset).toBe("dracula");

    const catppuccinLight = getThemePreset("catppuccin", "light");
    expect(catppuccinLight.accent).toBe("#8839ef");
    expect(catppuccinLight.background).toBe("#eff1f5");
  });
});
