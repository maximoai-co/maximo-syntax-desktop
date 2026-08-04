import { describe, expect, it } from "vitest";
import { composerKeyAction, type ComposerKeyInput } from "./composerKeyboard";

function key(overrides: Partial<ComposerKeyInput> = {}): ComposerKeyInput {
  return { key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false, keyCode: 13, ...overrides };
}

describe("composerKeyAction", () => {
  it("sends with Enter and preserves a line break with Shift+Enter", () => {
    expect(composerKeyAction(key(), true)).toBe("send");
    expect(composerKeyAction(key({ shiftKey: true }), true)).toBe("newline");
  });

  it("uses Enter for line breaks and the platform modifier shortcut for sending", () => {
    expect(composerKeyAction(key(), false)).toBe("newline");
    expect(composerKeyAction(key({ metaKey: true }), false)).toBe("send");
    expect(composerKeyAction(key({ ctrlKey: true }), false)).toBe("send");
  });

  it("does not submit while an IME is composing or for other keys", () => {
    expect(composerKeyAction(key({ isComposing: true }), true)).toBeNull();
    expect(composerKeyAction(key({ keyCode: 229 }), true)).toBeNull();
    expect(composerKeyAction(key({ key: "Escape" }), true)).toBeNull();
  });
});
