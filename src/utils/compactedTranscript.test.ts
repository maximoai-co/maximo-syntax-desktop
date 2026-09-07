import { describe, expect, it } from "vitest";
import type { ChatMessage, RunTimelineItem } from "../../desktop/types.js";
import { transcriptAfterCompaction } from "./compactedTranscript.js";

function user(id: string, createdAt: number): ChatMessage {
  return { id, role: "user", content: id, createdAt };
}

function assistant(id: string, createdAt: number, timeline?: RunTimelineItem[]): ChatMessage {
  return { id, role: "assistant", content: id, createdAt, ...(timeline ? { timeline } : {}) };
}

describe("transcriptAfterCompaction", () => {
  it("keeps the full transcript when nothing has been compacted", () => {
    const messages = [user("u1", 1), assistant("a1", 2), user("u2", 3), assistant("a2", 4)];
    const result = transcriptAfterCompaction(messages);
    expect(result.compactHiddenCount).toBe(0);
    expect(result.messages).toHaveLength(4);
  });

  it("hides messages before the last three user turns once compact completes", () => {
    const compact: RunTimelineItem = { type: "compaction", phase: "turn_boundary", status: "complete", trigger: "auto", timestamp: 12 };
    const messages = [
      user("u1", 1), assistant("a1", 2),
      user("u2", 3), assistant("a2", 4),
      user("u3", 5), assistant("a3", 6),
      user("u4", 7), assistant("a4", 8),
      user("u5", 9), assistant("a5", 10, [compact]),
    ];
    const result = transcriptAfterCompaction(messages);
    expect(result.compactHiddenCount).toBe(4);
    expect(result.messages.map((message) => message.id)).toEqual(["u3", "a3", "u4", "a4", "u5", "a5"]);
    expect(result.compactEntry?.status).toBe("complete");
  });

  it("uses a live compact marker when the current turn has not been saved yet", () => {
    const messages = [
      user("u1", 1), assistant("a1", 2),
      user("u2", 3), assistant("a2", 4),
      user("u3", 5), assistant("a3", 6),
      user("u4", 7),
    ];
    const live: RunTimelineItem[] = [{ type: "compaction", phase: "turn_boundary", status: "complete", trigger: "auto", timestamp: 20 }];
    const result = transcriptAfterCompaction(messages, live);
    expect(result.messages.map((message) => message.id)).toEqual(["u2", "a2", "u3", "a3", "u4"]);
    expect(result.compactHiddenCount).toBe(2);
  });
});
