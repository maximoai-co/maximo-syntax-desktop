import type { ChatMessage, CompactionEvent, RunTimelineItem } from "../../desktop/types.js";

const DEFAULT_KEEP_TURNS = 3;

export interface CompactedTranscript {
  messages: ChatMessage[];
  compactHiddenCount: number;
  compactEntry?: Extract<RunTimelineItem, { type: "compaction" }>;
}

function isUserTurn(message: ChatMessage | undefined): boolean {
  return Boolean(message && message.role === "user" && message.kind !== "follow-up" && !message.interaction);
}

function compactEntryFromTimeline(timeline: readonly RunTimelineItem[] | undefined): Extract<RunTimelineItem, { type: "compaction" }> | undefined {
  if (!timeline?.length) return undefined;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.type === "compaction" && item.status === "complete") return item;
  }
  return undefined;
}

function latestCompactAnchor(
  messages: readonly ChatMessage[],
  liveTimeline: readonly RunTimelineItem[] | undefined,
): { messageIndex: number; entry: Extract<RunTimelineItem, { type: "compaction" }> } | undefined {
  const liveEntry = compactEntryFromTimeline(liveTimeline);
  let savedIndex = -1;
  let savedEntry: Extract<RunTimelineItem, { type: "compaction" }> | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = compactEntryFromTimeline(messages[index]?.timeline);
    if (entry) {
      savedIndex = index;
      savedEntry = entry;
      break;
    }
  }
  if (liveEntry && (!savedEntry || liveEntry.timestamp >= savedEntry.timestamp)) {
    return { messageIndex: messages.length, entry: liveEntry };
  }
  if (savedEntry) return { messageIndex: savedIndex, entry: savedEntry };
  return undefined;
}

/**
 * After compaction, the model keeps a summary plus the last few turns.
 * The transcript should match that: hide earlier bubbles so old history
 * does not keep filling the chat after the compact divider.
 */
export function transcriptAfterCompaction(
  messages: readonly ChatMessage[],
  liveTimeline?: readonly RunTimelineItem[],
  keepTurns = DEFAULT_KEEP_TURNS,
): CompactedTranscript {
  const anchor = latestCompactAnchor(messages, liveTimeline);
  if (!anchor) return { messages: [...messages], compactHiddenCount: 0 };

  let userTurns = 0;
  let start = Math.max(0, Math.min(anchor.messageIndex, messages.length));
  for (let index = Math.min(anchor.messageIndex, messages.length) - 1; index >= 0; index -= 1) {
    if (!isUserTurn(messages[index])) continue;
    userTurns += 1;
    start = index;
    if (userTurns >= keepTurns) break;
  }
  while (start > 0 && (messages[start - 1]?.kind === "follow-up" || messages[start - 1]?.interaction)) {
    start -= 1;
  }
  return {
    messages: messages.slice(start),
    compactHiddenCount: start,
    compactEntry: anchor.entry,
  };
}
