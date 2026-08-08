import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialState, StateStore } from "./state-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("StateStore", () => {
  it("persists settings atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState());
    await store.initialize();
    const themePacks = store.snapshot().settings.themePacks;
    await store.updateSettings({
      theme: "dark",
      defaultModel: "maximo-atlas-preview",
      sendWithEnter: false,
      themePacks: {
        ...themePacks,
        dark: { ...themePacks.dark, accent: "#0169cc" },
      },
    });
    const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(saved.settings.theme).toBe("dark");
    expect(saved.settings.defaultModel).toBe("maximo-atlas-preview");
    expect(saved.settings.sendWithEnter).toBe(false);
    expect(saved.settings.themePacks.dark.accent).toBe("#0169cc");
  });

  it("persists the expanded settings and restores archived chats", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    await store.updateSettings({
      uiDensity: "spacious",
      followUpBehavior: "queue",
      showEnvironmentMarkers: false,
      customModelSlugs: ["openai/gpt-custom"],
    });
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "Archive me", [], "", "", "auto");
    await store.recordContextUsage(threadId, {
      categories: [{ name: "Current context", tokens: 100 }],
      totalTokens: 100,
      totalProcessedTokens: 100,
      maxTokens: 1_000,
      rawMaxTokens: 1_000,
      percentage: 10,
      model: "kilo/test-model",
    });
    await store.flushContextUsage(threadId, {
      categories: [{ name: "Current context", tokens: 140 }],
      totalTokens: 140,
      totalProcessedTokens: 140,
      maxTokens: 1_000,
      rawMaxTokens: 1_000,
      percentage: 14,
      model: "kilo/test-model",
    });
    await store.archiveThread(threadId);
    expect(store.getThread(threadId)?.archived).toBe(true);
    await store.unarchiveThread(threadId);
    expect(store.getThread(threadId)?.archived).toBe(false);
    expect(store.snapshot().settings).toMatchObject({
      uiDensity: "spacious",
      followUpBehavior: "queue",
      showEnvironmentMarkers: false,
      customModelSlugs: ["openai/gpt-custom"],
    });
    expect(store.snapshot().profile.totalTokens).toBe(140);
    expect(store.snapshot().profile.modelTokens["kilo/test-model"]).toBe(140);
  });

  it("clears provider-bound selections when the signed-in account changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    await store.beginRun(threadId, "Use the current provider", [], "old-model", "high", "auto");
    await store.finishRun(threadId, "Done", "complete", "old-session");
    await store.flushContextUsage(threadId, {
      categories: [{ name: "Current context", tokens: 1 }],
      totalTokens: 1,
      maxTokens: 100,
      rawMaxTokens: 100,
      percentage: 1,
      model: "old-model",
    });

    await store.resetProviderSelections();

    const thread = store.getThread(threadId)!;
    expect(thread.model).toBeUndefined();
    expect(thread.effort).toBeUndefined();
    expect(thread.cliSessionId).toBeUndefined();
    expect(thread.contextUsage).toBeUndefined();
    expect(store.snapshot().settings.defaultModel).toBe("");
    expect(store.snapshot().settings.defaultEffort).toBe("");
  });

  it("creates spaces and files a new project into the selected space", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState());
    await store.initialize();
    const withSpace = await store.createSpace("Work", "briefcase");
    const space = withSpace.spaces[0]!;
    const withProject = await store.createProject("Workspace", [directory], space.id);
    const project = withProject.projects.find((item) => item.path === directory)!;
    expect(project.spaceId).toBe(space.id);
    expect(withProject.selectedSpaceId).toBe(space.id);
    expect(withProject.selectedProjectId).toBe(project.id);
  });

  it("keeps at most five source folders and uses the first as primary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    const folders = await Promise.all(Array.from({ length: 6 }, () => mkdtemp(join(tmpdir(), "maximo-source-test-"))));
    temporaryDirectories.push(directory, ...folders);
    const store = new StateStore(directory, createInitialState());
    await store.initialize();
    const state = await store.createProject("Workspace", folders);
    const project = state.projects[0]!;
    expect(project.sourcePaths).toHaveLength(5);
    expect(project.path).toBe(folders[0]);
    expect(project.sourcePaths?.[0]).toBe(project.path);
  });

  it("creates chats and records completed turns with activity and duration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const thread = state.threads[0]!;
    await store.beginRun(thread.id, "Fix the build", [], "maximo-atlas-preview", "", "auto");
    await store.finishRun(thread.id, "Build fixed.", "complete", "session-1", false, [{ label: "Using Bash", detail: "npm test", timestamp: 10 }], 12_000, [
      { type: "text", text: "Checking the build.", timestamp: 5 },
      { type: "activity", label: "Using Bash", detail: "npm test", toolName: "Bash", timestamp: 10 },
    ]);
    const finished = store.getThread(thread.id)!;
    expect(finished.title).toBe("Fix the build");
    expect(finished.status).toBe("complete");
    expect(finished.cliSessionId).toBe("session-1");
    expect(finished.messages).toHaveLength(2);
    expect(finished.messages[0]?.model).toBe("maximo-atlas-preview");
    expect(finished.messages[1]?.model).toBe("maximo-atlas-preview");
    // timeline is the canonical completed-turn activity stream; keeping the
    // legacy activity copy would duplicate every tool result and patch.
    expect(finished.messages[1]?.activity).toBeUndefined();
    expect(finished.messages[1]?.timeline).toHaveLength(2);
    expect(finished.messages[1]?.durationMs).toBe(12_000);
  });

  it("persists the latest context snapshot for chat reloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    // Usage stays in memory during a run; the final reading is persisted with
    // completion (or explicitly flushed by recovery paths).
    await store.recordContextUsage(threadId, {
      categories: [{ name: "Current context", tokens: 2_500 }],
      totalTokens: 2_500,
      maxTokens: 100_000,
      rawMaxTokens: 100_000,
      percentage: 3,
      model: "maximo-atlas",
    });
    // Streaming telemetry alone must not rewrite the full archive.
    expect(store.getThread(threadId)?.contextUsage).toBeUndefined();
    await store.flushContextUsage(threadId, {
      categories: [{ name: "Current context", tokens: 2_500 }],
      totalTokens: 2_500,
      maxTokens: 100_000,
      rawMaxTokens: 100_000,
      percentage: 3,
      model: "maximo-atlas",
    });
    expect(store.getThread(threadId)?.contextUsage).toMatchObject({ totalTokens: 2_500, maxTokens: 100_000 });
    const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(saved.threads[0].contextUsage.model).toBe("maximo-atlas");
  });

  it("persists the latest streamed context in the completed-turn write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "Measure this run", [], "maximo-atlas", "", "auto");
    await store.recordContextUsage(threadId, {
      categories: [{ name: "Current context", tokens: 4_200 }],
      totalTokens: 4_200,
      totalProcessedTokens: 4_200,
      maxTokens: 100_000,
      rawMaxTokens: 100_000,
      percentage: 4.2,
      model: "maximo-atlas",
    });

    await store.finishRun(threadId, "Done", "complete");

    expect(store.getThread(threadId)?.contextUsage?.totalProcessedTokens).toBe(4_200);
    expect(store.snapshot().profile.threadTokenTotals[threadId]).toBe(4_200);
    const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(saved.threads[0].contextUsage.totalProcessedTokens).toBe(4_200);
  });

  it("sends full detail only for the selected chat and removes duplicate patch history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;

    const firstState = await store.createThread(project.id);
    const firstThreadId = firstState.selectedThreadId!;
    await store.beginRun(firstThreadId, "Large edit", [], "", "", "auto");
    const patch = `@@ -1 +1 @@\n-${"a".repeat(100_000)}\n+${"b".repeat(100_000)}`;
    const fileChange = { path: join(directory, "large.ts"), patch, additions: 1, deletions: 1 };
    await store.finishRun(
      firstThreadId,
      "Done",
      "complete",
      "session-large",
      false,
      [{ label: "Using Edit", detail: fileChange.path, toolName: "Edit", fileChange, timestamp: 1 }],
      10,
      [{ type: "activity", label: "Using Edit", detail: fileChange.path, toolName: "Edit", fileChange, timestamp: 1 }],
      [fileChange],
    );

    const secondState = await store.createThread(project.id);
    const secondThreadId = secondState.selectedThreadId!;
    const shell = store.snapshotForRenderer();
    const firstShell = shell.threads.find((thread) => thread.id === firstThreadId)!;
    const secondDetail = shell.threads.find((thread) => thread.id === secondThreadId)!;
    expect(firstShell.detailLevel).toBe("summary");
    expect(firstShell.messages.at(-1)?.content).toBe("Done");
    expect(firstShell.messages.at(-1)?.timeline).toBeUndefined();
    expect(firstShell.messages.at(-1)?.fileChanges).toBeUndefined();
    expect(secondDetail.detailLevel).toBe("full");

    const selected = await store.selectThread(firstThreadId);
    const hydrated = selected.threads.find((thread) => thread.id === firstThreadId)!;
    const assistant = hydrated.messages.at(-1)!;
    expect(hydrated.detailLevel).toBe("full");
    expect(assistant.activity).toBeUndefined();
    expect(assistant.timeline?.[0]?.type).toBe("activity");
    expect(assistant.timeline?.[0]?.type === "activity" ? assistant.timeline[0].fileChange : undefined).toBeUndefined();
    expect(assistant.fileChanges?.[0]?.patch).toBe(patch);
    expect(JSON.stringify(shell).length).toBeLessThan(JSON.stringify(store.snapshot()).length / 2);

    await store.activateThread(secondThreadId);
    expect(store.snapshot().selectedThreadId).toBe(secondThreadId);
    const onDemandDetail = store.threadDetail(firstThreadId);
    expect(onDemandDetail.detailLevel).toBe("full");
    expect(onDemandDetail.messages.at(-1)?.fileChanges?.[0]?.patch).toBe(patch);
  });

  it("compacts duplicate history while migrating an existing state file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const initial = createInitialState(directory);
    const project = initial.projects[0]!;
    const fileChange = { path: join(directory, "legacy.ts"), patch: "@@ -1 +1 @@\n-old\n+new", additions: 1, deletions: 1 };
    initial.threads = [{
      id: "legacy-thread",
      projectId: project.id,
      title: "Legacy chat",
      createdAt: 1,
      updatedAt: 2,
      status: "complete",
      messages: [{
        id: "legacy-answer",
        role: "assistant",
        content: "Migrated",
        createdAt: 2,
        activity: [{ label: "Using Edit", detail: fileChange.path, toolName: "Edit", fileChange, timestamp: 1 }],
        timeline: [{ type: "activity", label: "Using Edit", detail: fileChange.path, toolName: "Edit", fileChange, timestamp: 1 }],
        fileChanges: [fileChange],
      }],
    }];
    initial.selectedThreadId = "legacy-thread";
    const store = new StateStore(directory, initial);

    await store.initialize();

    const migrated = store.getThread("legacy-thread")?.messages[0];
    expect(migrated?.activity).toBeUndefined();
    expect(migrated?.timeline?.[0]?.type === "activity" ? migrated.timeline[0].fileChange : undefined).toBeUndefined();
    expect(migrated?.fileChanges?.[0]).toEqual(fileChange);
    const saved = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
    expect(saved.threads[0].messages[0].activity).toBeUndefined();
    expect(saved.threads[0].messages[0].timeline[0].fileChange).toBeUndefined();
  });

  it("does not duplicate a final assistant response when completion is delivered twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    await store.beginRun(threadId, "Prompt", [], "", "", "auto");
    await store.finishRun(threadId, "Answer", "complete", "session-1", false, [], 1_000, [], [], true);
    await store.finishRun(threadId, "Answer", "complete", "session-1", false, [], 1_000, [], [], true);
    expect(store.getThread(threadId)?.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
  });

  it("marks completed threads as unread when finished in background and clears unread on selection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state1 = await store.createThread(project.id);
    const threadId1 = state1.selectedThreadId!;

    // Give thread1 a message so createThread won't reuse it as an empty draft
    await store.beginRun(threadId1, "Background task", [], "", "", "auto");

    const state2 = await store.createThread(project.id);
    const threadId2 = state2.selectedThreadId!;

    // Ensure we're viewing thread2 while thread1 finishes
    await store.selectThread(threadId2);

    await store.finishRun(threadId1, "Background task finished", "complete", "sess-1", false, [], 500, [], [], true);
    expect(store.getThread(threadId1)?.unread).toBe(true);

    // Selecting threadId1 marks it as read
    await store.selectThread(threadId1);
    expect(store.getThread(threadId1)?.unread).toBe(false);

    // Test markAllNotificationsRead
    await store.selectThread(threadId2);
    await store.finishRun(threadId1, "Another background result", "complete", "sess-1", false, [], 500, [], [], true);
    expect(store.getThread(threadId1)?.unread).toBe(true);
    await store.markAllNotificationsRead();
    expect(store.getThread(threadId1)?.unread).toBe(false);
  });

  it("keeps a selected chat read through the lightweight navigation checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const first = await store.createThread(project.id);
    const firstThreadId = first.selectedThreadId!;
    await store.beginRun(firstThreadId, "First", [], "", "", "auto");
    await store.finishRun(firstThreadId, "Background answer", "complete");
    const second = await store.createThread(project.id);
    const secondThreadId = second.selectedThreadId!;
    await store.beginRun(secondThreadId, "Second", [], "", "", "auto");
    await store.finishRun(secondThreadId, "Foreground answer", "complete");
    await store.update((draft) => {
      const firstThread = draft.threads.find((thread) => thread.id === firstThreadId);
      if (firstThread) firstThread.unread = true;
    });

    await store.activateThread(firstThreadId);
    await store.activateThread(secondThreadId);

    const reloaded = new StateStore(directory, createInitialState());
    await reloaded.initialize();
    expect(reloaded.getThread(firstThreadId)?.unread).toBe(false);
    expect(reloaded.snapshot().selectedThreadId).toBe(secondThreadId);
  });

  it("settles intermediate turn responses without marking the thread as running", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    await store.beginRun(threadId, "First prompt", [], "", "", "auto");
    await store.finishRun(threadId, "First answer", "complete", "session-1", false, [], 1_000, [], [], false);
    const followUpState = await store.sendRunMessage(threadId, "Follow up", [], "", "", "auto");
    expect(followUpState.threads.find((thread) => thread.id === threadId)?.messages.at(-1)?.content).toBe("Follow up");
    expect(store.getThread(threadId)?.status).toBe("running");
    expect(store.getThread(threadId)?.messages.map((message) => message.content)).toContain("First answer");

    await store.finishRun(threadId, "Second answer", "complete", "session-1", false, [], 800, [], [], false);
    const inTurn = await store.sendRunMessage(threadId, "Add this context", [], "", "", "auto", { asFollowUp: true });
    const thread = inTurn.threads.find((item) => item.id === threadId)!;
    const followUpMessage = thread.messages.find((message) => message.kind === "follow-up");
    expect(followUpMessage?.content).toBe("Add this context");
    // Follow-ups remain persisted records; the renderer nests them into the
    // active assistant work disclosure instead of rendering standalone turns.
    const assistant = [...thread.messages].reverse().find((message) => message.role === "assistant" && message.content === "Second answer");
    expect(assistant?.timeline?.some((item) => item.type === "user-context")).toBeFalsy();
    const order = thread.messages.map((message) => `${message.role}:${message.kind ?? "default"}:${message.content.slice(0, 20)}`);
    expect(order.some((line) => line.includes("user:follow-up:Add this context"))).toBe(true);
  });

  it("keeps a handoff turn running and places its context after the prior answer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    await store.beginRun(threadId, "First prompt", [], "", "", "auto");
    await store.sendRunMessage(threadId, "Keep this in the next turn", [], "", "", "auto", { asFollowUp: true });
    await store.finishRun(threadId, "First answer", "complete", "session-1", false, [], 500, [], [], false, true);
    const thread = store.getThread(threadId)!;
    expect(thread.status).toBe("running");
    expect(thread.messages.map((message) => message.content)).toEqual(["First prompt", "First answer", "Keep this in the next turn"]);
  });

  it("persists AskUserQuestion answers as collapsible chat interactions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    await store.recordQuestionInteraction(threadId, [{ question: "Favorite color?", answer: "Blue", header: "Preference" }], "tool-question");
    const thread = store.getThread(threadId)!;
    expect(thread.messages[0]?.interaction).toEqual({
      type: "ask-user",
      questions: [{ question: "Favorite color?", answer: "Blue", header: "Preference" }],
      toolUseId: "tool-question",
    });
  });

  it("serializes simultaneous interaction and completion updates without losing either", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const state = await store.createThread(project.id);
    const threadId = state.selectedThreadId!;
    await store.beginRun(threadId, "Ask me", [], "", "", "default");
    await Promise.all([
      store.recordQuestionInteraction(threadId, [{ question: "Continue?", answer: "Yes" }], "tool-question"),
      store.finishRun(threadId, "Continuing.", "complete", "session-2", false, [], 2_000),
    ]);
    const thread = store.getThread(threadId)!;
    expect(thread.status).toBe("complete");
    expect(thread.messages.some((message) => message.interaction?.type === "ask-user")).toBe(true);
    expect(thread.messages.some((message) => message.role === "assistant" && message.content === "Continuing.")).toBe(true);
  });

  it("keeps unsent chats out of the session history and reuses one draft", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const first = await store.createThread(project.id);
    expect(first.threads).toHaveLength(1);
    const reused = await store.createThread(project.id);
    expect(reused.threads).toHaveLength(1);
    await store.beginRun(reused.threads[0]!.id, "Sent chat", [], "", "", "auto");
    const next = await store.createThread(project.id);
    expect(next.threads.filter((thread) => thread.messages.length > 0)).toHaveLength(1);
    expect(next.threads.filter((thread) => thread.messages.length === 0)).toHaveLength(1);
  });

  it("creates named multi-folder projects and supports project/chat actions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    const secondary = await mkdtemp(join(tmpdir(), "maximo-desktop-source-"));
    temporaryDirectories.push(directory, secondary);
    const store = new StateStore(join(directory, "state"), createInitialState());
    await store.initialize();
    const created = await store.createProject("Workspace", [directory, secondary]);
    const project = created.projects[0]!;
    expect(project.name).toBe("Workspace");
    expect(project.sourcePaths).toEqual([directory, secondary]);
    const withChat = await store.createThread(project.id);
    await store.beginRun(withChat.selectedThreadId!, "Pinned chat", [], "", "", "auto");
    const pinned = await store.toggleThreadPinned(withChat.selectedThreadId!);
    expect(pinned.threads[0]?.pinned).toBe(true);
    const archived = await store.archiveProjectThreads(project.id);
    expect(archived.threads[0]?.archived).toBe(true);
  });

  it("reorders projects without changing their identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const initial = createInitialState();
    initial.projects = [
      { id: "project-1", name: "Project 1", path: "/tmp/project-1", createdAt: 1, lastOpenedAt: 1 },
      { id: "project-2", name: "Project 2", path: "/tmp/project-2", createdAt: 2, lastOpenedAt: 2 },
      { id: "project-3", name: "Project 3", path: "/tmp/project-3", createdAt: 3, lastOpenedAt: 3 },
    ];
    const store = new StateStore(directory, initial);
    await store.initialize();

    const reordered = await store.reorderProjects("project-1", "project-3");

    expect(reordered.projects.map((project) => project.id)).toEqual(["project-2", "project-3", "project-1"]);
    expect(JSON.parse(await readFile(join(directory, "state.json"), "utf8")).projects.map((project: { id: string }) => project.id)).toEqual([
      "project-2",
      "project-3",
      "project-1",
    ]);
  });

  it("persists message pins, markers, and notes per chat", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "Remember this", [], "", "", "auto");
    await store.finishRun(threadId, "This is worth keeping.", "complete");
    const thread = store.getThread(threadId)!;
    const userMessageId = thread.messages[0]!.id;
    const assistantMessageId = thread.messages[1]!.id;

    await store.toggleMessagePinned(threadId, assistantMessageId);
    await store.setMessagePinDone(threadId, assistantMessageId, true);
    await store.setMessagePinLabel(threadId, assistantMessageId, "Important answer");
    await store.toggleThreadMarker(threadId, assistantMessageId);
    const markerId = store.getThread(threadId)?.markers?.[0]?.id;
    expect(markerId).toBeTruthy();
    await store.setThreadMarkerDone(threadId, markerId!, true);
    await store.updateThreadNotes(threadId, "Follow up with the test suite.");

    const saved = store.getThread(threadId)!;
    expect(saved.pinnedMessages).toEqual([expect.objectContaining({ messageId: assistantMessageId, done: true, label: "Important answer" })]);
    expect(saved.markers).toEqual([expect.objectContaining({ messageId: assistantMessageId, done: true, selectedText: "This is worth keeping." })]);
    expect(saved.notes).toBe("Follow up with the test suite.");

    await store.toggleMessagePinned(threadId, assistantMessageId);
    await store.toggleThreadMarker(threadId, assistantMessageId);
    expect(store.getThread(threadId)?.pinnedMessages).toEqual([]);
    expect(store.getThread(threadId)?.markers).toEqual([]);
    expect(userMessageId).not.toBe(assistantMessageId);
  });

  it("rewrites an edited user message in place, drops later turns, and re-anchors the thread", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "Original request", [], "", "", "auto");
    await store.finishRun(threadId, "Original answer", "complete");
    const before = store.getThread(threadId)!;
    const userMessage = before.messages[0]!;
    const originalUuid = userMessage.uuid;
    expect(before.messages).toHaveLength(2);

    await store.rewriteUserMessage(threadId, userMessage.id, "Edited request");

    const after = store.getThread(threadId)!;
    // The assistant reply is discarded so the UI matches the forked transcript.
    expect(after.messages).toHaveLength(1);
    const edited = after.messages[0]!;
    expect(edited.content).toBe("Edited request");
    expect(edited.id).toBe(userMessage.id);
    expect(edited.uuid).toBeTruthy();
    expect(edited.uuid).not.toBe(originalUuid);
    // Anchor points at the message before the edited one; with a single message
    // there is nothing before it, so the anchor clears.
    expect(after.truncateAtUuid).toBeUndefined();
  });

  it("anchors an edited later user message at the previous turn and discards the tail", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "First request", [], "", "", "auto");
    await store.finishRun(threadId, "First answer", "complete");
    await store.beginRun(threadId, "Second request", [], "", "", "auto");
    await store.finishRun(threadId, "Second answer", "complete");
    const before = store.getThread(threadId)!;
    const firstAnswer = before.messages[1]!;
    const secondUser = before.messages[2]!;
    expect(before.messages).toHaveLength(4);

    await store.rewriteUserMessage(threadId, secondUser.id, "Edited second request");

    const after = store.getThread(threadId)!;
    expect(after.messages.map((message) => message.content)).toEqual(["First request", "First answer", "Edited second request"]);
    // Resume the CLI transcript at the message before the edited one.
    expect(after.truncateAtUuid).toBe(firstAnswer.uuid);
    expect(after.messages[2]!.uuid).not.toBe(secondUser.uuid);
  });

  it("truncates the thread at a user message and cleans up pins/markers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "First request", [], "", "", "auto");
    await store.finishRun(threadId, "First answer", "complete");
    await store.beginRun(threadId, "Second request", [], "", "", "auto");
    await store.finishRun(threadId, "Second answer", "complete");
    const thread = store.getThread(threadId)!;
    const firstUser = thread.messages[0]!;
    const secondAnswer = thread.messages[3]!;
    await store.toggleMessagePinned(threadId, secondAnswer.id);
    await store.toggleThreadMarker(threadId, secondAnswer.id);

    await store.truncateThreadAt(threadId, firstUser.id);

    const truncated = store.getThread(threadId)!;
    // Truncating at the first user message keeps only that message; everything
    // after (its answer and the later turn) is discarded.
    expect(truncated.messages.map((message) => message.content)).toEqual(["First request"]);
    expect(truncated.status).toBe("idle");
    expect(truncated.pinnedMessages ?? []).toEqual([]);
    expect(truncated.markers ?? []).toEqual([]);
    expect(truncated.truncateAtUuid).toBe(firstUser.uuid);
  });

  it("rejects rewriting non-user messages and truncating at non-user messages", async () => {
    const directory = await mkdtemp(join(tmpdir(), "maximo-desktop-test-"));
    temporaryDirectories.push(directory);
    const store = new StateStore(directory, createInitialState(directory));
    await store.initialize();
    const project = store.snapshot().projects[0]!;
    const created = await store.createThread(project.id);
    const threadId = created.selectedThreadId!;
    await store.beginRun(threadId, "Request", [], "", "", "auto");
    await store.finishRun(threadId, "Answer", "complete");
    const thread = store.getThread(threadId)!;
    const assistantMessage = thread.messages[1]!;

    await expect(store.rewriteUserMessage(threadId, assistantMessage.id, "nope")).rejects.toThrow("Message not found.");
    await expect(store.truncateThreadAt(threadId, assistantMessage.id)).rejects.toThrow("Message not found.");
    await expect(store.truncateThreadAt(threadId, "missing-id")).rejects.toThrow("Message not found.");
  });
});
