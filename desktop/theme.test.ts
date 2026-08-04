import { describe, expect, it } from "vitest";
import { buildThemeCssVariables, createThemeShareString, normalizeThemePack, parseThemeShareString } from "./theme";
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
});
