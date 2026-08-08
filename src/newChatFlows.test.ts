import { describe, expect, it } from "vitest";
import { getNewChatFlow, NEW_CHAT_FLOWS } from "./newChatFlows";

describe("new chat flows", () => {
  it("keeps the four primary starter paths in the reference order", () => {
    expect(NEW_CHAT_FLOWS.map((flow) => flow.id)).toEqual(["explore", "build", "review", "fix"]);
  });

  it("uses the short category prompt before a follow-up is chosen", () => {
    expect(NEW_CHAT_FLOWS.map((flow) => flow.prompt)).toEqual(["Explore", "Build", "Review", "Fix"]);
  });

  it("provides four focused prompts for each category", () => {
    for (const flow of NEW_CHAT_FLOWS) expect(flow.suggestions).toHaveLength(4);
    expect(getNewChatFlow("explore").suggestions[0]).toBe("Explore and learn how a feature works");
  });
});
