import { describe, expect, it } from "vitest";
import type { BrowserState } from "./types.js";
import type { BrowserManager } from "./browser-manager.js";
import { BrowserAutomationHost, browserToolDefinitions, isBrowserToolName } from "./browser-automation.js";

const emptyBrowserState = (threadId: string): BrowserState => ({
  threadId,
  version: 1,
  open: true,
  activeTabId: null,
  tabs: [],
  lastError: null,
  credentialPrompt: null,
  permissionPrompt: null,
  find: null,
  downloads: [],
});

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

  it("requests the browser panel before an AI-opened page finishes loading", async () => {
    const order: string[] = [];
    let finishLoading!: (state: BrowserState) => void;
    const loading = new Promise<BrowserState>((resolve) => { finishLoading = resolve; });
    const manager = {
      subscribeHumanControl: () => () => undefined,
      automationOpen: () => {
        order.push("navigation-started");
        return loading;
      },
    } as unknown as BrowserManager;
    const host = new BrowserAutomationHost(manager, {
      onRequestOpenPanel: () => order.push("panel-requested"),
    });

    const opening = host.execute({
      capability: "test-capability",
      sessionId: "test-session",
      provider: "test-provider",
      threadId: "test-thread",
      name: "browser_open",
      arguments: { url: "https://example.com" },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["panel-requested", "navigation-started"]);

    finishLoading(emptyBrowserState("test-thread"));
    await expect(opening).resolves.toMatchObject({ finalUrl: "about:blank" });
  });
});
