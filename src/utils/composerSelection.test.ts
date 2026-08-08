import { describe, expect, it } from "vitest";
import { resolveComposerRunSelection } from "./composerSelection.js";

describe("resolveComposerRunSelection", () => {
  it("uses the visible model and effort for resend instead of the prior turn", () => {
    expect(resolveComposerRunSelection(
      { model: "new-model", effort: "high", permission: "full" },
      { model: "old-model", effort: "low", permission: "auto" },
      { model: "default-model", effort: "medium", permission: "auto" },
    )).toEqual({ model: "new-model", effort: "high", permission: "full" });
  });

  it("preserves explicit provider-default selections", () => {
    expect(resolveComposerRunSelection(
      { model: "", effort: "", permission: "auto" },
      { model: "old-model", effort: "high", permission: "full" },
      { model: "default-model", effort: "medium", permission: "auto" },
    )).toEqual({ model: "", effort: "", permission: "auto" });
  });
});
