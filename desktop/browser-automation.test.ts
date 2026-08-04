import { describe, expect, it } from "vitest";
import { browserToolDefinitions, isBrowserToolName } from "./browser-automation.js";

describe("Maximo browser MCP contract", () => {
  it("publishes the complete browser action catalogue", () => {
    const names = browserToolDefinitions().map((tool) => tool.name);
    expect(names).toContain("browser_status");
    expect(names).toContain("browser_snapshot");
    expect(names).toContain("browser_click");
    expect(names).toContain("browser_upload");
    expect(names).toContain("browser_evaluate");
    expect(new Set(names).size).toBe(names.length);
  });

  it("rejects arbitrary MCP tool names at the host boundary", () => {
    expect(isBrowserToolName("browser_navigate")).toBe(true);
    expect(isBrowserToolName("external-browser-tool__tabs_context")).toBe(false);
  });
});
