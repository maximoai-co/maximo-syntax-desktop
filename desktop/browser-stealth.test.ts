import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import { attachDialogHandling, STEALTH_INIT_SCRIPT } from "./browser-stealth.js";

describe("browser unload handling", () => {
  it("allows navigation when a page tries to block unload", () => {
    const webContents = new EventEmitter() as WebContents;
    const dispose = attachDialogHandling(webContents, () => undefined);
    const preventDefault = vi.fn();
    const event = { preventDefault } as unknown as Electron.Event;

    webContents.emit("will-prevent-unload", event);
    expect(preventDefault).toHaveBeenCalledOnce();

    dispose();
    preventDefault.mockClear();
    webContents.emit("will-prevent-unload", event);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("does not install a page-side handler that blocks every navigation", () => {
    expect(STEALTH_INIT_SCRIPT).not.toContain("beforeunload");
  });
});
