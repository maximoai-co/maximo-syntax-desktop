import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { CliBrowserBridge, CliRunCallbacks } from "./cli-runner.js";
import type { CliRunner } from "./cli-runner.js";
import type { RuntimeManager } from "./runtime-manager.js";
import type { StateStore } from "./state-store.js";
import { computeNextAutomationRunAt, computeNextAutomationRunAtAfter, validateAutomationSchedule } from "./automation-schedule.js";
import type {
  AutomationCreateInput,
  AutomationDefinition,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationSnapshot,
  AutomationUpdateInput,
  PermissionMode,
  RunEvent,
} from "./types.js";

const MAX_AUTOMATIONS = 100;
const MAX_RUN_HISTORY = 1_000;
const MAX_CONCURRENT_RUNS = 3;
const MAX_TIMER_DELAY_MS = 60_000;
const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60_000;

interface PersistedAutomations {
  version: 1;
  installSalt: string;
  automations: AutomationDefinition[];
  runs: AutomationRun[];
}

interface AutomationServiceOptions {
  dataDirectory: string;
  store: StateStore;
  runtime: RuntimeManager;
  runner: CliRunner;
  bridgeFor: (threadId: string, projectId: string, workspaceRoot: string) => CliBrowserBridge | undefined;
  onRunEvent: (event: RunEvent) => void;
  finishThread: (...args: Parameters<StateStore["finishRun"]>) => Promise<void>;
  notify: (definition: AutomationDefinition, run: AutomationRun) => void;
  onChanged: (snapshot: AutomationSnapshot) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

function isPermission(value: unknown): value is PermissionMode {
  return value === "default" || value === "plan" || value === "acceptEdits" || value === "auto" || value === "full";
}

function cloneSnapshot(data: PersistedAutomations, projectId?: string): AutomationSnapshot {
  const automations = projectId ? data.automations.filter((item) => item.projectId === projectId) : data.automations;
  const ids = new Set(automations.map((item) => item.id));
  const runs = data.runs.filter((run) => ids.has(run.automationId));
  return {
    automations: structuredClone(automations).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    runs: structuredClone(runs).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    activeCount: runs.filter((run) => run.status === "queued" || run.status === "running").length,
    unreadCount: runs.filter((run) => run.unread).length,
  };
}

function normalizePersisted(value: unknown): PersistedAutomations {
  const source = value && typeof value === "object" ? value as Partial<PersistedAutomations> : {};
  const automations = Array.isArray(source.automations)
    ? source.automations.filter((item): item is AutomationDefinition => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.projectId === "string" && typeof item.prompt === "string" && typeof item.name === "string" && item.schedule && typeof item.schedule === "object"))
    : [];
  const runs = Array.isArray(source.runs)
    ? source.runs.filter((item): item is AutomationRun => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.automationId === "string" && typeof item.status === "string"))
    : [];
  return {
    version: 1,
    installSalt: text(source.installSalt, 200) || randomBytes(24).toString("hex"),
    automations: structuredClone(automations).slice(0, MAX_AUTOMATIONS),
    runs: structuredClone(runs).slice(0, MAX_RUN_HISTORY),
  };
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

async function runGit(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolvePromise({ code: -1, stdout, stderr: error.message }));
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

export class AutomationService {
  private readonly path: string;
  private readonly worktreeRoot: string;
  private data: PersistedAutomations = normalizePersisted(null);
  private writeQueue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private disposed = false;
  private readonly initializedAt = Date.now();
  private readonly activeRunIds = new Set<string>();
  private readonly runByThread = new Map<string, string>();
  private readonly timeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: AutomationServiceOptions) {
    this.path = join(options.dataDirectory, "automations.json");
    this.worktreeRoot = join(options.dataDirectory, "automation-worktrees");
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.dataDirectory, { recursive: true });
    try {
      this.data = normalizePersisted(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      this.data = normalizePersisted(null);
    }
    const recoveredAt = nowIso();
    for (const run of this.data.runs) {
      if (run.status !== "queued" && run.status !== "running") continue;
      run.status = "interrupted";
      run.finishedAt = recoveredAt;
      run.error = "The app closed before this automation finished.";
      run.unread = true;
      const definition = this.data.automations.find((item) => item.id === run.automationId);
      if (definition) {
        definition.lastRunAt = recoveredAt;
        definition.lastRunStatus = "interrupted";
        definition.updatedAt = recoveredAt;
      }
    }
    for (const definition of this.data.automations) {
      try {
        validateAutomationSchedule(definition.schedule);
        if (definition.enabled && !definition.nextRunAt) {
          definition.nextRunAt = computeNextAutomationRunAt(definition.schedule, recoveredAt, this.jitter(definition.id));
          if (definition.schedule.type === "once" && !definition.nextRunAt) definition.enabled = false;
        }
      } catch {
        definition.enabled = false;
        definition.nextRunAt = null;
      }
    }
    await this.persist();
    this.emit();
    this.schedule(50);
  }

  snapshot(projectId?: string): AutomationSnapshot {
    return cloneSnapshot(this.data, projectId);
  }

  get(automationId: string): AutomationDefinition | undefined {
    const definition = this.data.automations.find((item) => item.id === automationId);
    return definition ? structuredClone(definition) : undefined;
  }

  listRuns(automationId: string): AutomationRun[] {
    return this.data.runs.filter((run) => run.automationId === automationId).map((run) => structuredClone(run));
  }

  async create(input: AutomationCreateInput): Promise<AutomationSnapshot> {
    if (this.data.automations.length >= MAX_AUTOMATIONS) throw new Error(`You can create up to ${MAX_AUTOMATIONS} automations.`);
    const project = this.options.store.getProject(input.projectId);
    if (!project) throw new Error("Project not found.");
    const name = text(input.name, 160);
    const prompt = text(input.prompt, 100_000);
    if (!name) throw new Error("Enter an automation title.");
    if (!prompt) throw new Error("Describe what Maximo should do.");
    validateAutomationSchedule(input.schedule);
    const destination = input.destination ?? "new_chat";
    const threadId = text(input.threadId, 100) || undefined;
    this.validateDestination(input.projectId, destination, threadId);
    const createdAt = nowIso();
    const id = randomUUID();
    const settings = this.options.store.snapshot().settings;
    const definition: AutomationDefinition = {
      id,
      name,
      ...(text(input.description, 2_000) ? { description: text(input.description, 2_000) } : {}),
      prompt,
      projectId: input.projectId,
      destination,
      ...(threadId ? { threadId } : {}),
      schedule: structuredClone(input.schedule),
      enabled: input.enabled !== false,
      model: text(input.model, 200) || settings.defaultModel,
      effort: text(input.effort, 40) || settings.defaultEffort,
      permission: isPermission(input.permission) ? input.permission : settings.defaultPermission,
      workspaceMode: input.workspaceMode === "local" || input.workspaceMode === "worktree" ? input.workspaceMode : "auto",
      allowLocalFallback: input.allowLocalFallback !== false,
      notificationPolicy: input.notificationPolicy === "failures_only" || input.notificationPolicy === "none" ? input.notificationPolicy : "all",
      maxRuntimeMinutes: finiteInteger(input.maxRuntimeMinutes, 120, 1, 1_440),
      nextRunAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    definition.nextRunAt = definition.enabled
      ? computeNextAutomationRunAt(definition.schedule, createdAt, this.jitter(id))
      : null;
    if (definition.schedule.type === "once" && definition.enabled && !definition.nextRunAt) {
      throw new Error("Choose a one-time run in the future.");
    }
    this.data.automations.unshift(definition);
    await this.changed();
    return this.snapshot();
  }

  async update(automationId: string, input: AutomationUpdateInput): Promise<AutomationSnapshot> {
    const currentIndex = this.data.automations.findIndex((item) => item.id === automationId);
    if (currentIndex < 0) throw new Error("Automation not found.");
    // Apply updates to a clone so a validation error can never leave the
    // in-memory scheduler in a partially updated state.
    const definition = structuredClone(this.data.automations[currentIndex]);
    const scheduleChanged = input.schedule !== undefined;
    if (input.projectId !== undefined && input.projectId !== definition.projectId) {
      if (!this.options.store.getProject(input.projectId)) throw new Error("Project not found.");
      definition.projectId = input.projectId;
      delete definition.threadId;
    }
    if (input.name !== undefined) {
      const name = text(input.name, 160);
      if (!name) throw new Error("Enter an automation title.");
      definition.name = name;
    }
    if (input.description !== undefined) {
      const description = text(input.description, 2_000);
      if (description) definition.description = description;
      else delete definition.description;
    }
    if (input.prompt !== undefined) {
      const prompt = text(input.prompt, 100_000);
      if (!prompt) throw new Error("Describe what Maximo should do.");
      definition.prompt = prompt;
    }
    if (input.schedule) {
      validateAutomationSchedule(input.schedule);
      definition.schedule = structuredClone(input.schedule);
    }
    if (input.destination) definition.destination = input.destination;
    if (input.threadId !== undefined) {
      const threadId = text(input.threadId, 100);
      if (threadId) definition.threadId = threadId;
      else delete definition.threadId;
    }
    this.validateDestination(definition.projectId, definition.destination, definition.threadId);
    if (definition.destination === "new_chat") delete definition.threadId;
    if (input.model !== undefined) definition.model = text(input.model, 200);
    if (input.effort !== undefined) definition.effort = text(input.effort, 40);
    if (input.permission !== undefined && isPermission(input.permission)) definition.permission = input.permission;
    if (input.workspaceMode) definition.workspaceMode = input.workspaceMode;
    if (input.allowLocalFallback !== undefined) definition.allowLocalFallback = input.allowLocalFallback;
    if (input.notificationPolicy) definition.notificationPolicy = input.notificationPolicy;
    if (input.maxRuntimeMinutes !== undefined) definition.maxRuntimeMinutes = finiteInteger(input.maxRuntimeMinutes, definition.maxRuntimeMinutes, 1, 1_440);
    if (input.enabled !== undefined) definition.enabled = input.enabled;
    definition.updatedAt = nowIso();
    if (!definition.enabled) definition.nextRunAt = null;
    else if (scheduleChanged || input.enabled === true) {
      definition.nextRunAt = computeNextAutomationRunAt(definition.schedule, definition.updatedAt, this.jitter(definition.id));
      if (definition.schedule.type === "once" && !definition.nextRunAt) throw new Error("Choose a one-time run in the future.");
    }
    this.data.automations[currentIndex] = definition;
    await this.changed();
    return this.snapshot();
  }

  async setEnabled(automationId: string, enabled: boolean): Promise<AutomationSnapshot> {
    return this.update(automationId, { enabled });
  }

  async delete(automationId: string): Promise<AutomationSnapshot> {
    const definition = this.requireDefinition(automationId);
    for (const run of this.data.runs.filter((item) => item.automationId === automationId && (item.status === "queued" || item.status === "running"))) {
      if (run.threadId) this.options.runner.stop(run.threadId);
      if (run.status === "queued") {
        run.status = "cancelled";
        run.finishedAt = nowIso();
        run.error = "Automation deleted before the run started.";
      }
    }
    this.data.automations = this.data.automations.filter((item) => item.id !== definition.id);
    await this.changed();
    return this.snapshot();
  }

  async runNow(automationId: string): Promise<AutomationSnapshot> {
    const definition = this.requireDefinition(automationId);
    if (this.hasActiveRun(automationId)) throw new Error("This automation already has a queued or running execution.");
    this.data.runs.unshift(this.newRun(definition, "manual", nowIso()));
    this.pruneRuns();
    await this.changed();
    this.drainQueue();
    return this.snapshot();
  }

  async cancelRun(runId: string): Promise<AutomationSnapshot> {
    const run = this.data.runs.find((item) => item.id === runId);
    if (!run) throw new Error("Automation run not found.");
    if (run.status === "queued") {
      run.status = "cancelled";
      run.finishedAt = nowIso();
      run.error = "Cancelled before starting.";
      run.unread = true;
    } else if (run.status === "running" && run.threadId) {
      run.error = "Cancellation requested.";
      this.options.runner.stop(run.threadId);
    }
    await this.changed();
    return this.snapshot();
  }

  async markRunsRead(automationId?: string): Promise<AutomationSnapshot> {
    for (const run of this.data.runs) {
      if (!automationId || run.automationId === automationId) run.unread = false;
    }
    await this.changed();
    return this.snapshot();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const timeout of this.timeouts.values()) clearTimeout(timeout);
    this.timeouts.clear();
    await this.writeQueue.catch(() => undefined);
  }

  private requireDefinition(automationId: string): AutomationDefinition {
    const definition = this.data.automations.find((item) => item.id === automationId);
    if (!definition) throw new Error("Automation not found.");
    return definition;
  }

  private validateDestination(projectId: string, destination: AutomationDefinition["destination"], threadId?: string): void {
    if (destination !== "existing_chat") return;
    if (!threadId) throw new Error("Choose an existing chat for this automation.");
    const thread = this.options.store.getThread(threadId);
    if (!thread || thread.projectId !== projectId) throw new Error("The selected chat is not part of this project.");
  }

  private jitter(automationId: string) {
    return { installSalt: this.data.installSalt, automationId };
  }

  private newRun(definition: AutomationDefinition, trigger: AutomationRunTrigger, scheduledFor: string): AutomationRun {
    const createdAt = nowIso();
    return {
      id: randomUUID(),
      automationId: definition.id,
      projectId: definition.projectId,
      trigger,
      status: "queued",
      scheduledFor,
      createdAt,
      unread: false,
    };
  }

  private hasActiveRun(automationId: string): boolean {
    return this.data.runs.some((run) => run.automationId === automationId && (run.status === "queued" || run.status === "running"));
  }

  private pruneRuns(): void {
    if (this.data.runs.length > MAX_RUN_HISTORY) this.data.runs.length = MAX_RUN_HISTORY;
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    const operation = this.writeQueue.then(async () => {
      const temporaryPath = `${this.path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.path);
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private emit(): void {
    this.options.onChanged(this.snapshot());
  }

  private async changed(): Promise<void> {
    await this.persist();
    this.emit();
    this.schedule();
  }

  private schedule(delayOverride?: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    const next = this.data.automations
      .filter((definition) => definition.enabled && definition.nextRunAt)
      .map((definition) => Date.parse(definition.nextRunAt!))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    const delay = delayOverride ?? (next === undefined ? MAX_TIMER_DELAY_MS : Math.max(50, Math.min(MAX_TIMER_DELAY_MS, next - now)));
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.ticking || this.disposed) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const currentIso = new Date(now).toISOString();
      const skippedRuns: Array<{ definition: AutomationDefinition; run: AutomationRun }> = [];
      const due = this.data.automations
        .filter((definition) => definition.enabled && definition.nextRunAt && Date.parse(definition.nextRunAt) <= now)
        .sort((left, right) => Date.parse(left.nextRunAt!) - Date.parse(right.nextRunAt!));
      for (const definition of due) {
        const scheduledFor = definition.nextRunAt!;
        const age = now - Date.parse(scheduledFor);
        const trigger: AutomationRunTrigger = Date.parse(scheduledFor) < this.initializedAt - 60_000 ? "catch_up" : "scheduled";
        if (age > CATCH_UP_WINDOW_MS) {
          const run = this.newRun(definition, "catch_up", scheduledFor);
          run.status = "skipped";
          run.finishedAt = currentIso;
          run.error = "Skipped because the app was unavailable for more than seven days.";
          run.unread = true;
          this.data.runs.unshift(run);
          skippedRuns.push({ definition, run });
          definition.lastRunStatus = "skipped";
        } else if (this.hasActiveRun(definition.id)) {
          const run = this.newRun(definition, trigger, scheduledFor);
          run.status = "skipped";
          run.finishedAt = currentIso;
          run.error = "Skipped because the previous run is still active.";
          run.unread = true;
          this.data.runs.unshift(run);
          skippedRuns.push({ definition, run });
          definition.lastRunStatus = "skipped";
        } else {
          this.data.runs.unshift(this.newRun(definition, trigger, scheduledFor));
        }
        definition.lastRunAt = scheduledFor;
        definition.updatedAt = currentIso;
        if (definition.schedule.type === "once") {
          definition.enabled = false;
          definition.nextRunAt = null;
        } else {
          definition.nextRunAt = computeNextAutomationRunAtAfter(definition.schedule, scheduledFor, currentIso, this.jitter(definition.id));
        }
      }
      if (due.length > 0) {
        this.pruneRuns();
        await this.persist();
        this.emit();
        for (const item of skippedRuns) {
          this.options.notify(structuredClone(item.definition), structuredClone(item.run));
        }
        this.drainQueue();
      }
    } finally {
      this.ticking = false;
      this.schedule();
    }
  }

  private drainQueue(): void {
    if (this.disposed) return;
    while (this.activeRunIds.size < MAX_CONCURRENT_RUNS) {
      const next = [...this.data.runs].reverse().find((run) => run.status === "queued" && !this.activeRunIds.has(run.id));
      if (!next) return;
      this.activeRunIds.add(next.id);
      void this.execute(next.id).finally(() => {
        this.activeRunIds.delete(next.id);
        this.drainQueue();
      });
    }
  }

  private async execute(runId: string): Promise<void> {
    const run = this.data.runs.find((item) => item.id === runId);
    const definition = run ? this.data.automations.find((item) => item.id === run.automationId) : undefined;
    if (!run || run.status !== "queued") return;
    if (!definition) {
      await this.finishAutomationRun(run, "cancelled", "Automation was deleted before the run started.");
      return;
    }
    try {
      const project = this.options.store.getProject(definition.projectId);
      if (!project || !await pathExists(project.path)) throw new Error("The automation project folder is unavailable.");
      const status = await this.options.runtime.ensure();
      const engine = this.options.runtime.currentLaunch();
      if (!status.available || !engine) throw new Error(status.message);
      const workspacePath = await this.resolveWorkspace(definition, project.path);
      const thread = await this.resolveThread(definition);
      if (this.options.runner.isRunning(thread.id)) throw new Error("The destination chat is already running.");

      run.status = "running";
      run.threadId = thread.id;
      run.workspacePath = workspacePath;
      run.startedAt = nowIso();
      this.runByThread.set(thread.id, run.id);
      await this.persist();
      this.emit();

      await this.options.store.beginRun(
        thread.id,
        definition.prompt,
        [],
        definition.model,
        definition.effort,
        definition.permission,
        { select: false, title: definition.name },
      );
      const request = {
        threadId: thread.id,
        prompt: definition.prompt,
        attachments: [],
        model: definition.model,
        effort: definition.effort,
        permission: definition.permission,
        additionalDirectories: (project.sourcePaths ?? []).filter((path) => resolve(path) !== resolve(project.path)),
      };
      let completed = false;
      const callbacks: CliRunCallbacks = {
        onEvent: (event) => {
          this.options.onRunEvent(event);
          if (event.type === "context") void this.options.store.recordContextUsage(thread.id, event.context);
        },
        onComplete: async (result) => {
          if (completed) return;
          completed = true;
          const timeout = this.timeouts.get(run.id);
          if (timeout) clearTimeout(timeout);
          this.timeouts.delete(run.id);
          await this.options.finishThread(
            thread.id,
            result.content,
            result.status,
            result.sessionId,
            result.error,
            result.activity,
            result.durationMs,
            result.timeline,
            result.fileChanges,
            true,
            false,
          );
          const cancellationReason = run.error;
          const requestedCancellation = typeof cancellationReason === "string"
            && (cancellationReason === "Cancellation requested." || cancellationReason.startsWith("Stopped after "));
          const runStatus: AutomationRunStatus = requestedCancellation || result.status === "cancelled"
            ? "cancelled"
            : result.status === "error" ? "failed" : "succeeded";
          await this.finishAutomationRun(
            run,
            runStatus,
            result.content,
            result.error ? result.content : runStatus === "cancelled" ? cancellationReason : undefined,
          );
          if (this.options.runner.isRunning(thread.id)) this.options.runner.stop(thread.id);
        },
      };
      this.options.runner.start(
        engine,
        request,
        workspacePath,
        definition.destination === "new_chat" ? undefined : thread.cliSessionId,
        callbacks,
        this.options.bridgeFor(thread.id, project.id, workspacePath),
        definition.destination === "new_chat" ? undefined : thread.contextUsage,
      );
      const timeout = setTimeout(() => {
        run.error = `Stopped after ${definition.maxRuntimeMinutes} minutes.`;
        this.options.runner.stop(thread.id);
      }, definition.maxRuntimeMinutes * 60_000);
      timeout.unref?.();
      this.timeouts.set(run.id, timeout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (run.threadId && this.options.store.getThread(run.threadId)?.status === "running") {
        await this.options.finishThread(run.threadId, message, "error", undefined, true);
      }
      await this.finishAutomationRun(run, "failed", message, message);
    }
  }

  private async finishAutomationRun(run: AutomationRun, status: AutomationRunStatus, summary: string, error?: string): Promise<void> {
    const timeout = this.timeouts.get(run.id);
    if (timeout) clearTimeout(timeout);
    this.timeouts.delete(run.id);
    if (run.threadId) this.runByThread.delete(run.threadId);
    run.status = status;
    run.finishedAt = nowIso();
    run.summary = text(summary, 2_000);
    if (error) run.error = text(error, 2_000);
    else delete run.error;
    run.unread = true;
    const definition = this.data.automations.find((item) => item.id === run.automationId);
    if (definition) {
      definition.lastRunAt = run.finishedAt;
      definition.lastRunStatus = status;
      definition.updatedAt = run.finishedAt;
    }
    await this.persist();
    this.emit();
    if (definition) this.options.notify(structuredClone(definition), structuredClone(run));
  }

  private async resolveThread(definition: AutomationDefinition) {
    if (definition.destination === "existing_chat") {
      const thread = definition.threadId ? this.options.store.getThread(definition.threadId) : undefined;
      if (!thread || thread.projectId !== definition.projectId) throw new Error("The automation's existing chat is unavailable.");
      return thread;
    }
    if (definition.destination === "dedicated_chat" && definition.threadId) {
      const existing = this.options.store.getThread(definition.threadId);
      if (existing && existing.projectId === definition.projectId) return existing;
    }
    const thread = await this.options.store.createBackgroundThread(definition.projectId, definition.name);
    if (definition.destination === "dedicated_chat") {
      definition.threadId = thread.id;
      definition.updatedAt = nowIso();
      await this.persist();
    }
    return thread;
  }

  private async resolveWorkspace(definition: AutomationDefinition, projectPath: string): Promise<string> {
    if (definition.workspaceMode === "local") return projectPath;
    const repository = await runGit(["rev-parse", "--show-toplevel"], projectPath);
    if (repository.code !== 0) {
      if (definition.workspaceMode === "auto" || definition.allowLocalFallback) return projectPath;
      throw new Error("Worktree mode requires a Git repository.");
    }
    const repositoryRoot = repository.stdout.trim();
    const projectRelativePath = relative(repositoryRoot, resolve(projectPath));
    const worktreePath = join(this.worktreeRoot, definition.id);
    const targetPath = projectRelativePath && projectRelativePath !== "." ? join(worktreePath, projectRelativePath) : worktreePath;
    try {
      if (await pathExists(worktreePath)) {
        const existing = await runGit(["rev-parse", "--show-toplevel"], worktreePath);
        if (existing.code !== 0) throw new Error("The saved automation worktree is not a valid Git checkout.");
        return targetPath;
      }
      await mkdir(this.worktreeRoot, { recursive: true });
      const slug = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "task";
      const branch = `maximo/automation-${slug}-${definition.id.slice(0, 8)}`;
      let created = await runGit(["worktree", "add", "-b", branch, worktreePath, "HEAD"], repositoryRoot);
      if (created.code !== 0 && /already exists/u.test(created.stderr)) {
        created = await runGit(["worktree", "add", worktreePath, branch], repositoryRoot);
      }
      if (created.code !== 0) throw new Error(created.stderr.trim() || "Git could not create the automation worktree.");
      return targetPath;
    } catch (error) {
      if (definition.allowLocalFallback) return projectPath;
      throw error;
    }
  }
}
