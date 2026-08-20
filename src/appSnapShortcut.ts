import type { DesktopAppSnapKeyChord } from "../desktop/types";
import { appSnapShortcutKeyLabel } from "../desktop/app-snap-shortcut";
import { MAXIMO_SHORTCUTS, type ShortcutChord, type ShortcutDefinition } from "./shortcuts";

function bindingModifiers(chord: ShortcutChord): Set<DesktopAppSnapKeyChord["modifier"]> {
  const modifiers = new Set<DesktopAppSnapKeyChord["modifier"]>();
  if (chord.mod || chord.meta) modifiers.add("command");
  if (chord.ctrl) modifiers.add("control");
  if (chord.alt) modifiers.add("option");
  if (chord.shift) modifiers.add("shift");
  return modifiers;
}

function bindingKeyLabel(chord: ShortcutChord): string {
  const key = chord.key.toLowerCase();
  if (key === " " || key === "space") return "Space";
  if (key === "enter") return "Return";
  if (key === "escape") return "Esc";
  if (key === "arrowup") return "↑";
  if (key === "arrowdown") return "↓";
  if (key === "arrowleft") return "←";
  if (key === "arrowright") return "→";
  if (key === "tab") return "Tab";
  return key.length === 1 ? key.toUpperCase() : key;
}

export function appSnapShortcutConflictCommand(
  shortcut: DesktopAppSnapKeyChord,
  bindings: readonly ShortcutDefinition[] = MAXIMO_SHORTCUTS,
): string | null {
  const shortcutKeyLabel = appSnapShortcutKeyLabel(shortcut.key).toUpperCase();
  for (const binding of bindings) {
    const modifiers = bindingModifiers(binding.chord);
    if (
      modifiers.size === 1 &&
      modifiers.has(shortcut.modifier) &&
      bindingKeyLabel(binding.chord).toUpperCase() === shortcutKeyLabel
    ) {
      return binding.command;
    }
  }
  return null;
}

export function appSnapShortcutConflictLabel(command: string): string {
  return MAXIMO_SHORTCUTS.find((binding) => binding.command === command)?.label ?? command;
}
