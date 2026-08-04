export type ShortcutCategory = "Navigation" | "Chat" | "Workspace" | "Models" | "Projects";

export interface ShortcutChord {
  key: string;
  mod?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  command: string;
  label: string;
  description: string;
  category: ShortcutCategory;
  chord: ShortcutChord;
}

const mod = (key: string, extras: Omit<ShortcutChord, "key" | "mod"> = {}): ShortcutChord => ({ key, mod: true, ...extras });

const spaceJumps: ShortcutDefinition[] = Array.from({ length: 9 }, (_, index) => ({
  command: `space.jump.${index + 1}`,
  label: index === 0 ? "Jump to Void" : `Jump to space ${index + 1}`,
  description: "Switch directly to a space in the sidebar.",
  category: "Navigation",
  chord: mod(String(index + 1), { alt: true }),
}));

const threadJumps: ShortcutDefinition[] = Array.from({ length: 9 }, (_, index) => ({
  command: `thread.jump.${index + 1}`,
  label: `Jump to visible thread ${index + 1}`,
  description: "Focus a visible thread directly from the sidebar.",
  category: "Navigation",
  chord: mod(String(index + 1)),
}));

export const MAXIMO_SHORTCUTS: readonly ShortcutDefinition[] = [
  { command: "shortcuts.show", label: "Show keyboard shortcuts", description: "Open this reference from anywhere in the app.", category: "Navigation", chord: mod("/") },
  { command: "sidebar.toggle", label: "Toggle sidebar", description: "Collapse or reveal the sidebar shell.", category: "Navigation", chord: mod("b", { shift: true }) },
  { command: "sidebar.addProject", label: "Add project", description: "Open the project dialog to import a local folder.", category: "Projects", chord: mod("o", { shift: true }) },
  { command: "project.open", label: "Open project", description: "Choose a project folder from the desktop.", category: "Projects", chord: mod("o") },
  { command: "workspace.openFiles", label: "Open files", description: "Open the workspace file explorer.", category: "Workspace", chord: mod("p") },
  { command: "workspace.toggleDock", label: "Toggle workspace dock", description: "Show or hide terminal, browser, files, and Git tools.", category: "Workspace", chord: mod("i", { shift: true }) },
  { command: "sidebar.search", label: "Search projects and threads", description: "Open the workspace search palette.", category: "Navigation", chord: mod("k") },
  { command: "sidebar.activity", label: "Toggle Activity", description: "Show or hide running tasks and completed work.", category: "Navigation", chord: mod("u", { alt: true }) },
  { command: "sidebar.importThread", label: "Import thread", description: "Open the current project folder for imported context.", category: "Projects", chord: mod("i") },
  { command: "space.previous", label: "Previous space", description: "Switch to the previous sidebar space.", category: "Navigation", chord: mod("arrowleft", { alt: true }) },
  { command: "space.next", label: "Next space", description: "Switch to the next sidebar space.", category: "Navigation", chord: mod("arrowright", { alt: true }) },
  ...spaceJumps,
  { command: "chat.new", label: "New thread", description: "Start a fresh thread in the current project.", category: "Chat", chord: mod("n") },
  { command: "chat.newLatestProject", label: "New thread in latest project", description: "Create a thread in the most recently active project.", category: "Chat", chord: mod("n", { shift: true }) },
  { command: "chat.newChat", label: "New chat", description: "Open a fresh chat landing view.", category: "Chat", chord: mod("n", { alt: true }) },
  { command: "chat.newTerminal", label: "New terminal thread", description: "Create a chat and open its terminal panel.", category: "Workspace", chord: mod("t", { shift: true }) },
  { command: "chat.newClaude", label: "New Claude thread", description: "Start a new chat for a Claude-compatible account.", category: "Chat", chord: mod("c", { alt: true }) },
  { command: "chat.newCodex", label: "New Codex thread", description: "Start a new chat for a Codex-compatible account.", category: "Chat", chord: mod("x", { alt: true }) },
  { command: "chat.newCursor", label: "New Cursor thread", description: "Start a new chat for a Cursor-compatible account.", category: "Chat", chord: mod("r", { alt: true }) },
  { command: "chat.split", label: "Split chat", description: "Open a companion side chat beside the current task.", category: "Chat", chord: mod("\\") },
  { command: "view.recent.previous", label: "Previous recent view", description: "Move backward through recently opened chats.", category: "Navigation", chord: { key: "tab", ctrl: true, shift: true } },
  { command: "view.recent.next", label: "Next recent view", description: "Move forward through recently opened chats.", category: "Navigation", chord: { key: "tab", ctrl: true } },
  ...threadJumps,
  { command: "modelPicker.toggle", label: "Model picker", description: "Open the composer model picker.", category: "Models", chord: mod("m", { shift: true }) },
  { command: "model.next", label: "Next model", description: "Cycle to the next available model.", category: "Models", chord: { key: "]", alt: true } },
  { command: "model.previous", label: "Previous model", description: "Cycle to the previous available model.", category: "Models", chord: { key: "[", alt: true } },
  { command: "traitsPicker.toggle", label: "Reasoning picker", description: "Open reasoning effort controls.", category: "Models", chord: mod("e", { shift: true }) },
  { command: "composer.focus.toggle", label: "Focus composer", description: "Focus the chat prompt composer.", category: "Chat", chord: mod("l") },
  { command: "settings.usage", label: "Usage and limits", description: "Open account usage and limits.", category: "Navigation", chord: mod("u", { shift: true }) },
  { command: "terminal.toggle", label: "Toggle terminal", description: "Show or hide the terminal panel.", category: "Workspace", chord: mod("t", { alt: true }) },
  { command: "diff.toggle", label: "Toggle diff", description: "Open or close the working-tree diff panel.", category: "Workspace", chord: mod("d") },
  { command: "browser.toggle", label: "Toggle browser", description: "Reveal the built-in browser panel.", category: "Workspace", chord: mod("b", { alt: true }) },
  { command: "editor.openFavorite", label: "Open in editor", description: "Open the current project in the external editor.", category: "Workspace", chord: mod("e", { alt: true }) },
  { command: "git.commitAndPush", label: "Commit and push", description: "Open source control for the current project.", category: "Workspace", chord: mod("p", { shift: true }) },
  { command: "terminal.workspace.newFullWidth", label: "Open full-width terminal workspace", description: "Expand the terminal panel for the active project.", category: "Workspace", chord: mod("j", { shift: true }) },
  { command: "terminal.workspace.closeActive", label: "Close active workspace panel", description: "Close the currently focused workspace panel.", category: "Workspace", chord: mod("w") },
  { command: "terminal.workspace.terminal", label: "Focus terminal tab", description: "Switch the workspace to the terminal panel.", category: "Workspace", chord: mod("1") },
  { command: "terminal.workspace.chat", label: "Focus chat tab", description: "Switch the workspace back to chat.", category: "Workspace", chord: mod("2") },
] as const;

function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function normalizedShortcutKey(value: string): string {
  const key = value.toLowerCase();
  if (key === "esc") return "escape";
  return key;
}

export function matchesShortcut(event: KeyboardEvent, chord: ShortcutChord, platform = navigator.platform): boolean {
  const mac = isMacPlatform(platform);
  const expectedMeta = Boolean(chord.meta || (chord.mod && mac));
  const expectedCtrl = Boolean(chord.ctrl || (chord.mod && !mac));
  return event.metaKey === expectedMeta
    && event.ctrlKey === expectedCtrl
    && event.shiftKey === Boolean(chord.shift)
    && event.altKey === Boolean(chord.alt)
    && normalizedShortcutKey(event.key) === normalizedShortcutKey(chord.key);
}

export function shortcutLabel(chord: ShortcutChord, platform = navigator.platform): string {
  const mac = isMacPlatform(platform);
  const key = chord.key === "arrowleft" ? "Left" : chord.key === "arrowright" ? "Right" : chord.key === "arrowup" ? "Up" : chord.key === "arrowdown" ? "Down" : chord.key === "tab" ? "Tab" : chord.key === "escape" ? "Esc" : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key;
  if (mac) return `${chord.ctrl ? "⌃" : ""}${chord.alt ? "⌥" : ""}${chord.shift ? "⇧" : ""}${chord.mod || chord.meta ? "⌘" : ""}${key}`;
  const parts: string[] = [];
  if (chord.ctrl || chord.mod) parts.push("Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  if (chord.meta) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

export function shortcutDefinition(command: string): ShortcutDefinition | undefined {
  return MAXIMO_SHORTCUTS.find((definition) => definition.command === command);
}
