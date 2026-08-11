import { describe, expect, it } from "vitest";
import type { EngineModel } from "../../desktop/types";
import { effortForModel, effortOptionsFor, findEngineModel, modelControlValue } from "./modelCatalog";

const current: EngineModel = {
  value: "default",
  displayName: "Maximo AI: Atlas 1.1",
  description: "Current model",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high"],
  defaultEffort: "medium",
  activeEffort: "high",
};

describe("authenticated model catalog controls", () => {
  it("maps the provider's current default model to the desktop default value", () => {
    expect(modelControlValue(current)).toBe("");
    expect(findEngineModel([current], "")).toBe(current);
  });

  it("uses only the selected model's supported effort levels", () => {
    expect(effortOptionsFor(current).map((option) => option.value)).toEqual(["high", "low", "medium"]);
  });

  it("keeps compatible effort and resets unsupported effort to the model default", () => {
    expect(effortForModel(current, "low")).toBe("low");
    expect(effortForModel(current, "max")).toBe("medium");
    expect(effortForModel({ ...current, supportsEffort: false, supportedEffortLevels: [] }, "high")).toBe("");
  });
});
