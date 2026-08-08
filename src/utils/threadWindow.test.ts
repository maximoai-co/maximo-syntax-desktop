import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../desktop/types.js";
import { threadMessageWindow } from "./threadWindow.js";

function message(id: string, role: ChatMessage["role"], extras: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content: id, createdAt: Number(id.replace(/\D/g, "")) || 0, ...extras };
}

describe("threadMessageWindow", () => {
  it("slices history before render work", () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(`m${index}`, index % 2 ? "assistant" : "user"));
    const result = threadMessageWindow(messages, 40);
    expect(result.hiddenCount).toBe(60);
    expect(result.messages).toHaveLength(40);
    expect(result.messages[0]?.id).toBe("m60");
  });

  it("keeps interactions attached to an assistant at the window boundary", () => {
    const messages = [
      message("m1", "user"),
      message("m2", "assistant"),
      message("m3", "system", { interaction: { type: "permission", toolName: "Bash", decision: "approved" } }),
      message("m4", "system", { interaction: { type: "ask-user", questions: [{ question: "Continue?", answer: "Yes" }] } }),
      message("m5", "assistant"),
      message("m6", "user"),
    ];
    const result = threadMessageWindow(messages, 2);
    expect(result.hiddenCount).toBe(2);
    expect(result.messages.map((item) => item.id)).toEqual(["m3", "m4", "m5", "m6"]);
  });

  it("keeps a contiguous follow-up group intact", () => {
    const messages = [
      message("m1", "user"),
      message("m2", "assistant"),
      message("m3", "user", { kind: "follow-up" }),
      message("m4", "user", { kind: "follow-up" }),
      message("m5", "assistant"),
    ];
    const result = threadMessageWindow(messages, 1);
    expect(result.hiddenCount).toBe(2);
    expect(result.messages.map((item) => item.id)).toEqual(["m3", "m4", "m5"]);
  });
});
