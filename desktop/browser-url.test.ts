import { describe, expect, it } from "vitest";
import { collapseDuplicateBrowserScheme } from "./browser-url.js";

describe("browser URL normalization", () => {
  it("preserves a valid scheme", () => {
    expect(collapseDuplicateBrowserScheme("https://example.com/path")).toBe("https://example.com/path");
    expect(collapseDuplicateBrowserScheme("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("collapses accidental repeated schemes", () => {
    expect(collapseDuplicateBrowserScheme("https://https://httpbingo.org/forms/post")).toBe("https://httpbingo.org/forms/post");
    expect(collapseDuplicateBrowserScheme("http://http://localhost:3000")).toBe("http://localhost:3000");
  });
});
