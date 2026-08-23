import { describe, expect, it } from "vitest";
import type { AgentWorkItem, RunTimelineItem } from "../../desktop/types.js";
import { agentWorkItemKeys, workTimelineEntryKeys } from "./timelineEntryKeys.js";

describe("workTimelineEntryKeys", () => {
  it("keeps an activity row stable when the moving window trims an earlier row", () => {
    const first: RunTimelineItem = { type: "text", text: "Earlier narration", timestamp: 1 };
    const activity: RunTimelineItem = {
      type: "activity",
      label: "Using Edit",
      toolName: "Edit",
      toolUseId: "tool-42",
      timestamp: 2,
    };
    const later: RunTimelineItem = { type: "text", text: "Later narration", timestamp: 3 };

    expect(workTimelineEntryKeys([first, activity, later])[1]).toBe("activity:tool-42");
    expect(workTimelineEntryKeys([activity, later])[0]).toBe("activity:tool-42");
  });

  it("keeps an activity row stable when its streamed result arrives", () => {
    const pending: RunTimelineItem = {
      type: "activity",
      label: "Using Bash",
      toolName: "Bash",
      toolUseId: "tool-7",
      timestamp: 10,
    };
    const finished: RunTimelineItem = { ...pending, result: "done" };

    expect(workTimelineEntryKeys([pending])).toEqual(workTimelineEntryKeys([finished]));
  });

  it("keeps a sub-agent row stable when its provisional task id is replaced", () => {
    const provisional: RunTimelineItem = {
      type: "agent",
      agent: {
        taskId: "activity-10",
        toolUseId: "agent-tool-10",
        description: "Investigate",
        status: "running",
        startedAt: 10,
      },
      timestamp: 10,
    };
    const started: RunTimelineItem = {
      ...provisional,
      agent: { ...provisional.agent, taskId: "task-real-id" },
    };

    expect(workTimelineEntryKeys([provisional])).toEqual(workTimelineEntryKeys([started]));
  });

  it("keeps compaction rows stable when their status is upgraded", () => {
    const pending: RunTimelineItem = { type: "compaction", phase: "turn_boundary", status: "started", timestamp: 5 };
    const complete: RunTimelineItem = { ...pending, status: "complete", trigger: "manual" };

    expect(workTimelineEntryKeys([pending])).toEqual(["compaction:turn_boundary:5"]);
    expect(workTimelineEntryKeys([complete])).toEqual(["compaction:turn_boundary:5"]);
  });

  it("disambiguates legacy rows that share a timestamp without using their array position", () => {
    const duplicateRows: RunTimelineItem[] = [
      { type: "text", text: "one", timestamp: 5 },
      { type: "text", text: "two", timestamp: 5 },
    ];

    expect(workTimelineEntryKeys(duplicateRows)).toEqual(["text:5", "text:5:duplicate-1"]);
  });
});

describe("agentWorkItemKeys", () => {
  it("keeps an open tool row stable when older sub-agent work is trimmed", () => {
    const earlier: AgentWorkItem = { type: "text", text: "Earlier", timestamp: 1 };
    const tool: AgentWorkItem = {
      type: "activity",
      label: "Using Read",
      toolUseId: "agent-tool-3",
      timestamp: 2,
    };

    expect(agentWorkItemKeys([earlier, tool])[1]).toBe("agent-activity:agent-tool-3");
    expect(agentWorkItemKeys([tool])[0]).toBe("agent-activity:agent-tool-3");
  });
});
