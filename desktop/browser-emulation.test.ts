import { describe, expect, it } from "vitest";
import { DEVICE_PRESETS, resolveResizeRequest } from "./browser-emulation.js";

describe("browser device emulation", () => {
  it("publishes natural-orientation presets", () => {
    expect(DEVICE_PRESETS.mobile).toMatchObject({ width: 390, height: 844, touch: true, mobile: true });
    expect(DEVICE_PRESETS.desktop).toMatchObject({ width: 1440, height: 900, touch: false });
  });

  it("resolves named presets", () => {
    const state = resolveResizeRequest({ preset: "mobile" });
    expect(state).toMatchObject({ preset: "mobile", width: 390, height: 844, deviceScaleFactor: 3 });
  });

  it("swaps dimensions for landscape on portrait-native presets", () => {
    const state = resolveResizeRequest({ preset: "mobile", orientation: "landscape" });
    expect(state).toMatchObject({ width: 844, height: 390 });
  });

  it("keeps desktop preset unchanged in landscape", () => {
    const state = resolveResizeRequest({ preset: "desktop", orientation: "landscape" });
    expect(state).toMatchObject({ width: 1440, height: 900 });
  });

  it("signals a panel reset with null", () => {
    expect(resolveResizeRequest({ preset: "panel" })).toBeNull();
  });

  it("rejects unknown presets", () => {
    expect(() => resolveResizeRequest({ preset: "watch" })).toThrow(/Unknown device preset/);
  });

  it("clamps custom sizes into supported bounds", () => {
    const small = resolveResizeRequest({ width: 10, height: 10 });
    expect(small).toMatchObject({ width: 320, height: 240 });
    const large = resolveResizeRequest({ width: 99_999, height: 99_999 });
    expect(large).toMatchObject({ width: 3840, height: 2160 });
  });

  it("requires explicit size when no preset is given", () => {
    expect(() => resolveResizeRequest({})).toThrow(/preset .* or numeric width and height/);
  });
});
