import type { AgentWorkItem, ChatInteraction, RunTimelineItem } from "../../desktop/types.js";

export type KeyedWorkTimelineEntry =
  | RunTimelineItem
  | { type: "interaction"; interaction: ChatInteraction; timestamp: number };

function workTimelineEntryBaseKey(entry: KeyedWorkTimelineEntry): string {
  if (entry.type === "activity") return `activity:${entry.toolUseId ?? entry.timestamp}`;
  if (entry.type === "agent") return `agent:${entry.agent.toolUseId ?? entry.agent.taskId}`;
  if (entry.type === "interaction") return `interaction:${entry.interaction.toolUseId ?? `${entry.timestamp}:${entry.interaction.type}`}`;
  if (entry.type === "user-context") return `context:${entry.timestamp}`;
  return `text:${entry.timestamp}`;
}

function agentWorkItemBaseKey(item: AgentWorkItem): string {
  if (item.type === "activity") return `agent-activity:${item.toolUseId ?? item.timestamp}`;
  return `agent-text:${item.timestamp}`;
}

function uniqueKeys<T>(items: readonly T[], baseKey: (item: T) => string): string[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const base = baseKey(item);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return occurrence === 0 ? base : `${base}:duplicate-${occurrence}`;
  });
}

/**
 * Stable row identities for the moving live-timeline window. Array indexes are
 * deliberately excluded: prepending, trimming, or sorting unrelated events
 * must not remount an open disclosure.
 */
export function workTimelineEntryKeys(entries: readonly KeyedWorkTimelineEntry[]): string[] {
  return uniqueKeys(entries, workTimelineEntryBaseKey);
}

/** Stable identities for nested sub-agent work rows for the same reason. */
export function agentWorkItemKeys(items: readonly AgentWorkItem[]): string[] {
  return uniqueKeys(items, agentWorkItemBaseKey);
}
