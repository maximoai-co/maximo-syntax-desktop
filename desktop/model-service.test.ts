import { describe, expect, it } from "vitest";
import { isOpenCodeChatCompletionModel, parseModel } from "./model-service.js";

describe("parseModel", () => {
  it("recognizes Maximo reasoning capability metadata", () => {
    expect(parseModel({
      id: "maximo-pandora-3.8-nano",
      name: "Maximo AI: Pandora 3.8 Nano",
      capabilities: ["text", "tools", "streaming"],
      reasoning_efforts: [],
    })).toMatchObject({
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high"],
    });
  });

  it("keeps explicitly advertised effort levels authoritative", () => {
    expect(parseModel({
      id: "maximo-atlas-1.2",
      reasoning: { supported_efforts: ["medium", "high"], default_effort: "medium" },
      supported_features: ["reasoning"],
    })).toMatchObject({
      supportsEffort: true,
      supportedEffortLevels: ["medium", "high"],
      defaultEffort: "medium",
    });
  });

  it("keeps the full effort range for metadata-light third-party models", () => {
    expect(parseModel({ id: "deepseek-v4-flash" }, { fallbackEffort: true })).toMatchObject({
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    });
  });

  it("keeps provider context-window metadata for the live desktop meter", () => {
    expect(parseModel({ id: "maximo-atlas", context_length: 525_000 })).toMatchObject({
      contextWindow: 525_000,
    });
  });
});

describe("OpenCode model catalog", () => {
  it("keeps only models documented for each Chat Completions endpoint", () => {
    expect(isOpenCodeChatCompletionModel("zen", "deepseek-v4-flash")).toBe(true);
    expect(isOpenCodeChatCompletionModel("zen", "gpt-5.6-luna")).toBe(false);
    expect(isOpenCodeChatCompletionModel("go", "mimo-v2.5-pro")).toBe(true);
    expect(isOpenCodeChatCompletionModel("go", "qwen3.7-max")).toBe(false);
  });
});
