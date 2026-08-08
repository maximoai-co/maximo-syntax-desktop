import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCliArguments, buildPrompt, buildUnifiedPatch, clearStatusActivity, CliRunner, parseClassifierDenial, parseCliMessage, parseTodoItems, restoreFilesFromChanges, reverseApplyUnifiedPatch } from "./cli-runner.js";
import type { RunTimelineItem } from "./types.js";

describe("buildPrompt", () => {
  it("marks attached paths so the CLI processes their real contents", () => {
    expect(buildPrompt({
      threadId: "thread-attachments",
      prompt: "summarize these files",
      attachments: [{ name: "report.pdf", path: "/tmp/report with spaces.pdf", size: 10 }],
      model: "",
      effort: "",
      permission: "default",
    })).toContain('- @"/tmp/report with spaces.pdf"');
  });

  it("keeps the CLI attachment ceiling", () => {
    const attachments = Array.from({ length: 11 }, (_, index) => ({
      name: `file-${index}.txt`,
      path: `/tmp/file-${index}.txt`,
      size: 1,
    }));
    const prompt = buildPrompt({
      threadId: "thread-attachment-limit",
      prompt: "inspect these files",
      attachments,
      model: "",
      effort: "",
      permission: "default",
    });
    expect(prompt).toContain('@"/tmp/file-9.txt"');
    expect(prompt).not.toContain('@"/tmp/file-10.txt"');
  });
});

describe("parseCliMessage", () => {
  it("forwards a selected reasoning effort to the CLI", () => {
    const args = buildCliArguments({
      threadId: "thread-effort",
      prompt: "test",
      attachments: [],
      model: "deepseek-v4-flash",
      effort: "medium",
      permission: "default",
    });
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--effort") + 1]).toBe("medium");
  });

  it("exposes additional project folders to the CLI", () => {
    const args = buildCliArguments({
      threadId: "thread-folders",
      prompt: "inspect the workspace",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
      additionalDirectories: ["/tmp/shared", "/tmp/docs"],
    });
    const index = args.indexOf("--add-dir");
    expect(args.slice(index, index + 3)).toEqual(["--add-dir", "/tmp/shared", "/tmp/docs"]);
  });

  it("injects the Maximo-owned browser bridge without replacing other CLI tools", () => {
    const args = buildCliArguments({
      threadId: "thread-browser",
      prompt: "open the docs",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
    }, undefined, {
      command: "/tmp/maximo-browser-node",
      args: ["/tmp/browser-mcp-bridge.js"],
      env: {
        MAXIMO_BROWSER_HOST_PIPE: "/tmp/browser.sock",
        MAXIMO_BROWSER_HOST_CAPABILITY: "capability",
      },
    });
    const index = args.indexOf("--mcp-config");
    expect(index).toBeGreaterThan(-1);
    const config = JSON.parse(args[index + 1]!);
    expect(config.mcpServers["maximo-browser"]).toMatchObject({
      type: "stdio",
      command: "/tmp/maximo-browser-node",
      args: ["/tmp/browser-mcp-bridge.js"],
    });
    expect(config.mcpServers["maximo-browser"].env).toEqual({
      MAXIMO_BROWSER_HOST_PIPE: "${MAXIMO_BROWSER_HOST_PIPE}",
      MAXIMO_BROWSER_HOST_CAPABILITY: "${MAXIMO_BROWSER_HOST_CAPABILITY}",
    });
  });

  it("routes interactive permission requests through stdio and resumes follow-ups", () => {
    const args = buildCliArguments({
      threadId: "thread-1",
      prompt: "test",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
    }, "session-1");
    const promptToolIndex = args.indexOf("--permission-prompt-tool");
    expect(args.slice(promptToolIndex, promptToolIndex + 2)).toEqual(["--permission-prompt-tool", "stdio"]);
    expect(args.slice(-2)).toEqual(["--resume", "session-1"]);
  });

  it("forks a truncated session for edit-and-resend / revert anchors", () => {
    const args = buildCliArguments({
      threadId: "thread-edit",
      prompt: "edited request",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
      resumeSessionAt: "anchor-uuid",
    }, "session-edit");
    expect(args).toContain("--resume-session-at");
    expect(args[args.indexOf("--resume-session-at") + 1]).toBe("anchor-uuid");
    expect(args).toContain("--fork-session");
  });

  it("does not fork when no truncation anchor is set", () => {
    const args = buildCliArguments({
      threadId: "thread-plain",
      prompt: "plain",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
    }, "session-plain");
    expect(args).not.toContain("--fork-session");
    expect(args).not.toContain("--resume-session-at");
  });

  it("parses a successful rewind_files control_response", () => {
    const parsed = parseCliMessage({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "rewind-1",
        response: { canRewind: true, filesChanged: ["/tmp/a.ts", "/tmp/b.ts"], insertions: 12, deletions: 4 },
      },
    });
    expect(parsed.rewindRequestId).toBe("rewind-1");
    expect(parsed.rewindResult).toMatchObject({ canRewind: true, filesChanged: ["/tmp/a.ts", "/tmp/b.ts"], insertions: 12, deletions: 4 });
  });

  it("parses a failed rewind_files control_response", () => {
    const parsed = parseCliMessage({
      type: "control_response",
      response: { subtype: "error", request_id: "rewind-2", error: "No file checkpoint found for this message." },
    });
    expect(parsed.rewindRequestId).toBe("rewind-2");
    expect(parsed.rewindResult).toMatchObject({ canRewind: false, error: "No file checkpoint found for this message." });
  });

  it("reads streamed text deltas", () => {
    expect(parseCliMessage({
      type: "stream_event",
      session_id: "session-1",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
    })).toEqual({ sessionId: "session-1", text: "Hello", textMode: "append" });
  });

  it("reads usage from the final streamed message delta", () => {
    expect(parseCliMessage({
      type: "stream_event",
      session_id: "session-usage",
      event: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 250, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    })).toMatchObject({
      sessionId: "session-usage",
      apiUsage: { input_tokens: 250, output_tokens: 20 },
    });
    expect(parseCliMessage({
      type: "stream_event",
      event: { type: "message_start", message: { usage: { input_tokens: 250, output_tokens: 0 } } },
    })).toMatchObject({ apiUsageDelta: { input_tokens: 250 }, apiUsageReset: true });
  });

  it("reads final assistant text", () => {
    expect(parseCliMessage({
      type: "assistant",
      message: { content: [{ type: "text", text: "Finished." }] },
    })).toMatchObject({ text: "Finished.", textMode: "replace" });
  });

  it("summarizes tool activity and preserves expandable input", () => {
    const parsed = parseCliMessage({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/tmp/app.ts" } }] },
    });
    expect(parsed.activities?.[0]).toMatchObject({ activity: "Using Read", detail: "/tmp/app.ts", toolName: "Read" });
    expect(parsed.activities?.[0]?.data).toContain('"file_path": "/tmp/app.ts"');
  });

  it("preserves multiple tool calls in assistant order", () => {
    const parsed = parseCliMessage({
      type: "assistant",
      message: { content: [
        { type: "tool_use", id: "tool-read", name: "Read", input: { file_path: "src/a.ts" } },
        { type: "tool_use", id: "tool-edit", name: "Edit", input: { file_path: "src/b.ts" } },
      ] },
    });
    expect(parsed.activities?.map((item) => [item.toolUseId, item.toolName])).toEqual([
      ["tool-read", "Read"],
      ["tool-edit", "Edit"],
    ]);
  });

  it("links tool results back to their tool use", () => {
    expect(parseCliMessage({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-edit", content: "Updated file", is_error: false }] },
    }).toolResults).toEqual([{ toolUseId: "tool-edit", result: "Updated file", isError: false }]);
  });

  it("preserves the full slash command catalog, including skill names", () => {
    const commands = ["/compact", "frontend-design", "plugin:review-pr", "custom:deploy", "mcp__server__prompt"];
    expect(parseCliMessage({ type: "system", subtype: "init", session_id: "session-2", slash_commands: commands })).toEqual({
      sessionId: "session-2",
      commands: commands.map((name) => ({ name: name.replace(/^\//, "") })),
    });
  });

  it("carries the skill catalog separately when the CLI reports skills", () => {
    expect(parseCliMessage({
      type: "system",
      subtype: "init",
      session_id: "session-3",
      slash_commands: ["/compact", "frontend-design"],
      skills: ["frontend-design", "write-maximo-founder-tweets"],
    })).toEqual({
      sessionId: "session-3",
      commands: [{ name: "compact" }, { name: "frontend-design" }],
      skills: [{ name: "frontend-design" }, { name: "write-maximo-founder-tweets" }],
    });
  });

  it("omits the skills field when the CLI reports none", () => {
    expect(parseCliMessage({ type: "system", subtype: "init", session_id: "session-4", slash_commands: ["/clear"], skills: [] })).toEqual({
      sessionId: "session-4",
      commands: [{ name: "clear" }],
    });
  });

  it("reads structured failures", () => {
    expect(parseCliMessage({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["No credentials"] }))
      .toMatchObject({ result: "No credentials", isError: true });
  });

  it("surfaces provider retry notices without treating them as final failures", () => {
    expect(parseCliMessage({
      type: "system",
      subtype: "api_retry",
      session_id: "session-retry",
      attempt: 2,
      max_retries: 3,
      retry_delay_ms: 1_600,
      error_status: null,
      error: "unknown",
    })).toEqual({
      sessionId: "session-retry",
      retrying: { attempt: 2, max: 3, delayMs: 1_600, message: "Connection issue" },
    });
  });

  it("summarizes retry errors from the older nested API error shape", () => {
    expect(parseCliMessage({
      type: "system",
      subtype: "api_error",
      retryAttempt: 1,
      maxRetries: 3,
      retryInMs: 800,
      error: { status: 503, error: { type: "server_error", message: "Service unavailable" } },
    }).retrying).toEqual({ attempt: 1, max: 3, delayMs: 800, message: "Service unavailable" });
  });

  it("reads the CLI context usage control response", () => {
    const parsed = parseCliMessage({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "context-request-1",
        response: {
          categories: [
            { name: "System prompt", tokens: 1_200, color: "promptBorder" },
            { name: "Free space", tokens: 98_800, color: "promptBorder" },
          ],
          totalTokens: 1_200,
          maxTokens: 100_000,
          rawMaxTokens: 100_000,
          percentage: 1,
          model: "maximo-atlas",
          autoCompactThreshold: 90_000,
          isAutoCompactEnabled: true,
          apiUsage: { input_tokens: 1_200, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    });
    expect(parsed.contextRequestId).toBe("context-request-1");
    expect(parsed.contextUsage).toMatchObject({ totalTokens: 1_200, rawMaxTokens: 100_000, percentage: 1, model: "maximo-atlas" });
    expect(parsed.contextUsage?.categories).toHaveLength(2);
  });

  it("reads stdio permission control requests", () => {
    expect(parseCliMessage({
      type: "control_request",
      request_id: "request-1",
      request: { subtype: "can_use_tool", tool_name: "Write", tool_use_id: "tool-1", input: { file_path: "test.txt", content: "ok" } },
    })).toMatchObject({
      requestId: "request-1",
      toolName: "Write",
      toolUseId: "tool-1",
      interactive: "permission",
      detail: "test.txt",
    });
  });

  it("routes AskUserQuestion control requests as questions", () => {
    expect(parseCliMessage({
      type: "control_request",
      request_id: "request-question-1",
      request: {
        subtype: "can_use_tool",
        tool_name: "AskUserQuestion",
        tool_use_id: "tool-question-1",
        input: { questions: [{ question: "Pick one", options: [{ label: "A" }] }] },
      },
    })).toMatchObject({
      requestId: "request-question-1",
      toolName: "AskUserQuestion",
      interactive: "question",
    });
  });

  it("reads auto-mode classifier decisions from stream-json system events", () => {
    expect(parseCliMessage({
      type: "system",
      subtype: "classifier_decision",
      session_id: "session-3",
      tool_use_id: "tool-bash-1",
      tool_name: "Bash",
      decision: "allowed",
      classifier: "auto-mode",
      reason: "Read-only listing is safe",
    })).toEqual({
      sessionId: "session-3",
      classifierDecision: {
        toolUseId: "tool-bash-1",
        toolName: "Bash",
        decision: "allowed",
        classifier: "auto-mode",
        reason: "Read-only listing is safe",
      },
    });
  });

  it("marks tool results that were denied by the auto-mode classifier", () => {
    const denied = "Permission for this action has been denied. Reason: Destructive rm outside project. Prefer built-in tools…";
    expect(parseCliMessage({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-deny-1", content: denied, is_error: true }] },
    }).toolResults).toEqual([{
      toolUseId: "tool-deny-1",
      result: denied,
      isError: true,
      classifierDecision: { decision: "denied", classifier: "auto-mode", reason: "Destructive rm outside project" },
    }]);
  });

  it("parses classifier denial reasons from tool result text", () => {
    expect(parseClassifierDenial("Permission for this action has been denied. Reason: Network call looks unsafe. Continue elsewhere.")).toEqual({
      decision: "denied",
      classifier: "auto-mode",
      reason: "Network call looks unsafe",
    });
    expect(parseClassifierDenial("some other error")).toBeUndefined();
  });

  it("reads Maximo sub-agent start and progress events", () => {
    expect(parseCliMessage({
      type: "system",
      subtype: "task_started",
      session_id: "session-agent",
      task_id: "agent-1",
      tool_use_id: "tool-agent-1",
      task_type: "local_agent",
      description: "Inspect the API",
    })).toEqual({
      sessionId: "session-agent",
      agentStarted: { taskId: "agent-1", toolUseId: "tool-agent-1", description: "Inspect the API", taskType: "local_agent" },
    });
    expect(parseCliMessage({
      type: "system",
      subtype: "task_progress",
      task_id: "agent-1",
      tool_use_id: "tool-agent-1",
      description: "Reading source files",
      last_tool_name: "Read",
      usage: { total_tokens: 120, tool_uses: 3, duration_ms: 850 },
    }).agentProgress).toEqual({
      taskId: "agent-1",
      toolUseId: "tool-agent-1",
      description: "Reading source files",
      lastToolName: "Read",
      usage: { totalTokens: 120, toolUses: 3, durationMs: 850 },
    });
  });

  it("keeps nested sub-agent text and tool calls attached to their parent tool use", () => {
    expect(parseCliMessage({
      type: "assistant",
      parent_tool_use_id: "tool-agent-1",
      message: { content: [
        { type: "text", text: "I am inspecting the project." },
        { type: "tool_use", id: "tool-child-1", name: "Read", input: { file_path: "src/App.tsx" } },
      ] },
    })).toMatchObject({
      parentToolUseId: "tool-agent-1",
      text: "I am inspecting the project.",
      textMode: "replace",
      activities: [{ toolUseId: "tool-child-1", toolName: "Read" }],
    });
    expect(parseCliMessage({
      type: "user",
      parent_tool_use_id: "tool-agent-1",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-child-1", content: "file contents", is_error: false }] },
    })).toMatchObject({ parentToolUseId: "tool-agent-1", toolResults: [{ toolUseId: "tool-child-1", result: "file contents" }] });
    expect(parseCliMessage({
      type: "progress",
      parentToolUseID: "tool-agent-1",
      data: {
        type: "agent_progress",
        agentId: "agent-1",
        message: { type: "assistant", message: { content: [{ type: "text", text: "Still checking." }] } },
      },
    })).toMatchObject({ parentToolUseId: "tool-agent-1", text: "Still checking.", textMode: "replace" });
  });

  it("maps Maximo sub-agent terminal states to desktop statuses", () => {
    expect(parseCliMessage({
      type: "system",
      subtype: "task_notification",
      task_id: "agent-2",
      status: "failed",
      summary: "Could not inspect the API",
      output_file: "/tmp/agent-2.txt",
      usage: { total_tokens: 20, tool_uses: 1, duration_ms: 90 },
    }).agentFinished).toEqual({
      taskId: "agent-2",
      status: "error",
      summary: "Could not inspect the API",
      outputFile: "/tmp/agent-2.txt",
      usage: { totalTokens: 20, toolUses: 1, durationMs: 90 },
    });
  });

  it("maps an active SDK status (compacting) to a status activity", () => {
    expect(parseCliMessage({ type: "system", subtype: "status", session_id: "session-5", status: "compacting" }))
      .toEqual({ sessionId: "session-5", activity: "compacting" });
  });

  it("surfaces a cleared SDK status (compaction finished) as status null", () => {
    expect(parseCliMessage({ type: "system", subtype: "status", session_id: "session-6", status: null }))
      .toEqual({ sessionId: "session-6", status: null });
  });
});

describe("clearStatusActivity", () => {
  const compactingActivity = (timestamp: number) => ({ label: "compacting", timestamp });

  it("removes the compacting status activity from activity and timeline when it clears", () => {
    const turn = {
      activity: [
        compactingActivity(100),
        { label: "Using Read", timestamp: 110 },
      ],
      timeline: [
        { type: "activity", label: "compacting", timestamp: 100 },
        { type: "activity", label: "Using Read", timestamp: 110 },
        { type: "text", text: "Answer", timestamp: 120 },
      ],
    };
    expect(clearStatusActivity(turn)).toBe(true);
    expect(turn.activity.map((item) => item.label)).toEqual(["Using Read"]);
    expect(turn.timeline.map((item) => (item.type === "activity" ? item.label : item.text))).toEqual(["Using Read", "Answer"]);
  });

  it("reports false when no compacting status activity exists", () => {
    const turn = { activity: [{ label: "Using Read", timestamp: 110 }], timeline: [] };
    expect(clearStatusActivity(turn)).toBe(false);
    expect(turn.activity).toHaveLength(1);
  });
});

describe("TodoWrite parsing", () => {
  it("extracts valid checklist items from tool input", () => {
    expect(parseTodoItems({ todos: [
      { content: "Inspect the app", status: "completed", activeForm: "Inspecting the app" },
      { content: "Add the checklist UI", status: "in_progress" },
      { content: "Run tests", status: "pending" },
    ] })).toEqual([
      { content: "Inspect the app", status: "completed", activeForm: "Inspecting the app" },
      { content: "Add the checklist UI", status: "in_progress" },
      { content: "Run tests", status: "pending" },
    ]);
  });

  it("ignores malformed checklist entries", () => {
    expect(parseTodoItems({ todos: [{ content: "", status: "pending" }, { content: "Unknown", status: "blocked" }, null] })).toBeUndefined();
  });
});

describe("unified patches", () => {
  it("builds a focused patch for a file edit", () => {
    const change = buildUnifiedPatch("src/example.ts", "const answer = 41;\nkeep();\n", "const answer = 42;\nkeep();\n");
    expect(change).toMatchObject({ path: "src/example.ts", additions: 1, deletions: 1 });
    expect(change.patch).toContain("@@ -1,2 +1,2 @@");
    expect(change.patch).toContain("-const answer = 41;");
    expect(change.patch).toContain("+const answer = 42;");
  });

  it("builds a patch for a newly created file", () => {
    const change = buildUnifiedPatch("test.txt", "", "first line\nsecond line\n");
    expect(change).toMatchObject({ path: "test.txt", additions: 2, deletions: 0 });
    expect(change.patch).toContain("@@ -0,0 +1,2 @@");
    expect(change.patch).toContain("+first line");
  });

  it("reverse-applies an edit back to the original content", () => {
    const before = "const answer = 41;\nkeep();\n";
    const after = "const answer = 42;\nkeep();\n";
    const change = buildUnifiedPatch("src/example.ts", before, after);
    expect(reverseApplyUnifiedPatch(after, change.patch)).toBe(before);
  });

  it("reverse-applies a create patch by deleting the file content", () => {
    const after = "first line\nsecond line\n";
    const change = buildUnifiedPatch("test.txt", "", after);
    expect(reverseApplyUnifiedPatch(after, change.patch)).toBeNull();
  });

  it("reverse-applies a delete patch by recreating the file", () => {
    const before = "only line\n";
    const change = buildUnifiedPatch("gone.txt", before, "");
    expect(reverseApplyUnifiedPatch("", change.patch)).toBe(before);
  });

  it("restores files on disk from tracked changes newest-first", () => {
    const directory = mkdtempSync(join(tmpdir(), "maximo-restore-"));
    try {
      const path = "note.txt";
      const absolute = join(directory, path);
      writeFileSync(absolute, "v1\n", "utf8");
      const first = buildUnifiedPatch(path, "v1\n", "v2\n");
      writeFileSync(absolute, "v2\n", "utf8");
      const second = buildUnifiedPatch(path, "v2\n", "v3\n");
      writeFileSync(absolute, "v3\n", "utf8");

      // Newest-first unwind: v3→v2 then v2→v1.
      const restored = restoreFilesFromChanges(directory, [second, first]);
      expect(restored).toEqual([path]);
      expect(readFileSync(absolute, "utf8")).toBe("v1\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("deletes a file that was created in a discarded turn", () => {
    const directory = mkdtempSync(join(tmpdir(), "maximo-restore-create-"));
    try {
      const path = "created.txt";
      const absolute = join(directory, path);
      const content = "brand new\n";
      writeFileSync(absolute, content, "utf8");
      const change = buildUnifiedPatch(path, "", content);
      const restored = restoreFilesFromChanges(directory, [change]);
      expect(restored).toEqual([path]);
      expect(() => readFileSync(absolute, "utf8")).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("CliRunner completion lifecycle", () => {
  it("coalesces streamed append deltas without resending the full answer", async () => {
    const runner = new CliRunner();
    const textEvents: Array<{ text: string; mode: "append" | "replace" }> = [];
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const messages = [
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } }, session_id: "session-stream" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " world" } }, session_id: "session-stream" },
      { type: "result", subtype: "success", result: "Hello world", is_error: false, session_id: "session-stream" },
    ];
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));for(const item of ${JSON.stringify(messages)})process.stdout.write(JSON.stringify(item)+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-stream", prompt: "test", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "text") textEvents.push({ text: event.text, mode: event.mode });
        if (event.type === "turn-complete") resolveDone?.();
      },
      onComplete: async () => undefined,
    });
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Stream never completed")), 3_000))]);
    expect(textEvents).toEqual([{ text: "Hello world", mode: "append" }]);
    runner.stop("thread-stream");
  });

  it("keeps replace-plus-append stream batches exact", async () => {
    const runner = new CliRunner();
    const textEvents: Array<{ text: string; mode: "append" | "replace" }> = [];
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const messages = [
      { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] }, session_id: "session-replace-stream" },
      { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " world" } }, session_id: "session-replace-stream" },
      { type: "result", subtype: "success", result: "Hello world", is_error: false, session_id: "session-replace-stream" },
    ];
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));for(const item of ${JSON.stringify(messages)})process.stdout.write(JSON.stringify(item)+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-replace-stream", prompt: "test", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "text") textEvents.push({ text: event.text, mode: event.mode });
        if (event.type === "turn-complete") resolveDone?.();
      },
      onComplete: async () => undefined,
    });
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Replace stream never completed")), 3_000))]);
    expect(textEvents).toEqual([{ text: "Hello world", mode: "replace" }]);
    runner.stop("thread-replace-stream");
  });

  it("finishes a turn on the result event, keeps the process alive, and finalizes on close", async () => {
    const runner = new CliRunner();
    const sequence: string[] = [];
    let resolveFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    // Writes a result, then waits for stdin to end before exiting (process stays alive between turns).
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"Done.",is_error:false,session_id:"session-result"})+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-result",
      prompt: "test",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "turn-complete") { sequence.push("finished"); resolveFinished?.(); }
        if (event.type === "finished") { sequence.push("closed"); }
      },
      onComplete: async (result) => {
        expect(result.content).toBe("Done.");
        expect(result.status).toBe("complete");
        sequence.push("persisted");
      },
    });
    expect(runner.isTurnActive("thread-result")).toBe(true);
    await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("Runner did not finish")), 3_000))]);
    expect(sequence).toEqual(["persisted", "finished"]);
    // The process stays alive for follow-ups; only closing it finalizes the run.
    expect(runner.isRunning("thread-result")).toBe(true);
    expect(runner.isTurnActive("thread-result")).toBe(false);
    runner.stop("thread-result");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runner.isRunning("thread-result")).toBe(false);
    expect(sequence).toContain("closed");
  });

  it("forwards and persists the Maximo sub-agent lifecycle", async () => {
    const runner = new CliRunner();
    const lifecycle: string[] = [];
    let completedTimeline: Array<{ type: string; agent?: { status: string; taskId: string } }> = [];
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const messages = [
      { type: "system", subtype: "task_started", task_id: "agent-lifecycle", tool_use_id: "tool-agent-lifecycle", task_type: "local_agent", description: "Inspect project" },
      { type: "system", subtype: "task_progress", task_id: "agent-lifecycle", tool_use_id: "tool-agent-lifecycle", description: "Reading files", last_tool_name: "Read", usage: { tool_uses: 2, duration_ms: 40 } },
      { type: "system", subtype: "task_notification", task_id: "agent-lifecycle", tool_use_id: "tool-agent-lifecycle", status: "completed", summary: "Inspect project", usage: { tool_uses: 2, duration_ms: 60 } },
      { type: "result", subtype: "success", result: "Done.", is_error: false, session_id: "session-agent-lifecycle" },
    ];
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));for(const item of ${JSON.stringify(messages)})process.stdout.write(JSON.stringify(item)+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-agent-lifecycle", prompt: "test", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "agent-started") lifecycle.push("started");
        if (event.type === "agent-progress") lifecycle.push("progress");
        if (event.type === "agent-finished") lifecycle.push(`finished:${event.status}`);
        if (event.type === "turn-complete") resolveDone?.();
      },
      onComplete: async (result) => { completedTimeline = result.timeline.flatMap((item) => item.type === "agent" ? [{ type: item.type, agent: { status: item.agent.status, taskId: item.agent.taskId } }] : []); },
    });
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Agent lifecycle did not finish")), 3_000))]);
    expect(lifecycle).toEqual(["started", "progress", "finished:completed"]);
    expect(completedTimeline).toEqual([{ type: "agent", agent: { status: "completed", taskId: "agent-lifecycle" } }]);
    runner.stop("thread-agent-lifecycle");
  });

  it("keeps a sub-agent's child work inside its inline timeline item", async () => {
    const runner = new CliRunner();
    let agentTimeline: RunTimelineItem | undefined;
    let completedTimeline: RunTimelineItem[] = [];
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    const messages = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "tool-agent-nested", name: "Agent", input: { description: "Inspect project", prompt: "Read the source", subagent_type: "general-purpose" } }] } },
      { type: "system", subtype: "task_started", task_id: "agent-nested", tool_use_id: "tool-agent-nested", task_type: "local_agent", description: "Inspect project" },
      { type: "progress", parentToolUseID: "tool-agent-nested", data: { type: "agent_progress", agentId: "agent-nested", message: { type: "assistant", message: { content: [
        { type: "text", text: "I found the entry point." },
        { type: "tool_use", id: "tool-child-read", name: "Read", input: { file_path: "src/App.tsx" } },
      ] } } } },
      { type: "progress", parentToolUseID: "tool-agent-nested", data: { type: "agent_progress", agentId: "agent-nested", message: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-child-read", content: "source", is_error: false }] } } } },
      { type: "system", subtype: "task_notification", task_id: "agent-nested", tool_use_id: "tool-agent-nested", status: "completed", summary: "Inspect project" },
      { type: "result", subtype: "success", result: "Finished.", is_error: false, session_id: "session-agent-nested" },
    ];
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));for(const item of ${JSON.stringify(messages)})process.stdout.write(JSON.stringify(item)+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-agent-nested", prompt: "test", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => { if (event.type === "turn-complete") resolveDone?.(); },
      onComplete: async (result) => { completedTimeline = result.timeline; agentTimeline = result.timeline.find((item) => item.type === "agent"); },
    });
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Nested agent work did not finish")), 3_000))]);
    expect(agentTimeline?.type).toBe("agent");
    expect(completedTimeline.some((item) => item.type === "activity" && item.toolName === "Read")).toBe(false);
    if (agentTimeline?.type === "agent") {
      expect(agentTimeline.agent.work?.map((item) => item.type)).toEqual(["text", "activity"]);
      expect(agentTimeline.agent.work?.find((item) => item.type === "activity")?.toolName).toBe("Read");
      expect(agentTimeline.agent.work?.find((item) => item.type === "activity")?.result).toBe("source");
    }
    runner.stop("thread-agent-nested");
  });

  it("falls back to a new turn when a queued follow-up has no tool boundary", async () => {
    const runner = new CliRunner();
    const received: string[] = [];
    const results: string[] = [];
    const turnStarts: string[] = [];
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    // Echoes each user message back with a delay, keeping stdin open so the child can be reused.
    const script = `process.stdin.setEncoding("utf8");let buffer="";process.stdin.on("data",(chunk)=>{buffer+=chunk;while(buffer.includes("\\n")){const line=buffer.slice(0,buffer.indexOf("\\n"));buffer=buffer.slice(buffer.indexOf("\\n")+1);const msg=JSON.parse(line);setTimeout(()=>{process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"answer:"+msg.message.content,is_error:false,session_id:"session-queued"})+"\\n");},80);}});process.stdin.on("end",()=>process.exit(0));`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-queued", prompt: "first", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "turn-started" && event.threadId === "thread-queued") turnStarts.push(`start:${received.length}`);
        if (event.type === "turn-complete" && results.length === 3) resolveDone?.();
      },
      onComplete: async (result) => { received.push(result.content); results.push(result.content); },
    });
    // Let turn 1 start, then queue two follow-ups while it is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.send("thread-queued", "second", [])).toBe(true);
    expect(runner.send("thread-queued", "third", [])).toBe(true);
    // Turn 1 still has ~50ms of echo delay left, so the follow-ups must not be dispatched yet.
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Turn 1 is still active: the follow-ups must not have been dispatched yet.
    expect(turnStarts).toEqual(["start:0"]);
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("Queued follow-ups never finished")), 3_000))]);
    expect(received).toEqual(["answer:first", "answer:second", "answer:third"]);
    runner.stop("thread-queued");
  });

  it("injects a queued follow-up after a tool result before the next model result", async () => {
    const runner = new CliRunner();
    let completedContent = "";
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => { resolveDone = resolve; });
    // The fake engine emits a tool result, then waits for the queued prompt.
    // If the runner waits for the final result, this script intentionally deadlocks.
    const script = `process.stdin.setEncoding("utf8");let buffer="";let phase=0;process.stdin.on("data",(chunk)=>{buffer+=chunk;while(buffer.includes("\\n")){const line=buffer.slice(0,buffer.indexOf("\\n"));buffer=buffer.slice(buffer.indexOf("\\n")+1);const msg=JSON.parse(line);const content=msg.message&&msg.message.content;if(phase===0&&content==="first"){phase=1;setTimeout(()=>{process.stdout.write(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"tool-1",name:"Read",input:{file_path:"test.txt"}}]}})+"\\n");setTimeout(()=>{process.stdout.write(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"tool-1",content:"file contents",is_error:false}]}})+"\\n");},20);},20);}else if(phase===1&&content==="second"){phase=2;process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"answer:"+content,is_error:false,session_id:"session-in-turn"})+"\\n");}}});process.stdin.on("end",()=>process.exit(0));`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-in-turn", prompt: "first", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => { if (event.type === "turn-complete") resolveDone?.(); },
      onComplete: async (result) => { completedContent = result.content; },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.send("thread-in-turn", "second", [])).toBe(true);
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("In-turn follow-up was not injected")), 3_000))]);
    expect(completedContent).toBe("answer:second");
    runner.stop("thread-in-turn");
  });

  it("accepts a follow-up message while the same child is still running", async () => {
    const runner = new CliRunner();
    const results: string[] = [];
    let resolveSecondTurn: (() => void) | undefined;
    const secondTurn = new Promise<void>((resolve) => { resolveSecondTurn = resolve; });
    const script = `process.stdin.setEncoding("utf8");let buffer="";process.stdin.on("data",(chunk)=>{buffer+=chunk;while(buffer.includes("\\n")){const line=buffer.slice(0,buffer.indexOf("\\n"));buffer=buffer.slice(buffer.indexOf("\\n")+1);const msg=JSON.parse(line);process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:msg.message.content,is_error:false,session_id:"session-follow-up"})+"\\n");}});process.stdin.on("end",()=>process.exit(0));`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-follow-up", prompt: "first", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => { if (event.type === "turn-complete" && results.length === 2) resolveSecondTurn?.(); },
      onComplete: async (result) => { if (result.content) results.push(result.content); },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runner.send("thread-follow-up", "second", [])).toBe(true);
    await Promise.race([secondTurn, new Promise((_, reject) => setTimeout(() => reject(new Error("Follow-up result did not arrive")), 3_000))]);
    expect(results).toEqual(["first", "second"]);
    runner.stop("thread-follow-up");
  });

  it("holds queued follow-ups while the engine is awaiting a user response", async () => {
    const runner = new CliRunner();
    const received: string[] = [];
    const turnStarts: string[] = [];
    // Holds the first user message open (never echoes it), keeping stdin open so the child can be reused.
    const script = `process.stdin.setEncoding("utf8");process.stdin.resume();let buffer="";process.stdin.on("data",(chunk)=>{buffer+=chunk;while(buffer.includes("\\n")){const line=buffer.slice(0,buffer.indexOf("\\n"));buffer=buffer.slice(buffer.indexOf("\\n")+1);const msg=JSON.parse(line);if(msg.message&&msg.message.content==="second"){setTimeout(()=>{process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"answer:second",is_error:false,session_id:"session-held"})+"\\n");},30);}}});process.stdin.on("end",()=>process.exit(0));`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-held", prompt: "first", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "turn-started" && event.threadId === "thread-held") turnStarts.push(`start:${received.length}`);
      },
      onComplete: async (result) => { received.push(result.content); },
    });
    // Let turn 1 start (it never completes), then queue a follow-up while the engine is mid-turn.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.send("thread-held", "second", [])).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The engine is still awaiting input; the queued follow-up must not have been dispatched.
    expect(turnStarts).toEqual(["start:0"]);
    expect(received).toEqual([]);
    runner.stop("thread-held");
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it("completes exactly once when the final result line has no trailing newline", async () => {
    const runner = new CliRunner();
    const sequence: string[] = [];
    let resolveFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    // No trailing newline on the result line: it stays in the internal buffer until close.
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"Final answer",is_error:false,session_id:"session-no-newline"}));`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-no-newline",
      prompt: "test",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "turn-complete") { sequence.push("finished"); resolveFinished?.(); }
      },
      onComplete: async (result) => {
        sequence.push(`persisted:${result.content}`);
      },
    });
    // The result arrives on close; stop the child so its buffered line is flushed.
    setTimeout(() => runner.stop("thread-no-newline"), 100);
    const resultPromise = new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (sequence.includes("persisted:Final answer")) { clearInterval(poll); resolve(); }
      }, 20);
    });
    await Promise.race([resultPromise, new Promise((_, reject) => setTimeout(() => reject(new Error("Result never persisted")), 3_000))]);
    expect(sequence).toContain("persisted:Final answer");
    expect(sequence).toContain("finished");
  });

  it("drops the compacting activity from the completed turn once the CLI clears its status", async () => {
    const runner = new CliRunner();
    const liveActivity: string[] = [];
    const statusClears: number[] = [];
    let resolveTurn: (() => void) | undefined;
    let resolvePersisted: (() => void) | undefined;
    const turnDone = new Promise<void>((resolve) => { resolveTurn = resolve; });
    const persisted = new Promise<void>((resolve) => { resolvePersisted = resolve; });
    let completedContent = "";
    // Emits a compacting status, then clears it (status:null), then finishes the turn.
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.exit(0));` +
      `process.stdout.write(JSON.stringify({type:"system",subtype:"status",status:"compacting",session_id:"session-compact"})+"\\n");` +
      `process.stdout.write(JSON.stringify({type:"system",subtype:"status",status:null,session_id:"session-compact"})+"\\n");` +
      `process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"Compacted answer",is_error:false,session_id:"session-compact"})+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-compact", prompt: "test", attachments: [], model: "", effort: "", permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "activity") liveActivity.push(event.label);
        if (event.type === "status" && event.status === null) statusClears.push(liveActivity.length);
        if (event.type === "turn-complete") resolveTurn?.();
      },
      onComplete: async (result) => {
        completedContent = result.content;
        resolvePersisted?.();
      },
    });
    await Promise.race([turnDone, new Promise((_, reject) => setTimeout(() => reject(new Error("Turn never completed")), 3_000))]);
    // The compacting status arrives as an activity, then the null status clears it.
    expect(liveActivity).toEqual(["compacting"]);
    expect(statusClears).toEqual([1]);
    await Promise.race([persisted, new Promise((_, reject) => setTimeout(() => reject(new Error("Turn never persisted")), 3_000))]);
    expect(completedContent).toBe("Compacted answer");
    runner.stop("thread-compact");
  });
});

describe("CliRunner context requests", () => {
  it("publishes fast context usage from streamed API telemetry", async () => {
    const runner = new CliRunner();
    let resolveContext: ((usage: unknown) => void) | undefined;
    const contextReady = new Promise<unknown>((resolve) => { resolveContext = resolve; });
    const script = `process.stdin.resume();` +
      `process.stdout.write(JSON.stringify({type:"assistant",message:{model:"maximo-atlas",content:[{type:"text",text:"Done"}]}})+"\\n");` +
      `process.stdout.write(JSON.stringify({type:"stream_event",event:{type:"message_start",message:{usage:{input_tokens:250,output_tokens:0}}},session_id:"session-context"})+"\\n");` +
      `process.stdout.write(JSON.stringify({type:"stream_event",event:{type:"message_delta",delta:{stop_reason:"end_turn"},usage:{output_tokens:20}},session_id:"session-context"})+"\\n");` +
      `process.stdout.write(JSON.stringify({type:"result",subtype:"success",result:"Done",is_error:false,modelUsage:{"maximo-atlas":{contextWindow:1000,maxOutputTokens:100}},session_id:"session-context"})+"\\n");`;
    runner.start({ source: "development", entryPath: "", command: process.execPath, argsPrefix: ["-e", script, "--"], environment: process.env }, {
      threadId: "thread-context",
      prompt: "test",
      attachments: [],
      model: "",
      effort: "",
      permission: "default",
    }, process.cwd(), undefined, {
      onEvent: (event) => {
        if (event.type === "context" && event.context.maxTokens === 1_000) resolveContext?.(event.context);
      },
      onComplete: async () => undefined,
    });
    const usage = await Promise.race([
      contextReady,
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Context request timed out")), 3_000)),
    ]);
    expect(usage).toMatchObject({ totalTokens: 270, maxTokens: 1_000, percentage: 27, model: "maximo-atlas" });
    expect(await runner.requestContext("thread-context")).toMatchObject({ totalTokens: 270, maxTokens: 1_000, percentage: 27 });
    runner.stop("thread-context");
  });
});
