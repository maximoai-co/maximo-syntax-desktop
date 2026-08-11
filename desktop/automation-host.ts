import { randomBytes } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import type { AutomationService } from "./automation-service.js";
import type { AutomationCreateInput, AutomationDefinition, AutomationSchedule, AutomationUpdateInput, PermissionMode } from "./types.js";

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const PIPE_PREFIX = "maximo-automation-host";

interface HostRequest {
  id?: string;
  capability?: string;
  action?: string;
  arguments?: unknown;
  context?: { threadId?: unknown; projectId?: unknown; workspaceRoot?: unknown };
}

interface CapabilityBinding {
  projectId: string;
  threadId: string;
  workspaceRoot: string;
  expiresAt: number;
}

const CAPABILITY_LIFETIME_MS = 24 * 60 * 60_000;

function defaultPipePath(): string {
  const uid = process.getuid?.() ?? "user";
  if (process.platform === "win32") return `\\\\.\\pipe\\${PIPE_PREFIX}-${process.pid}-${randomBytes(8).toString("hex")}`;
  return join("/tmp", `${PIPE_PREFIX}-${uid}-${process.pid}`, `${randomBytes(8).toString("hex")}.sock`);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : undefined;
}

function integerValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function compactDefinition(definition: AutomationDefinition) {
  const { prompt, ...summary } = definition;
  return {
    ...summary,
    promptPreview: prompt.slice(0, 500),
    promptLength: prompt.length,
  };
}

function scheduleFromHost(value: unknown): AutomationSchedule {
  const source = record(value);
  const type = source.type;
  if (type === "manual") return { type };
  if (type === "once") return { type, runAt: stringValue(source.run_at, 200) ?? "" };
  if (type === "interval") return { type, everyMinutes: Number(source.every_minutes) };
  const timezone = stringValue(source.timezone, 200) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (type === "daily" || type === "weekdays") {
    return { type, timeOfDay: stringValue(source.time_of_day, 20) ?? "", timezone };
  }
  if (type === "weekly") {
    return { type, dayOfWeek: Number(source.day_of_week), timeOfDay: stringValue(source.time_of_day, 20) ?? "", timezone };
  }
  if (type === "cron") return { type, expression: stringValue(source.expression, 500) ?? "", timezone };
  throw new Error("Choose a supported automation schedule.");
}

function permissionFromHost(value: unknown): PermissionMode | undefined {
  if (value === "bypassPermissions") return "full";
  if (value === "default" || value === "acceptEdits" || value === "plan" || value === "auto" || value === "full") return value;
  return undefined;
}

function createInput(argumentsValue: Record<string, unknown>, projectId: string): AutomationCreateInput {
  const destination = argumentsValue.destination;
  const workspaceMode = argumentsValue.workspace_mode;
  const notificationPolicy = argumentsValue.notification_policy;
  return {
    name: stringValue(argumentsValue.name, 160) ?? "",
    ...(stringValue(argumentsValue.description, 2_000) ? { description: stringValue(argumentsValue.description, 2_000) } : {}),
    prompt: stringValue(argumentsValue.prompt, 100_000) ?? "",
    projectId,
    schedule: scheduleFromHost(argumentsValue.schedule),
    ...(destination === "new_chat" || destination === "dedicated_chat" || destination === "existing_chat" ? { destination } : {}),
    ...(stringValue(argumentsValue.thread_id, 100) ? { threadId: stringValue(argumentsValue.thread_id, 100) } : {}),
    ...(stringValue(argumentsValue.model, 200) ? { model: stringValue(argumentsValue.model, 200) } : {}),
    ...(stringValue(argumentsValue.effort, 40) ? { effort: stringValue(argumentsValue.effort, 40) } : {}),
    ...(permissionFromHost(argumentsValue.permission_mode) ? { permission: permissionFromHost(argumentsValue.permission_mode) } : {}),
    ...(workspaceMode === "auto" || workspaceMode === "local" || workspaceMode === "worktree" ? { workspaceMode } : {}),
    ...(typeof argumentsValue.allow_local_fallback === "boolean" ? { allowLocalFallback: argumentsValue.allow_local_fallback } : {}),
    ...(notificationPolicy === "all" || notificationPolicy === "failures_only" || notificationPolicy === "none" ? { notificationPolicy } : {}),
    ...(typeof argumentsValue.max_runtime_minutes === "number" ? { maxRuntimeMinutes: argumentsValue.max_runtime_minutes } : {}),
    ...(typeof argumentsValue.enabled === "boolean" ? { enabled: argumentsValue.enabled } : {}),
  };
}

function updateInput(argumentsValue: Record<string, unknown>): AutomationUpdateInput {
  const input: AutomationUpdateInput = {};
  if ("name" in argumentsValue) input.name = stringValue(argumentsValue.name, 160) ?? "";
  if ("description" in argumentsValue) input.description = typeof argumentsValue.description === "string" ? argumentsValue.description.slice(0, 2_000) : "";
  if ("prompt" in argumentsValue) input.prompt = stringValue(argumentsValue.prompt, 100_000) ?? "";
  if ("schedule" in argumentsValue) input.schedule = scheduleFromHost(argumentsValue.schedule);
  if (argumentsValue.destination === "new_chat" || argumentsValue.destination === "dedicated_chat" || argumentsValue.destination === "existing_chat") input.destination = argumentsValue.destination;
  if ("thread_id" in argumentsValue) input.threadId = typeof argumentsValue.thread_id === "string" ? argumentsValue.thread_id.slice(0, 100) : "";
  if ("model" in argumentsValue) input.model = typeof argumentsValue.model === "string" ? argumentsValue.model.slice(0, 200) : "";
  if ("effort" in argumentsValue) input.effort = typeof argumentsValue.effort === "string" ? argumentsValue.effort.slice(0, 40) : "";
  const permission = permissionFromHost(argumentsValue.permission_mode);
  if (permission) input.permission = permission;
  if (argumentsValue.workspace_mode === "auto" || argumentsValue.workspace_mode === "local" || argumentsValue.workspace_mode === "worktree") input.workspaceMode = argumentsValue.workspace_mode;
  if (typeof argumentsValue.allow_local_fallback === "boolean") input.allowLocalFallback = argumentsValue.allow_local_fallback;
  if (argumentsValue.notification_policy === "all" || argumentsValue.notification_policy === "failures_only" || argumentsValue.notification_policy === "none") input.notificationPolicy = argumentsValue.notification_policy;
  if (typeof argumentsValue.max_runtime_minutes === "number") input.maxRuntimeMinutes = argumentsValue.max_runtime_minutes;
  if (typeof argumentsValue.enabled === "boolean") input.enabled = argumentsValue.enabled;
  return input;
}

export class AutomationHostServer {
  private readonly pipePath = defaultPipePath();
  private readonly capabilities = new Map<string, CapabilityBinding>();
  private server: Server | null = null;

  constructor(private readonly service: AutomationService) {}

  launchEnvironment(threadId: string, projectId: string, workspaceRoot: string): Record<string, string> {
    const now = Date.now();
    for (const [token, binding] of this.capabilities) {
      if (binding.expiresAt <= now) this.capabilities.delete(token);
    }
    const capability = randomBytes(32).toString("base64url");
    this.capabilities.set(capability, {
      threadId,
      projectId,
      workspaceRoot,
      expiresAt: now + CAPABILITY_LIFETIME_MS,
    });
    return {
      MAXIMO_SYNTAX_AUTOMATION_HOST_PIPE: this.pipePath,
      MAXIMO_SYNTAX_AUTOMATION_HOST_CAPABILITY: capability,
      MAXIMO_SYNTAX_DESKTOP_THREAD_ID: threadId,
      MAXIMO_SYNTAX_DESKTOP_PROJECT_ID: projectId,
      MAXIMO_SYNTAX_DESKTOP_WORKSPACE_ROOT: workspaceRoot,
    };
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (process.platform !== "win32") {
      await mkdir(dirname(this.pipePath), { recursive: true, mode: 0o700 });
      await unlink(this.pipePath).catch(() => undefined);
    }
    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(this.pipePath, () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    this.server = server;
    if (process.platform !== "win32") await chmod(this.pipePath, 0o600);
  }

  async dispose(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    this.capabilities.clear();
    if (process.platform !== "win32") await unlink(this.pipePath).catch(() => undefined);
  }

  private accept(socket: Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) {
        handled = true;
        this.reply(socket, undefined, undefined, "Automation request was too large.");
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      void this.handle(socket, buffer.slice(0, newline));
    });
    socket.on("error", () => undefined);
  }

  private async handle(socket: Socket, line: string): Promise<void> {
    let request: HostRequest;
    try {
      request = JSON.parse(line) as HostRequest;
    } catch {
      this.reply(socket, undefined, undefined, "Invalid automation request.");
      return;
    }
    const id = typeof request.id === "string" ? request.id : undefined;
    const binding = typeof request.capability === "string" ? this.capabilities.get(request.capability) : undefined;
    if (!binding || binding.expiresAt <= Date.now()) {
      if (typeof request.capability === "string") this.capabilities.delete(request.capability);
      this.reply(socket, id, undefined, "Automation capability was rejected.");
      return;
    }
    const args = record(request.arguments);
    try {
      const result = await this.dispatch(request.action ?? "", binding.projectId, args);
      this.reply(socket, id, result);
    } catch (error) {
      this.reply(socket, id, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  private assertProject(automationId: string, projectId: string): void {
    const definition = this.service.get(automationId);
    if (!definition || definition.projectId !== projectId) throw new Error("Automation not found in this project.");
  }

  private async dispatch(action: string, projectId: string, args: Record<string, unknown>): Promise<unknown> {
    const automationId = stringValue(args.automation_id, 100);
    if (action === "list") {
      const snapshot = this.service.snapshot(projectId);
      return {
        automations: snapshot.automations.map(compactDefinition),
        activeCount: snapshot.activeCount,
        unreadCount: snapshot.unreadCount,
      };
    }
    if (action === "create") {
      const existingIds = new Set(this.service.snapshot(projectId).automations.map((item) => item.id));
      const snapshot = await this.service.create(createInput(args, projectId));
      return snapshot.automations.find((item) => item.projectId === projectId && !existingIds.has(item.id));
    }
    if (!automationId && action !== "cancel_run") throw new Error(`${action || "This action"} requires automation_id.`);
    if (automationId) this.assertProject(automationId, projectId);
    if (action === "get") return this.service.get(automationId!);
    if (action === "update") {
      await this.service.update(automationId!, updateInput(args));
      return this.service.get(automationId!);
    }
    if (action === "pause") {
      await this.service.setEnabled(automationId!, false);
      return this.service.get(automationId!);
    }
    if (action === "resume") {
      await this.service.setEnabled(automationId!, true);
      return this.service.get(automationId!);
    }
    if (action === "delete") {
      await this.service.delete(automationId!);
      return { deleted: true, automation_id: automationId };
    }
    if (action === "run_now") {
      await this.service.runNow(automationId!);
      const run = this.service.listRuns(automationId!).find((item) => item.trigger === "manual" && (item.status === "queued" || item.status === "running"));
      return { automation: this.service.get(automationId!), run };
    }
    if (action === "list_runs") {
      const runs = this.service.listRuns(automationId!);
      const offset = integerValue(args.offset, 0, 0, Math.max(0, runs.length));
      const limit = integerValue(args.limit, 50, 1, 200);
      return { runs: runs.slice(offset, offset + limit), total: runs.length, offset, limit };
    }
    if (action === "mark_runs_read") {
      await this.service.markRunsRead(automationId!);
      return { success: true };
    }
    if (action === "cancel_run") {
      const runId = stringValue(args.run_id, 100);
      if (!runId) throw new Error("cancel_run requires run_id.");
      const snapshot = this.service.snapshot(projectId);
      if (!snapshot.runs.some((run) => run.id === runId)) throw new Error("Automation run not found in this project.");
      await this.service.cancelRun(runId);
      return { cancelled: true, run_id: runId };
    }
    throw new Error(`Unsupported automation action: ${action}`);
  }

  private reply(socket: Socket, id?: string, result?: unknown, error?: string): void {
    socket.end(`${JSON.stringify(error ? { id, ok: false, error: { message: error.slice(0, 2_000) } } : { id, ok: true, result })}\n`);
  }
}
