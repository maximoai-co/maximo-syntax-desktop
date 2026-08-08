import { describe, expect, it } from "vitest";
import {
  activateOtherQuestion,
  toggleQuestionSelection,
  updateOtherQuestionAnswer,
} from "./questionSelection.js";

describe("question selection", () => {
  it("clears listed options when Other is activated", () => {
    expect(activateOtherQuestion({ selected: "Employees||Bank", custom: "" }))
      .toEqual({ selected: "", custom: "" });
  });

  it("clears Other when a listed option is selected", () => {
    expect(toggleQuestionSelection({ selected: "", custom: "No bank account" }, "Bank", true))
      .toEqual({ selected: "Bank", custom: "" });
  });

  it("clears listed options while editing Other", () => {
    expect(updateOtherQuestionAnswer({ selected: "Bank", custom: "" }, "No bank account"))
      .toEqual({ selected: "", custom: "No bank account" });
  });

  it("still supports toggling multiple listed options", () => {
    expect(toggleQuestionSelection({ selected: "Employees", custom: "" }, "Bank", true))
      .toEqual({ selected: "Employees||Bank", custom: "" });
    expect(toggleQuestionSelection({ selected: "Employees||Bank", custom: "" }, "Employees", true))
      .toEqual({ selected: "Bank", custom: "" });
  });
});
