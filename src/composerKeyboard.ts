export type ComposerKeyAction = "send" | "newline" | null;

export type ComposerKeyInput = Pick<KeyboardEvent, "key" | "shiftKey" | "metaKey" | "ctrlKey" | "isComposing" | "keyCode">;

/**
 * Resolve the action for a key press in the message composer.
 * New-line actions intentionally fall through to the textarea's native behavior.
 */
export function composerKeyAction(input: ComposerKeyInput, sendWithEnter: boolean): ComposerKeyAction {
  if (input.key !== "Enter" || input.isComposing || input.keyCode === 229) return null;
  if (!sendWithEnter) return input.metaKey || input.ctrlKey ? "send" : "newline";
  return input.shiftKey ? "newline" : "send";
}

export function composerSendShortcutLabel(platform = typeof navigator === "undefined" ? "" : navigator.platform): string {
  return /Mac|iPhone|iPad/i.test(platform) ? "⌘Enter" : "Ctrl+Enter";
}
