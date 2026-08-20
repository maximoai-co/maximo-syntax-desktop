import { describe, expect, it } from "vitest";
import { appSnapShortcutConflictCommand } from "./appSnapShortcut";

describe("AppSnap renderer shortcut conflicts", () => {
  it("finds a default Maximo shortcut", () => {
    expect(
      appSnapShortcutConflictCommand({ kind: "key-chord", modifier: "command", key: "KeyN" }),
    ).toBe("chat.new");
  });

  it("finds single-modifier Maximo chords and ignores combinations that need extra keys", () => {
    expect(
      appSnapShortcutConflictCommand({ kind: "key-chord", modifier: "command", key: "KeyK" }),
    ).toBe("sidebar.search");
    expect(
      appSnapShortcutConflictCommand({ kind: "key-chord", modifier: "option", key: "KeyC" }),
    ).toBeNull();
    expect(
      appSnapShortcutConflictCommand({ kind: "key-chord", modifier: "command", key: "KeyM" }),
    ).toBeNull();
  });
});
