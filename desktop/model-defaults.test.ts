import { describe, expect, it } from "vitest";
import {
  chooseMytabulonDefaultModel,
  MYTABULON_DEFAULT_MODEL,
  normalizeRetiredMytabulonModel,
  RETIRED_MYTABULON_MODEL,
} from "./model-defaults.js";

describe("MyTabulon model defaults", () => {
  it("prefers Atlas 1.4 and skips retired Atlas IDs", () => {
    expect(chooseMytabulonDefaultModel([RETIRED_MYTABULON_MODEL, MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
    expect(chooseMytabulonDefaultModel(["maximo-atlas-1.1", MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
    expect(chooseMytabulonDefaultModel(["maximo-atlas-1.2", MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
    expect(chooseMytabulonDefaultModel(["maximo-atlas-1.3", MYTABULON_DEFAULT_MODEL])).toBe(MYTABULON_DEFAULT_MODEL);
    expect(chooseMytabulonDefaultModel([RETIRED_MYTABULON_MODEL, "maximo-pandora-3.9-nano"])).toBe("maximo-pandora-3.9-nano");
    expect(chooseMytabulonDefaultModel([])).toBe(MYTABULON_DEFAULT_MODEL);
  });

  it("migrates retired saved model selections", () => {
    expect(normalizeRetiredMytabulonModel(RETIRED_MYTABULON_MODEL)).toBe(MYTABULON_DEFAULT_MODEL);
    expect(normalizeRetiredMytabulonModel("maximo-atlas-1.1")).toBe(MYTABULON_DEFAULT_MODEL);
    expect(normalizeRetiredMytabulonModel("atlas-1.1")).toBe(MYTABULON_DEFAULT_MODEL);
    expect(normalizeRetiredMytabulonModel("maximo-atlas-1.2")).toBe(MYTABULON_DEFAULT_MODEL);
    expect(normalizeRetiredMytabulonModel("atlas-1.2")).toBe(MYTABULON_DEFAULT_MODEL);
    expect(normalizeRetiredMytabulonModel("maximo-atlas-1.3")).toBe(MYTABULON_DEFAULT_MODEL);
    expect(normalizeRetiredMytabulonModel("atlas-1.3")).toBe(MYTABULON_DEFAULT_MODEL);
  });
});
