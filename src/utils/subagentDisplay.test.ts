import { describe, expect, it } from "vitest";
import { formatSubagentTitle, isGenericSubagentType, subagentDisplayName } from "./subagentDisplay.js";

describe("subagentDisplayName", () => {
  it("prefers the task title over a generic agent type", () => {
    expect(subagentDisplayName({
      agentType: "general-purpose",
      description: "Analyze Kimi K3 video style",
    })).toBe("Analyze Kimi K3 video style");
  });

  it("uses a specialized agent type when the description is generic", () => {
    expect(subagentDisplayName({
      agentType: "Explore",
      description: "Sub-agent task",
    })).toBe("Explore");
  });

  it("falls back to Sub-agent", () => {
    expect(subagentDisplayName({ agentType: "general-purpose", description: "Sub-agent task" })).toBe("Sub-agent");
  });
});

describe("formatSubagentTitle", () => {
  it("prefixes the title with subagent:", () => {
    expect(formatSubagentTitle({
      agentType: "general-purpose",
      description: "Analyze Kimi K3 video style",
    })).toBe("subagent: Analyze Kimi K3 video style");
  });
});

describe("isGenericSubagentType", () => {
  it("treats general-purpose as generic", () => {
    expect(isGenericSubagentType("general-purpose")).toBe(true);
    expect(isGenericSubagentType("Explore")).toBe(false);
  });
});
