import { describe, expect, it } from "vitest";
import { MAXIMO_SHORTCUTS, matchesShortcut, shortcutDefinition, shortcutLabel } from "./shortcuts";

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "k",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("keyboard shortcuts", () => {
  it("contains the full navigation and workspace registry", () => {
    expect(MAXIMO_SHORTCUTS.some((definition) => definition.command === "space.jump.9")).toBe(true);
    expect(MAXIMO_SHORTCUTS.some((definition) => definition.command === "terminal.workspace.closeActive")).toBe(true);
    expect(shortcutDefinition("modelPicker.toggle")?.label).toBe("Model picker");
  });

  it("matches platform modifier chords and formats them", () => {
    const search = shortcutDefinition("sidebar.search")!;
    expect(matchesShortcut(keyEvent(), search.chord, "MacIntel")).toBe(true);
    expect(matchesShortcut(keyEvent({ metaKey: false, ctrlKey: true }), search.chord, "Win32")).toBe(true);
    expect(shortcutLabel(search.chord, "MacIntel")).toBe("⌘K");
    expect(shortcutLabel(search.chord, "Win32")).toBe("Ctrl+K");
  });
});
