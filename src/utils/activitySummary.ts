import type { RunActivity } from "../../desktop/types.js";

const COMMAND_TOOL_PATTERN = /bash|shell|terminal|command|killshell/i;
const MAX_ACTIVITY_SUMMARY_LENGTH = 160;

function compactDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_ACTIVITY_SUMMARY_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_ACTIVITY_SUMMARY_LENGTH - 1)}…`;
}

/**
 * Prefer the model's human-readable command description in the compact
 * timeline row. The raw command remains in the activity input/result details.
 * Older persisted activities and tools without a description retain their
 * existing detail text.
 */
export function activitySummaryDetail(item: Pick<RunActivity, "data" | "detail" | "toolName" | "label">): string | undefined {
  const tool = `${item.toolName ?? ""} ${item.label ?? ""}`;
  if (COMMAND_TOOL_PATTERN.test(tool) && item.data) {
    try {
      const input = JSON.parse(item.data) as Record<string, unknown>;
      if (typeof input.description === "string" && input.description.trim()) {
        return compactDescription(input.description);
      }
    } catch {
      // Keep the original detail when an older activity has non-JSON data.
    }
  }
  return item.detail;
}
