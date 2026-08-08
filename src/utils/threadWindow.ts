import type { ChatMessage } from "../../desktop/types.js";

export interface ThreadMessageWindow {
  messages: ChatMessage[];
  hiddenCount: number;
}

function isAuxiliaryMessage(message: ChatMessage | undefined): boolean {
  return Boolean(message?.interaction || message?.kind === "follow-up");
}

/**
 * Slice stored messages before React constructs markdown/timeline nodes. When
 * the boundary lands on an assistant turn, include adjacent interactions and
 * follow-up context that belong to that turn.
 */
export function threadMessageWindow(messages: readonly ChatMessage[], visibleCount: number): ThreadMessageWindow {
  const limit = Math.max(1, Math.floor(visibleCount));
  let start = Math.max(0, messages.length - limit);
  const boundary = messages[start];
  if (start > 0 && (boundary?.role === "assistant" || isAuxiliaryMessage(boundary))) {
    while (start > 0 && isAuxiliaryMessage(messages[start - 1])) start -= 1;
  }
  return {
    messages: messages.slice(start),
    hiddenCount: start,
  };
}
