import { describe, expect, it } from "vitest";
import type { RunTimelineItem } from "../../desktop/types.js";
import { splitLiveTimelineTail } from "./liveTimeline.js";

describe("splitLiveTimelineTail", () => {
  it("preserves completed narration in chronological order and isolates only the growing tail", () => {
    const timeline: RunTimelineItem[] = [
      { type: "text", text: "First explanation", timestamp: 1 },
      { type: "activity", label: "Read file", timestamp: 2 },
      { type: "text", text: "Newest partial answer", timestamp: 3 },
    ];

    const result = splitLiveTimelineTail(timeline);

    expect(result.settled).toEqual(timeline.slice(0, 2));
    expect(result.tailText).toBe("Newest partial answer");
  });

  it("returns the original timeline identity when the last row is not text", () => {
    const timeline: RunTimelineItem[] = [
      { type: "text", text: "Explanation before tool", timestamp: 1 },
      { type: "activity", label: "Run command", timestamp: 2 },
    ];

    const result = splitLiveTimelineTail(timeline);

    expect(result.settled).toBe(timeline);
    expect(result.tailText).toBe("");
  });

  it("handles an empty timeline", () => {
    const timeline: RunTimelineItem[] = [];
    const result = splitLiveTimelineTail(timeline);
    expect(result.settled).toBe(timeline);
    expect(result.tailText).toBe("");
  });
});
