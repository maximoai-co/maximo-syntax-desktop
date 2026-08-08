import type { RunTimelineItem } from "../../desktop/types.js";

export interface SplitLiveTimelineTail {
  settled: RunTimelineItem[];
  tailText: string;
}

/**
 * Keep completed narration interleaved with tool and agent rows, while
 * separating only the final text row that is still receiving token deltas.
 * This lets React update the growing Markdown tail without rebuilding the
 * settled chronological timeline on every stream flush.
 */
export function splitLiveTimelineTail(timeline: RunTimelineItem[]): SplitLiveTimelineTail {
  const last = timeline.at(-1);
  if (last?.type !== "text") return { settled: timeline, tailText: "" };
  return {
    settled: timeline.slice(0, -1),
    tailText: last.text,
  };
}
