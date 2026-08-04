import { spawn, type ChildProcessByStdio } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { EngineLaunch } from "./runtime-manager.js";
import { MAX_ATTACHMENT_COUNT } from "./types.js";
import type { AgentProgress, AgentRun, AgentStatus, AgentUsage, AgentWorkItem, Attachment, ClassifierDecision, ContextApiUsage, ContextUsage, FileChange, PermissionMode, RunActivity, RunEvent, RunRequest, RunTimelineItem, SlashCommand, ThreadStatus, TodoItem, TodoStatus } from "./types.js";

/** Prefix used by the CLI for auto-mode classifier denials (see messages.ts). */
export const CLASSIFIER_DENIAL_PREFIX = "Permission for this action has been denied. Reason: ";

interface ParsedUpdate {
  sessionId?: string;
  commands?: SlashCommand[];
  skills?: SlashCommand[];
  text?: string;
  textMode?: "append" | "replace";
  activity?: string;
  /** Raw SDK status value emitted by the CLI (e.g. "compacting"). Null means the status cleared (compaction finished). */
  status?: string | null;
  detail?: string;
  data?: string;
  toolUseId?: string;
  toolName?: string;
  parentToolUseId?: string;
  requestId?: string;
  result?: string;
  isError?: boolean;
  interactive?: "question" | "permission";
  activities?: Array<{ activity: string; detail?: string; data?: string; todos?: TodoItem[]; toolUseId?: string; toolName?: string }>;
  todos?: TodoItem[];
  toolResults?: Array<{ toolUseId: string; result?: string; isError?: boolean; classifierDecision?: ClassifierDecision }>;
  classifierDecision?: ClassifierDecision & { toolUseId: string; toolName?: string };
  agentStarted?: { taskId: string; toolUseId?: string; description: string; taskType?: string };
  agentProgress?: { taskId: string; toolUseId?: string; description?: string; lastToolName?: string; summary?: string; usage?: AgentUsage };
  agentFinished?: { taskId: string; toolUseId?: string; status: Exclude<AgentStatus, "running">; summary?: string; outputFile?: string; usage?: AgentUsage };
  contextRequestId?: string;
  contextUsage?: ContextUsage;
  apiUsage?: ContextApiUsage;
  apiUsageDelta?: Partial<ContextApiUsage>;
  apiUsageReset?: boolean;
  model?: string;
  modelUsage?: Record<string, { contextWindow?: number; maxOutputTokens?: number }>;
}

export function parseClassifierDenial(result?: string): ClassifierDecision | undefined {
  if (!result?.startsWith(CLASSIFIER_DENIAL_PREFIX)) return undefined;
  const reason = result.slice(CLASSIFIER_DENIAL_PREFIX.length).split(".")[0]?.trim();
  return {
    decision: "denied",
    classifier: "auto-mode",
    ...(reason ? { reason } : {}),
  };
}

function parseAgentUsage(value: unknown): AgentUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const totalTokens = typeof usage.total_tokens === "number" && Number.isFinite(usage.total_tokens) ? usage.total_tokens : undefined;
  const toolUses = typeof usage.tool_uses === "number" && Number.isFinite(usage.tool_uses) ? usage.tool_uses : undefined;
  const durationMs = typeof usage.duration_ms === "number" && Number.isFinite(usage.duration_ms) ? usage.duration_ms : undefined;
  if (totalTokens === undefined && toolUses === undefined && durationMs === undefined) return undefined;
  return { ...(totalTokens === undefined ? {} : { totalTokens }), ...(toolUses === undefined ? {} : { toolUses }), ...(durationMs === undefined ? {} : { durationMs }) };
}

function parseAgentTerminalStatus(value: unknown): Exclude<AgentStatus, "running"> | undefined {
  if (value === "completed") return "completed";
  if (value === "failed") return "error";
  if (value === "stopped" || value === "killed") return "stopped";
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseContextApiUsage(value: unknown): ContextApiUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const inputTokens = finiteNumber(usage.input_tokens);
  const outputTokens = finiteNumber(usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: finiteNumber(usage.cache_creation_input_tokens) ?? 0,
    cache_read_input_tokens: finiteNumber(usage.cache_read_input_tokens) ?? 0,
  };
}

function parseContextApiUsageDelta(value: unknown): Partial<ContextApiUsage> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const parsed: Partial<ContextApiUsage> = {};
  for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"] as const) {
    const number = finiteNumber(usage[key]);
    if (number !== undefined) parsed[key] = number;
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseModelUsage(value: unknown): Record<string, { contextWindow?: number; maxOutputTokens?: number }> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, { contextWindow?: number; maxOutputTokens?: number }> = {};
  for (const [model, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const usage = raw as Record<string, unknown>;
    const contextWindow = finiteNumber(usage.contextWindow);
    const maxOutputTokens = finiteNumber(usage.maxOutputTokens);
    if (contextWindow === undefined && maxOutputTokens === undefined) continue;
    result[model] = {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function contextWindowFromModelUsage(
  modelUsage: ParsedUpdate["modelUsage"],
  model?: string,
): number | undefined {
  if (!modelUsage) return undefined;
  const exact = model ? modelUsage[model]?.contextWindow : undefined;
  if (exact !== undefined && exact > 0) return exact;
  return Object.values(modelUsage).find((usage) => usage.contextWindow !== undefined && usage.contextWindow > 0)?.contextWindow;
}

function buildFastContextUsage(apiUsage: ContextApiUsage, model: string | undefined, contextWindow: number | undefined, previous?: ContextUsage | null): ContextUsage {
  const usedTokens = Math.max(0, apiUsage.input_tokens + apiUsage.cache_creation_input_tokens + apiUsage.cache_read_input_tokens + apiUsage.output_tokens);
  const maxTokens = contextWindow && contextWindow > 0 ? contextWindow : previous?.maxTokens && previous.maxTokens > 0 ? previous.maxTokens : 200_000;
  const boundedUsed = Math.min(maxTokens, usedTokens);
  return {
    categories: [
      { name: "Current context", tokens: boundedUsed, color: "messages" },
      { name: "Free space", tokens: Math.max(0, maxTokens - boundedUsed), color: "promptBorder" },
    ],
    totalTokens: boundedUsed,
    totalProcessedTokens: usedTokens,
    maxTokens,
    rawMaxTokens: maxTokens,
    percentage: Math.round((boundedUsed / maxTokens) * 100),
    model: model?.trim() || previous?.model || "Maximo Syntax",
    lastInputTokens: apiUsage.input_tokens,
    lastOutputTokens: apiUsage.output_tokens,
    lastCachedInputTokens: apiUsage.cache_creation_input_tokens + apiUsage.cache_read_input_tokens,
    ...(previous?.autoCompactThreshold === undefined ? {} : { autoCompactThreshold: previous.autoCompactThreshold }),
    ...(previous?.isAutoCompactEnabled === undefined ? {} : { isAutoCompactEnabled: previous.isAutoCompactEnabled }),
    apiUsage,
  };
}

function buildInitialContextUsage(model: string, contextWindow = 200_000): ContextUsage {
  return {
    categories: [
      { name: "Current context", tokens: 0, color: "messages" },
      { name: "Free space", tokens: contextWindow, color: "promptBorder" },
    ],
    totalTokens: 0,
    maxTokens: contextWindow,
    rawMaxTokens: contextWindow,
    percentage: 0,
    model: model.trim() || "Maximo Syntax",
    compactsAutomatically: true,
  };
}

function mergeContextApiUsage(base: ContextApiUsage | undefined, delta: Partial<ContextApiUsage>): ContextApiUsage {
  return {
    input_tokens: delta.input_tokens ?? base?.input_tokens ?? 0,
    output_tokens: delta.output_tokens ?? base?.output_tokens ?? 0,
    cache_creation_input_tokens: delta.cache_creation_input_tokens ?? base?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: delta.cache_read_input_tokens ?? base?.cache_read_input_tokens ?? 0,
  };
}

function parseContextUsage(value: unknown): ContextUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const categories = Array.isArray(source.categories)
    ? source.categories.flatMap((item): ContextUsage["categories"] => {
        if (!item || typeof item !== "object") return [];
        const category = item as Record<string, unknown>;
        const name = typeof category.name === "string" ? category.name.trim() : "";
        const tokens = finiteNumber(category.tokens);
        if (!name || tokens === undefined || tokens < 0) return [];
        return [{
          name,
          tokens,
          ...(typeof category.color === "string" ? { color: category.color } : {}),
          ...(category.isDeferred === true ? { isDeferred: true } : {}),
        }];
      })
    : [];
  const totalTokens = finiteNumber(source.totalTokens);
  const rawMaxTokens = finiteNumber(source.rawMaxTokens);
  const maxTokens = finiteNumber(source.maxTokens) ?? rawMaxTokens;
  const percentage = finiteNumber(source.percentage);
  const model = typeof source.model === "string" ? source.model.trim() : "";
  if (categories.length === 0 || totalTokens === undefined || maxTokens === undefined || maxTokens <= 0 || percentage === undefined || !model) return undefined;

  const rawApiUsage = source.apiUsage;
  let apiUsage: ContextUsage["apiUsage"];
  if (rawApiUsage === null) {
    apiUsage = null;
  } else if (rawApiUsage && typeof rawApiUsage === "object") {
    const usage = rawApiUsage as Record<string, unknown>;
    const inputTokens = finiteNumber(usage.input_tokens);
    const outputTokens = finiteNumber(usage.output_tokens);
    const cacheCreation = finiteNumber(usage.cache_creation_input_tokens);
    const cacheRead = finiteNumber(usage.cache_read_input_tokens);
    apiUsage = inputTokens !== undefined && outputTokens !== undefined && cacheCreation !== undefined && cacheRead !== undefined
      ? { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead }
      : undefined;
  }

  return {
    categories,
    totalTokens,
    maxTokens,
    rawMaxTokens: rawMaxTokens ?? maxTokens,
    percentage,
    model,
    ...(finiteNumber(source.autoCompactThreshold) !== undefined ? { autoCompactThreshold: finiteNumber(source.autoCompactThreshold) } : {}),
    ...(typeof source.isAutoCompactEnabled === "boolean" ? { isAutoCompactEnabled: source.isAutoCompactEnabled } : {}),
    ...(apiUsage !== undefined ? { apiUsage } : {}),
  };
}

export function parseCliMessage(value: unknown): ParsedUpdate {
  if (!value || typeof value !== "object") return {};
  const message = value as Record<string, unknown>;
  const sessionId = typeof message.session_id === "string" ? message.session_id : undefined;
  const parentToolUseId = typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : undefined;

  if (message.type === "control_request") {
    const request = message.request as Record<string, unknown> | undefined;
    const requestId = typeof message.request_id === "string" ? message.request_id : undefined;
    if (!request || !requestId || request.subtype !== "can_use_tool") return {};
    const toolName = typeof request.tool_name === "string" ? request.tool_name : "Tool";
    const input = request.input;
    const data = serializeToolInput(input) ?? "{}";
    return {
      sessionId,
      requestId,
      toolName,
      toolUseId: typeof request.tool_use_id === "string" ? request.tool_use_id : undefined,
      data,
      activity: `Permission requested for ${toolName}`,
      detail: summarizeToolInput(input),
      interactive: toolName === "AskUserQuestion" ? "question" : "permission",
    };
  }

  if (message.type === "control_response") {
    const response = message.response as Record<string, unknown> | undefined;
    const requestId = typeof response?.request_id === "string" ? response.request_id : undefined;
    if (!requestId) return {};
    if (response?.subtype !== "success") return { contextRequestId: requestId };
    const contextUsage = parseContextUsage(response.response);
    return { contextRequestId: requestId, ...(contextUsage ? { contextUsage } : {}) };
  }

  if (message.type === "stream_event") {
    const event = message.event as Record<string, unknown> | undefined;
    const delta = event?.delta as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") {
      return { sessionId, parentToolUseId, text: delta.text, textMode: "append" };
    }
    if (event?.type === "message_delta") {
      const apiUsage = parseContextApiUsage(event.usage);
      const apiUsageDelta = parseContextApiUsageDelta(event.usage);
      return { sessionId, parentToolUseId, ...(apiUsage ? { apiUsage } : {}), ...(apiUsageDelta ? { apiUsageDelta } : {}) };
    }
    if (event?.type === "message_start") {
      const apiUsageDelta = parseContextApiUsageDelta((event.message as Record<string, unknown> | undefined)?.usage);
      return { sessionId, parentToolUseId, apiUsageReset: true, ...(apiUsageDelta ? { apiUsageDelta } : {}) };
    }
  }

  if (message.type === "progress") {
    const data = message.data && typeof message.data === "object" ? message.data as Record<string, unknown> : undefined;
    const nestedMessage = data?.message;
    if (data?.type === "agent_progress" && nestedMessage && typeof nestedMessage === "object") {
      const nested = parseCliMessage(nestedMessage);
      const outerParent = typeof message.parentToolUseID === "string" ? message.parentToolUseID : typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : undefined;
      return { ...nested, ...(outerParent ? { parentToolUseId: outerParent } : {}) };
    }
  }

  if (message.type === "assistant") {
    const apiMessage = message.message as Record<string, unknown> | undefined;
    const apiUsage = parseContextApiUsage(apiMessage?.usage);
    const model = typeof apiMessage?.model === "string" ? apiMessage.model : undefined;
    const usageUpdate = {
      ...(apiUsage ? { apiUsage } : {}),
      ...(model ? { model } : {}),
    };
    const content = Array.isArray(apiMessage?.content) ? apiMessage.content : [];
    const text = content
      .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === "object" && (block as Record<string, unknown>).type === "text")
      .map((block) => String(block.text ?? ""))
      .join("\n");
    const tools = content.filter((block) => Boolean(block) && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use") as Record<string, unknown>[];
    if (tools.length > 0) {
      return {
        sessionId,
        parentToolUseId,
        ...usageUpdate,
        ...(text ? { text, textMode: "replace" as const } : {}),
        activities: tools.map((tool) => {
          const toolName = String(tool.name ?? "tool");
          return {
            activity: `Using ${toolName}`,
            detail: summarizeToolInput(tool.input),
            data: serializeToolInput(tool.input) ?? "",
            todos: toolName === "TodoWrite" ? parseTodoItems(tool.input) : undefined,
            toolUseId: typeof tool.id === "string" ? tool.id : undefined,
            toolName,
          };
        }),
      };
    }
    if (text || apiUsage) return { sessionId, parentToolUseId, ...usageUpdate, ...(text ? { text, textMode: "replace" as const } : {}) };
  }

  if (message.type === "user") {
    const apiMessage = message.message as Record<string, unknown> | undefined;
    const content = Array.isArray(apiMessage?.content) ? apiMessage.content : [];
    const toolResults = content.flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const result = block as Record<string, unknown>;
      if (result.type !== "tool_result" || typeof result.tool_use_id !== "string") return [];
      const text = typeof result.content === "string" ? result.content.slice(0, 12_000) : serializeToolInput(result.content);
      const isError = result.is_error === true;
      const classifierDecision = isError ? parseClassifierDenial(text) : undefined;
      return [{
        toolUseId: result.tool_use_id,
        result: text,
        isError,
        ...(classifierDecision ? { classifierDecision } : {}),
      }];
    });
    if (toolResults.length > 0) return { sessionId, parentToolUseId, toolResults };
  }

  if (message.type === "result") {
    const result = typeof message.result === "string" ? message.result : "";
    const isError = Boolean(message.is_error) || String(message.subtype ?? "").startsWith("error");
    const errors = Array.isArray(message.errors) ? message.errors.map(String).join("\n") : "";
    const modelUsage = parseModelUsage(message.modelUsage);
    return { sessionId, result: result || errors, isError, ...(modelUsage ? { modelUsage } : {}) };
  }

  if (message.type === "system") {
    const subtype = String(message.subtype ?? "");
    if (subtype === "init") {
      const commands = Array.isArray(message.slash_commands)
        ? message.slash_commands.flatMap((value): SlashCommand[] => typeof value === "string" && value.trim() ? [{ name: value.trim().replace(/^\//, "") }] : [])
        : [];
      const skills = Array.isArray(message.skills)
        ? message.skills.flatMap((value): SlashCommand[] => typeof value === "string" && value.trim() ? [{ name: value.trim().replace(/^\//, "") }] : [])
        : [];
      return { sessionId, commands, ...(skills.length > 0 ? { skills } : {}) };
    }
    if (subtype === "classifier_decision") {
      const toolUseId = typeof message.tool_use_id === "string" ? message.tool_use_id : undefined;
      const decision = message.decision === "allowed" || message.decision === "denied" ? message.decision : undefined;
      if (toolUseId && decision) {
        return {
          sessionId,
          classifierDecision: {
            toolUseId,
            toolName: typeof message.tool_name === "string" ? message.tool_name : undefined,
            decision,
            classifier: typeof message.classifier === "string" ? message.classifier : undefined,
            reason: typeof message.reason === "string" ? message.reason.slice(0, 2_000) : undefined,
          },
        };
      }
    }
    if (subtype === "task_started") {
      const taskId = typeof message.task_id === "string" ? message.task_id : undefined;
      if (taskId) {
        return {
          sessionId,
          agentStarted: {
            taskId,
            toolUseId: typeof message.tool_use_id === "string" ? message.tool_use_id : undefined,
            description: typeof message.description === "string" && message.description.trim() ? message.description.trim().slice(0, 500) : "Sub-agent task",
            taskType: typeof message.task_type === "string" ? message.task_type : undefined,
          },
        };
      }
    }
    if (subtype === "task_progress") {
      const taskId = typeof message.task_id === "string" ? message.task_id : undefined;
      if (taskId) {
        return {
          sessionId,
          agentProgress: {
            taskId,
            toolUseId: typeof message.tool_use_id === "string" ? message.tool_use_id : undefined,
            description: typeof message.description === "string" ? message.description.trim().slice(0, 500) : undefined,
            lastToolName: typeof message.last_tool_name === "string" ? message.last_tool_name : undefined,
            summary: typeof message.summary === "string" ? message.summary.trim().slice(0, 1_000) : undefined,
            usage: parseAgentUsage(message.usage),
          },
        };
      }
    }
    if (subtype === "task_notification") {
      const taskId = typeof message.task_id === "string" ? message.task_id : undefined;
      const status = parseAgentTerminalStatus(message.status);
      if (taskId && status) {
        return {
          sessionId,
          agentFinished: {
            taskId,
            toolUseId: typeof message.tool_use_id === "string" ? message.tool_use_id : undefined,
            status,
            summary: typeof message.summary === "string" ? message.summary.trim().slice(0, 1_000) : undefined,
            outputFile: typeof message.output_file === "string" && message.output_file ? message.output_file.slice(0, 2_000) : undefined,
            usage: parseAgentUsage(message.usage),
          },
        };
      }
    }
    if (subtype === "status") {
      if (typeof message.status === "string") return { sessionId, activity: String(message.status) };
      // The SDK emits status:null once the active status (e.g. compaction) clears.
      return { sessionId, status: null };
    }
    if (subtype.startsWith("hook_")) return { sessionId, activity: "Running project hook", detail: String(message.hook_name ?? "") };
  }
  if (message.type === "rate_limit_event") return { sessionId, activity: "Usage limits updated" };
  return { sessionId };
}

export function parseTodoItems(input: unknown): TodoItem[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const todos = (input as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return undefined;
  const parsed = todos.flatMap((value): TodoItem[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const status = item.status;
    if (!content || !["pending", "in_progress", "completed"].includes(String(status))) return [];
    return [{
      content: content.slice(0, 2_000),
      status: status as TodoStatus,
      ...(typeof item.activeForm === "string" ? { activeForm: item.activeForm.slice(0, 2_000) } : {}),
      ...(typeof item.id === "string" ? { id: item.id.slice(0, 100) } : {}),
    }];
  });
  return parsed.length > 0 ? parsed.slice(0, 100) : undefined;
}

function summarizeToolInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "command", "query", "pattern", "url"]) {
    if (typeof value[key] === "string") return value[key].slice(0, 160);
  }
  return undefined;
}

function serializeToolInput(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  try {
    const serialized = JSON.stringify(input, null, 2);
    return serialized.length > 12_000 ? `${serialized.slice(0, 12_000)}\n…` : serialized;
  } catch {
    return String(input).slice(0, 12_000);
  }
}

type DiffOperation = { type: "equal" | "added" | "removed"; text: string };
type TextFileSnapshot = { absolutePath: string; path: string; existed: boolean; comparable: boolean; content: string };

const MAX_DIFF_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_CELLS = 2_000_000;
const MAX_RUN_ACTIVITY_ITEMS = 500;
const MAX_RUN_TIMELINE_ITEMS = 800;
const MAX_FILE_SNAPSHOT_COUNT = 100;
const MAX_FILE_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_FILE_CHANGE_COUNT = 100;
const MAX_FILE_CHANGE_BYTES = 8 * 1024 * 1024;
const MAXIMO_PROJECTS_ROOT = resolve(homedir(), ".maximo", "projects");

function appendBounded<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

function isWithinPath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function splitDiffLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized) return [];
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

function diffOperations(before: string[], after: string[]): DiffOperation[] {
  if (before.length * after.length > MAX_DIFF_CELLS) {
    return [
      ...before.map((text) => ({ type: "removed" as const, text })),
      ...after.map((text) => ({ type: "added" as const, text })),
    ];
  }
  const table = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex]![afterIndex] = before[beforeIndex] === after[afterIndex]
        ? table[beforeIndex + 1]![afterIndex + 1]! + 1
        : Math.max(table[beforeIndex + 1]![afterIndex]!, table[beforeIndex]![afterIndex + 1]!);
    }
  }
  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    if (beforeIndex < before.length && afterIndex < after.length && before[beforeIndex] === after[afterIndex]) {
      operations.push({ type: "equal", text: before[beforeIndex]! });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (beforeIndex < before.length && (afterIndex >= after.length || table[beforeIndex + 1]![afterIndex]! >= table[beforeIndex]![afterIndex + 1]!)) {
      operations.push({ type: "removed", text: before[beforeIndex]! });
      beforeIndex += 1;
    } else {
      operations.push({ type: "added", text: after[afterIndex]! });
      afterIndex += 1;
    }
  }
  return operations;
}

function diffRangeStart(start: number, count: number): string {
  if (count === 0) return `${Math.max(0, start - 1)},0`;
  return count === 1 ? String(start) : `${start},${count}`;
}

export function buildUnifiedPatch(path: string, beforeContent: string, afterContent: string): FileChange {
  const operations = diffOperations(splitDiffLines(beforeContent), splitDiffLines(afterContent));
  const changedIndexes = operations.flatMap((operation, index) => operation.type === "equal" ? [] : [index]);
  if (changedIndexes.length === 0) return { path, patch: "", additions: 0, deletions: 0 };

  const context = 4;
  const hunks: Array<{ start: number; end: number }> = [];
  for (const changedIndex of changedIndexes) {
    const nextStart = Math.max(0, changedIndex - context);
    const nextEnd = Math.min(operations.length, changedIndex + context + 1);
    const previous = hunks.at(-1);
    if (previous && nextStart <= previous.end + context) previous.end = Math.max(previous.end, nextEnd);
    else hunks.push({ start: nextStart, end: nextEnd });
  }

  let oldLine = 1;
  let newLine = 1;
  const oldLineAt: number[] = [];
  const newLineAt: number[] = [];
  for (let index = 0; index <= operations.length; index += 1) {
    oldLineAt[index] = oldLine;
    newLineAt[index] = newLine;
    const operation = operations[index];
    if (!operation) continue;
    if (operation.type !== "added") oldLine += 1;
    if (operation.type !== "removed") newLine += 1;
  }

  const patchLines = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    let oldCount = 0;
    let newCount = 0;
    for (const operation of operations.slice(hunk.start, hunk.end)) {
      if (operation.type !== "added") oldCount += 1;
      if (operation.type !== "removed") newCount += 1;
    }
    patchLines.push(`@@ -${diffRangeStart(oldLineAt[hunk.start]!, oldCount)} +${diffRangeStart(newLineAt[hunk.start]!, newCount)} @@`);
    for (const operation of operations.slice(hunk.start, hunk.end)) {
      patchLines.push(`${operation.type === "added" ? "+" : operation.type === "removed" ? "-" : " "}${operation.text}`);
    }
  }
  return {
    path,
    patch: `${patchLines.join("\n")}\n`,
    additions: operations.filter((operation) => operation.type === "added").length,
    deletions: operations.filter((operation) => operation.type === "removed").length,
  };
}

function readTextFileSnapshot(absolutePath: string, path: string): TextFileSnapshot {
  try {
    const info = statSync(absolutePath);
    if (!info.isFile() || info.size > MAX_DIFF_FILE_BYTES) return { absolutePath, path, existed: true, comparable: false, content: "" };
    const bytes = readFileSync(absolutePath);
    if (bytes.includes(0)) return { absolutePath, path, existed: true, comparable: false, content: "" };
    return { absolutePath, path, existed: true, comparable: true, content: bytes.toString("utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { absolutePath, path, existed: false, comparable: true, content: "" };
    return { absolutePath, path, existed: true, comparable: false, content: "" };
  }
}

function activityFilePath(cwd: string, activity: { data?: string; detail?: string; toolName?: string; activity?: string }): TextFileSnapshot | undefined {
  if (!/edit|write|notebook|patch/i.test(activity.toolName ?? activity.activity ?? "")) return undefined;
  let candidate: unknown;
  if (activity.data) {
    try {
      const input = JSON.parse(activity.data) as Record<string, unknown>;
      for (const key of ["file_path", "path", "notebook_path"]) {
        if (typeof input[key] === "string") { candidate = input[key]; break; }
      }
    } catch { /* use the summarized detail */ }
  }
  if (typeof candidate !== "string") candidate = activity.detail;
  if (typeof candidate !== "string" || !candidate.trim()) return undefined;
  const absolutePath = resolve(cwd, candidate);
  const projectPath = relative(cwd, absolutePath).replace(/\\/g, "/");
  const insideProject = projectPath && projectPath !== "." && !projectPath.startsWith("../") && !isAbsolute(projectPath);
  if (insideProject) return readTextFileSnapshot(absolutePath, projectPath);
  // Syntax can persist project memory under this controlled directory. It is
  // outside the project root, but still safe to capture as a file change.
  if (!isWithinPath(MAXIMO_PROJECTS_ROOT, absolutePath)) return undefined;
  return readTextFileSnapshot(absolutePath, absolutePath);
}

function collectFileChanges(snapshots: Map<string, TextFileSnapshot>): FileChange[] {
  const changes: FileChange[] = [];
  let totalBytes = 0;
  for (const snapshot of snapshots.values()) {
    if (changes.length >= MAX_FILE_CHANGE_COUNT) break;
    const change = collectFileChange(snapshot);
    if (!change || totalBytes + change.patch.length > MAX_FILE_CHANGE_BYTES) continue;
    changes.push(change);
    totalBytes += change.patch.length;
  }
  return changes;
}

function collectFileChange(snapshot: TextFileSnapshot): FileChange | undefined {
  if (!snapshot.comparable) return undefined;
  const after = readTextFileSnapshot(snapshot.absolutePath, snapshot.path);
  if (!after.comparable) return undefined;
  if (!snapshot.existed && !after.existed) return undefined;
  if (snapshot.existed === after.existed && snapshot.content === after.content) return undefined;
  const change = buildUnifiedPatch(snapshot.path, snapshot.existed ? snapshot.content : "", after.existed ? after.content : "");
  return change.patch ? change : undefined;
}

function permissionArguments(permission: PermissionMode): string[] {
  if (permission === "full") return ["--dangerously-skip-permissions"];
  return ["--permission-mode", permission];
}

function applyClassifierDecision(
  turn: { activity: RunActivity[]; timeline: RunTimelineItem[]; pendingClassifier?: Map<string, ClassifierDecision> },
  toolUseId: string,
  decision: ClassifierDecision,
): void {
  let matched = false;
  for (const item of turn.activity) {
    if (item.toolUseId !== toolUseId) continue;
    item.classifierDecision = decision;
    matched = true;
  }
  for (const item of turn.timeline) {
    if (item.type !== "activity" || item.toolUseId !== toolUseId) continue;
    item.classifierDecision = decision;
    matched = true;
  }
  // Classifier can finish slightly before tool_use is parsed; attach when the activity arrives.
  if (!matched) {
    turn.pendingClassifier ??= new Map();
    turn.pendingClassifier.set(toolUseId, decision);
  } else {
    turn.pendingClassifier?.delete(toolUseId);
  }
}

function attachPendingClassifier(
  turn: { pendingClassifier?: Map<string, ClassifierDecision> },
  item: RunActivity,
): RunActivity {
  if (!item.toolUseId || !turn.pendingClassifier?.has(item.toolUseId)) return item;
  const decision = turn.pendingClassifier.get(item.toolUseId)!;
  turn.pendingClassifier.delete(item.toolUseId);
  item.classifierDecision = decision;
  return item;
}

/**
 * The CLI surfaces its SDK status (e.g. "compacting") as a status activity.
 * When the status clears (status:null) that activity must be removed so the
 * streaming UI no longer reports compaction as the current step.
 */
export function clearStatusActivity(turn: { activity: RunActivity[]; timeline: RunTimelineItem[] }): boolean {
  const statusIndexes = turn.activity
    .flatMap((item, index) => typeof item.label === "string" && item.label.trim().toLowerCase() === "compacting" ? [index] : []);
  if (statusIndexes.length === 0) return false;
  const statusTimestamps = new Set(statusIndexes.map((index) => turn.activity[index]!.timestamp));
  turn.activity = turn.activity.filter((_, index) => !statusIndexes.includes(index));
  turn.timeline = turn.timeline.filter((item) => !(item.type === "activity" && statusTimestamps.has(item.timestamp)));
  return true;
}

function isAgentTool(toolName?: string): boolean {
  return /^(?:agent|task)$/i.test(toolName?.trim() ?? "");
}

function agentActivityInput(activity?: RunActivity): Record<string, unknown> | undefined {
  if (!activity?.data) return undefined;
  try {
    const value = JSON.parse(activity.data);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function agentMetadata(turn: ActiveTurn, toolUseId?: string): { activity?: RunActivity; agentType?: string } {
  const activity = toolUseId
    ? [...turn.activity].reverse().find((item) => item.toolUseId === toolUseId)
    : [...turn.activity].reverse().find((item) => isAgentTool(item.toolName) && ![...turn.agents.values()].some((agent) => agent.toolUseId === item.toolUseId));
  const input = agentActivityInput(activity);
  const type = [input?.subagent_type, input?.agent_type, input?.name].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return { activity, agentType: type?.trim().slice(0, 200) };
}

function isAgentTask(turn: ActiveTurn, taskType?: string, toolUseId?: string): boolean {
  if (taskType && /agent|teammate/i.test(taskType)) return true;
  return Boolean(toolUseId && turn.activity.some((item) => item.toolUseId === toolUseId && isAgentTool(item.toolName)));
}

function updateAgentTimeline(turn: ActiveTurn, agent: AgentRun): void {
  const index = turn.timeline.findIndex((item) => item.type === "agent" && item.agent.taskId === agent.taskId);
  if (index < 0) {
    appendBounded(turn.timeline, { type: "agent", agent, timestamp: agent.startedAt }, MAX_RUN_TIMELINE_ITEMS);
    return;
  }
  const current = turn.timeline[index];
  if (current?.type === "agent") turn.timeline[index] = { ...current, agent };
}

function startAgent(turn: ActiveTurn, update: NonNullable<ParsedUpdate["agentStarted"]>, at: number): AgentRun {
  const metadata = agentMetadata(turn, update.toolUseId);
  const agent: AgentRun = {
    taskId: update.taskId,
    ...(update.toolUseId || metadata.activity?.toolUseId ? { toolUseId: update.toolUseId ?? metadata.activity?.toolUseId } : {}),
    description: update.description || metadata.activity?.detail || "Sub-agent task",
    ...(update.taskType ? { taskType: update.taskType } : {}),
    ...(metadata.agentType ? { agentType: metadata.agentType } : {}),
    status: "running",
    startedAt: at,
  };
  turn.agents.set(agent.taskId, agent);
  updateAgentTimeline(turn, agent);
  return agent;
}

function updateAgent(turn: ActiveTurn, taskId: string, patch: Partial<AgentRun>): AgentRun | undefined {
  const current = turn.agents.get(taskId);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  turn.agents.set(taskId, next);
  updateAgentTimeline(turn, next);
  return next;
}

function appendAgentWork(turn: ActiveTurn, taskId: string, work: AgentWorkItem): AgentRun | undefined {
  const current = turn.agents.get(taskId);
  if (!current) return undefined;
  const workItems = [...(current.work ?? [])];
  const previous = workItems.at(-1);
  if (work.type === "text" && work.mode === "append" && previous?.type === "text") {
    workItems[workItems.length - 1] = { ...previous, text: previous.text + work.text, timestamp: work.timestamp };
  } else if (work.type === "activity" && work.toolUseId) {
    let existingIndex = -1;
    for (let index = workItems.length - 1; index >= 0; index -= 1) {
      const item = workItems[index];
      if (item?.type === "activity" && item.toolUseId === work.toolUseId) { existingIndex = index; break; }
    }
    if (existingIndex >= 0) workItems[existingIndex] = { ...workItems[existingIndex], ...work };
    else workItems.push(work);
  } else {
    workItems.push(work);
  }
  return updateAgent(turn, taskId, { work: workItems.slice(-100) });
}

function appendAgentProgress(turn: ActiveTurn, taskId: string, progress: NonNullable<ParsedUpdate["agentProgress"]>, at: number): AgentRun | undefined {
  const step: AgentProgress = {
    ...(progress.description ? { description: progress.description } : {}),
    ...(progress.lastToolName ? { lastToolName: progress.lastToolName } : {}),
    ...(progress.summary ? { summary: progress.summary } : {}),
    ...(progress.usage ? { usage: progress.usage } : {}),
    timestamp: at,
  };
  const current = turn.agents.get(taskId);
  if (!current) return undefined;
  const next = updateAgent(turn, taskId, {
    ...(progress.toolUseId ? { toolUseId: progress.toolUseId } : {}),
    ...(progress.description ? { description: progress.description } : {}),
    ...(progress.lastToolName ? { lastToolName: progress.lastToolName } : {}),
    ...(progress.summary ? { summary: progress.summary } : {}),
    ...(progress.usage ? { usage: progress.usage } : {}),
    progress: [...(current.progress ?? []), step].slice(-100),
  });
  return next ? appendAgentWork(turn, taskId, {
    type: "activity",
    label: progress.description || "Agent progress",
    ...(progress.lastToolName ? { toolName: progress.lastToolName } : {}),
    ...(progress.summary ? { detail: progress.summary } : {}),
    timestamp: at,
  }) : undefined;
}

function isAsyncAgentResult(result?: string): boolean {
  return /async_launched/i.test(result ?? "");
}

export interface CliBrowserBridge {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function buildCliArguments(
  request: RunRequest,
  previousSessionId?: string,
  browserBridge?: CliBrowserBridge,
): string[] {
  const args = [
    "--print",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool", "stdio",
    ...permissionArguments(request.permission),
  ];
  if (request.model.trim()) args.push("--model", request.model.trim());
  if (request.effort.trim()) args.push("--effort", request.effort.trim());
  if (request.additionalDirectories?.length) args.push("--add-dir", ...request.additionalDirectories);
  if (browserBridge) {
    // The bridge is a Maximo-owned MCP server. Keeping its configuration in the
    // child process avoids vendor-specific browser assumptions and gives every
    // CLI run a private, thread-scoped browser capability.
    args.push(
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          "maximo-browser": {
            type: "stdio",
            command: browserBridge.command,
            args: browserBridge.args,
            env: Object.fromEntries(
              Object.keys(browserBridge.env).map((key) => [key, `\${${key}}`]),
            ),
          },
        },
      }),
      "--append-system-prompt",
      "Maximo Syntax Desktop provides a shared in-app browser through the Maximo browser_* tools. When a user asks you to open, inspect, navigate, click, type, scroll, screenshot, or otherwise interact with a website, use the available mcp__maximo-browser__browser_* tool directly without requiring the user to mention the tool name. The page is shared with the human in the Browser panel.",
    );
  }
  if (previousSessionId) args.push("--resume", previousSessionId);
  return args;
}

function formatAttachmentPath(path: string): string {
  const safePath = path.replace(/[\r\n]/g, " ");
  return safePath.includes('"') ? safePath : `@"${safePath}"`;
}

export function buildPrompt(request: RunRequest): string {
  const attachments = request.attachments.slice(0, MAX_ATTACHMENT_COUNT);
  if (attachments.length === 0) return request.prompt;
  // Plain paths are only text to the CLI; @-mentions invoke its native
  // image/PDF/text attachment pipeline and leave binary files available to
  // the appropriate tool.
  const files = attachments.map((attachment) => `- ${formatAttachmentPath(attachment.path)}`).join("\n");
  return `Files attached by the user. Treat these paths as attached context and inspect them with Read or the appropriate tool:\n${files}\n\nRequest:\n${request.prompt}`;
}

export interface PermissionResponse {
  requestId: string;
  behavior: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
  toolUseID?: string;
  updatedPermissions?: unknown[];
}

export interface CliRunCallbacks {
  onEvent: (event: RunEvent) => void;
  onComplete: (result: { status: ThreadStatus; content: string; sessionId?: string; exitCode: number | null; error: boolean; final: boolean; continueRunning?: boolean; activity: RunActivity[]; timeline: RunTimelineItem[]; durationMs: number; fileChanges: FileChange[] }) => Promise<void>;
}

type CompletedTurn = { status: ThreadStatus; content: string; sessionId?: string; exitCode: number | null; error: boolean; final: boolean; continueRunning?: boolean; activity: RunActivity[]; timeline: RunTimelineItem[]; durationMs: number; fileChanges: FileChange[] };

type ActiveTurn = {
  startedAt: number;
  streamedText: string;
  finalResult: string;
  resultWasError: boolean;
  activity: RunActivity[];
  timeline: RunTimelineItem[];
  agents: Map<string, AgentRun>;
  fileSnapshots: Map<string, TextFileSnapshot>;
  fileSnapshotBytes: number;
  toolSnapshots: Map<string, TextFileSnapshot>;
  pendingClassifier?: Map<string, ClassifierDecision>;
  lastApiUsage?: ContextApiUsage;
  currentMessageUsage?: ContextApiUsage;
  lastModel?: string;
  contextWindow?: number;
  completed: boolean;
};

function writeUserMessage(child: Child, prompt: string): boolean {
  if (!child.stdin || child.stdin.destroyed) return false;
  child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`);
  return true;
}

function rememberFileSnapshot(turn: ActiveTurn, snapshot: TextFileSnapshot): boolean {
  if (turn.fileSnapshots.has(snapshot.absolutePath)) return true;
  const bytes = Buffer.byteLength(snapshot.content, "utf8");
  if (turn.fileSnapshots.size >= MAX_FILE_SNAPSHOT_COUNT || turn.fileSnapshotBytes + bytes > MAX_FILE_SNAPSHOT_BYTES) return false;
  turn.fileSnapshots.set(snapshot.absolutePath, snapshot);
  turn.fileSnapshotBytes += bytes;
  return true;
}

type Child = ChildProcessByStdio<Writable, Readable, Readable> & {
  __markStopped?: () => void;
  __send?: (prompt: string, attachments: Attachment[]) => boolean;
  __requestContext?: () => Promise<ContextUsage | null>;
  __pendingPrompt?: boolean;
};

export class CliRunner {
  private readonly processes = new Map<string, Child>();

  isRunning(threadId: string): boolean {
    return this.processes.has(threadId);
  }

  send(threadId: string, prompt: string, attachments: Attachment[]): boolean {
    const child = this.processes.get(threadId);
    if (!child?.__send) return false;
    if (child.__pendingPrompt) {
      // Keep the input in the runner until the current tool batch is complete.
      // It is then written to stream-json while the CLI is still in the same
      // query, allowing the fork's `next` queue to inject it before the next
      // model request.
      child.__send(prompt, attachments);
      return true;
    }
    return child.__send(prompt, attachments);
  }

  requestContext(threadId: string): Promise<ContextUsage | null> {
    const child = this.processes.get(threadId);
    return child?.__requestContext?.() ?? Promise.resolve(null);
  }

  respond(threadId: string, response: PermissionResponse): boolean {
    const child = this.processes.get(threadId);
    if (!child?.stdin || child.stdin.destroyed) return false;
    const payload = {
      type: "control_response",
      response: {
        subtype: "success",
        request_id: response.requestId,
        response: response.behavior === "allow"
          ? {
              behavior: "allow",
              updatedInput: response.updatedInput ?? {},
              ...(response.updatedPermissions ? { updatedPermissions: response.updatedPermissions } : {}),
              ...(response.toolUseID ? { toolUseID: response.toolUseID } : {}),
            }
          : {
              behavior: "deny",
              message: response.message ?? "Permission denied by the user.",
              ...(response.toolUseID ? { toolUseID: response.toolUseID } : {}),
            },
      },
    };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return true;
  }

  start(
    engine: EngineLaunch,
    request: RunRequest,
    cwd: string,
    previousSessionId: string | undefined,
    callbacks: CliRunCallbacks,
    browserBridge?: CliBrowserBridge,
  ): number {
    if (this.processes.has(request.threadId)) throw new Error("This chat is already running.");
    const args = [...engine.argsPrefix, ...buildCliArguments(request, previousSessionId, browserBridge)];
    const environment: NodeJS.ProcessEnv = {
      ...engine.environment,
      ...(browserBridge?.env ?? {}),
      // The desktop browser must be visible to the first model request. The
      // fork's deferred tool-search mode can hide MCP tools until the model
      // guesses a search phrase, so desktop runs use the inline MCP catalogue.
      ...(browserBridge ? { ENABLE_TOOL_SEARCH: "false" } : {}),
      MAXIMO_SYNTAX_DESKTOP: "1",
      MAXIMO_SYNTAX_ENVIRONMENT_KIND: "bridge",
      FORCE_COLOR: "0",
    };
    // Maximo's /models endpoint advertises reasoning as a provider capability,
    // so a desktop-selected effort must reach the OpenAI-compatible shim even
    // when the CLI has no explicit per-model effort list to validate against.
    if (request.effort.trim()) environment.MAXIMO_SYNTAX_ALWAYS_ENABLE_EFFORT = "1";

    const child = spawn(engine.command, args, {
      cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as Child;
    this.processes.set(request.threadId, child);
    const timestamp = () => Date.now();
    let latestContextUsage: ContextUsage | null = buildInitialContextUsage(request.model || "CLI default", request.contextWindow);
    callbacks.onEvent({ type: "started", threadId: request.threadId, pid: child.pid ?? -1, timestamp: timestamp() });
    callbacks.onEvent({ type: "context", threadId: request.threadId, context: latestContextUsage, timestamp: timestamp() });

    Object.defineProperty(child, "__send", {
      value: (prompt: string, attachments: Attachment[]) => {
        if (child.__pendingPrompt) {
          queuedFollowUps.push({ prompt, attachments });
          return true;
        }
        return beginTurn(prompt, attachments);
      },
    });

    Object.defineProperty(child, "__requestContext", { value: () => Promise.resolve(latestContextUsage) });

    let buffer = "";
    let stderrBuffer = "";
    let sessionId = previousSessionId;
    let stopped = false;
    let turn: ActiveTurn = {
      startedAt: Date.now(),
      streamedText: "",
      finalResult: "",
      resultWasError: false,
      activity: [],
      timeline: [],
      agents: new Map(),
      fileSnapshots: new Map(),
      fileSnapshotBytes: 0,
      toolSnapshots: new Map(),
      completed: false,
    };
    const publishContextUsage = () => {
      if (!turn.lastApiUsage) return;
      latestContextUsage = buildFastContextUsage(turn.lastApiUsage, turn.lastModel, turn.contextWindow, latestContextUsage);
      callbacks.onEvent({ type: "context", threadId: request.threadId, context: latestContextUsage, timestamp: timestamp() });
    };
    const publishContextWindow = (contextWindow: number | undefined) => {
      if (!latestContextUsage || contextWindow === undefined || contextWindow <= 0 || latestContextUsage.maxTokens === contextWindow) return;
      const usedTokens = Math.min(latestContextUsage.totalTokens, contextWindow);
      latestContextUsage = {
        ...latestContextUsage,
        totalTokens: usedTokens,
        maxTokens: contextWindow,
        rawMaxTokens: contextWindow,
        percentage: Math.round((usedTokens / contextWindow) * 100),
        categories: [
          { name: "Current context", tokens: usedTokens, color: "messages" },
          { name: "Free space", tokens: Math.max(0, contextWindow - usedTokens), color: "promptBorder" },
        ],
      };
      callbacks.onEvent({ type: "context", threadId: request.threadId, context: latestContextUsage, timestamp: timestamp() });
    };
    const finishTurn = (status: ThreadStatus, exitCode: number | null, final: boolean, continueRunning = false): Promise<void> => {
      if (turn.completed) return Promise.resolve();
      const current = turn;
      const unfinishedStatus: Exclude<AgentStatus, "running"> = status === "cancelled" ? "stopped" : status === "error" ? "error" : "completed";
      for (const agent of current.agents.values()) {
        if (agent.status !== "running") continue;
        const finished = updateAgent(current, agent.taskId, { status: unfinishedStatus, finishedAt: Date.now() });
        if (finished) callbacks.onEvent({ type: "agent-finished", threadId: request.threadId, taskId: finished.taskId, toolUseId: finished.toolUseId, status: unfinishedStatus, timestamp: timestamp() });
      }
      current.completed = true;
      const content = current.finalResult || current.streamedText || (status === "cancelled" ? "Run stopped." : stderrBuffer.trim() || "The Maximo Syntax engine exited without a response.");
      const completed: CompletedTurn = { status, content, sessionId, exitCode, error: status === "error", final, ...(continueRunning ? { continueRunning: true } : {}), activity: current.activity, timeline: current.timeline, durationMs: Math.max(0, Date.now() - current.startedAt), fileChanges: [] };
      return (async () => {
        try { completed.fileChanges = collectFileChanges(current.fileSnapshots); } catch (error) {
          callbacks.onEvent({ type: "log", threadId: request.threadId, level: "warning", text: error instanceof Error ? error.message : String(error), timestamp: timestamp() });
        }
        try { await callbacks.onComplete(completed); } catch (error) {
          callbacks.onEvent({ type: "log", threadId: request.threadId, level: "error", text: error instanceof Error ? error.message : String(error), timestamp: timestamp() });
        } finally {
          callbacks.onEvent({ type: "turn-complete", threadId: request.threadId, status, timestamp: timestamp() });
        }
      })();
    };
    const queuedFollowUps: Array<{ prompt: string; attachments: Attachment[] }> = [];
    const flushQueued = (betweenToolRounds: boolean) => {
      if (betweenToolRounds) {
        while (queuedFollowUps.length > 0 && !child.stdin?.destroyed) {
          const next = queuedFollowUps.shift();
          if (!next) return;
          // The Maximo Syntax CLI consumes this as a `next` queued command.
          // Do not start a second desktop turn here: the current query is
          // still alive and must see this context before its next API call.
          if (!writeUserMessage(child, buildPrompt({ ...request, prompt: next.prompt, attachments: next.attachments }))) {
            queuedFollowUps.unshift(next);
            return;
          }
        }
        return;
      }
      const next = queuedFollowUps.shift();
      if (!next || child.stdin?.destroyed) return;
      // A turn with no tool result has no in-query injection point. In that
      // case, fall back to the normal next desktop turn after the result.
      beginTurn(next.prompt, next.attachments);
    };
    const beginTurn = (prompt: string, attachments: Attachment[]) => {
      turn = { startedAt: Date.now(), streamedText: "", finalResult: "", resultWasError: false, activity: [], timeline: [], agents: new Map(), fileSnapshots: new Map(), fileSnapshotBytes: 0, toolSnapshots: new Map(), completed: false };
      stderrBuffer = "";
      child.__pendingPrompt = true;
      callbacks.onEvent({ type: "turn-started", threadId: request.threadId, timestamp: timestamp() });
      const wrote = writeUserMessage(child, buildPrompt({ ...request, prompt, attachments }));
      if (!wrote) {
        child.__pendingPrompt = false;
        void finishTurn("error", null, false).then(() => flushQueued(false));
      }
      return wrote;
    };
    beginTurn(request.prompt, request.attachments);

    const handleLine = (line: string) => {
      const clean = line.trim();
      if (!clean) return;
      try {
        const update = parseCliMessage(JSON.parse(clean));
        if (update.sessionId && update.sessionId !== sessionId) {
          sessionId = update.sessionId;
          callbacks.onEvent({ type: "session", threadId: request.threadId, sessionId, timestamp: timestamp() });
        }
        if (update.model && !update.parentToolUseId) turn.lastModel = update.model;
        if (update.apiUsage && !update.parentToolUseId) {
          turn.lastApiUsage = update.apiUsage;
          turn.currentMessageUsage = update.apiUsage;
          publishContextUsage();
        }
        if (update.apiUsageDelta && !update.parentToolUseId) {
          const baseUsage = update.apiUsageReset ? undefined : turn.currentMessageUsage;
          turn.currentMessageUsage = mergeContextApiUsage(baseUsage, update.apiUsageDelta);
          turn.lastApiUsage = turn.currentMessageUsage;
          publishContextUsage();
        }
        if (update.modelUsage) {
          turn.contextWindow = contextWindowFromModelUsage(update.modelUsage, turn.lastModel);
          publishContextWindow(turn.contextWindow);
          publishContextUsage();
        }
        if (update.commands) callbacks.onEvent({ type: "commands", threadId: request.threadId, commands: update.commands, ...(update.skills?.length ? { skills: update.skills } : {}), timestamp: timestamp() });
        if (update.status !== undefined) {
          const at = timestamp();
          if (update.status === null) {
            // The CLI cleared its status (e.g. compaction finished): drop the stale
            // status activity so the UI no longer shows "compacting" as the latest step.
            const cleared = clearStatusActivity(turn);
            if (cleared) callbacks.onEvent({ type: "log", threadId: request.threadId, level: "info", text: "Conversation compacted", timestamp: at });
          }
          callbacks.onEvent({ type: "status", threadId: request.threadId, status: update.status, timestamp: at });
        }
        if (update.text !== undefined && update.textMode) {
          turn.streamedText = update.textMode === "append" ? turn.streamedText + update.text : update.text;
          const at = timestamp();
          const last = turn.timeline.at(-1);
          if (last?.type === "text") last.text = update.textMode === "append" ? last.text + update.text : update.text;
          else appendBounded(turn.timeline, { type: "text", text: update.text, timestamp: at }, MAX_RUN_TIMELINE_ITEMS);
          callbacks.onEvent({ type: "text", threadId: request.threadId, text: update.text, mode: update.textMode, timestamp: at });
        }
        const parsedActivities = [
          ...(update.activity ? [{ activity: update.activity, detail: update.detail, data: update.data, todos: update.todos, toolUseId: update.toolUseId, toolName: update.toolName }] : []),
          ...(update.activities ?? []),
        ];
        const parentAgent = update.parentToolUseId
          ? [...turn.agents.values()].find((agent) => agent.toolUseId === update.parentToolUseId || agent.taskId === update.parentToolUseId)
          : undefined;
        if (parentAgent && !update.interactive && (update.text !== undefined || parsedActivities.length > 0 || (update.toolResults?.length ?? 0) > 0)) {
          if (update.text !== undefined && update.textMode) {
            const work: AgentWorkItem = { type: "text", text: update.text, mode: update.textMode, timestamp: timestamp() };
            appendAgentWork(turn, parentAgent.taskId, work);
            callbacks.onEvent({ type: "agent-work", threadId: request.threadId, taskId: parentAgent.taskId, work, timestamp: work.timestamp });
          }
          for (const parsedActivity of parsedActivities) {
            const file = activityFilePath(cwd, parsedActivity);
            if (file) {
              const retained = rememberFileSnapshot(turn, file);
              if (retained && parsedActivity.toolUseId) turn.toolSnapshots.set(parsedActivity.toolUseId, file);
            }
            const work: AgentWorkItem = {
              type: "activity",
              label: parsedActivity.activity,
              ...(parsedActivity.detail ? { detail: parsedActivity.detail } : {}),
              ...(parsedActivity.data ? { data: parsedActivity.data } : {}),
              ...(parsedActivity.toolUseId ? { toolUseId: parsedActivity.toolUseId } : {}),
              ...(parsedActivity.toolName ? { toolName: parsedActivity.toolName } : {}),
              timestamp: timestamp(),
            };
            appendAgentWork(turn, parentAgent.taskId, work);
            callbacks.onEvent({ type: "agent-work", threadId: request.threadId, taskId: parentAgent.taskId, work, timestamp: work.timestamp });
          }
          for (const toolResult of update.toolResults ?? []) {
            const existingWork = [...(turn.agents.get(parentAgent.taskId)?.work ?? [])].reverse().find((item) => item.type === "activity" && item.toolUseId === toolResult.toolUseId);
            const work: AgentWorkItem = {
              type: "activity",
              label: existingWork?.type === "activity" ? existingWork.label : "Tool result",
              toolUseId: toolResult.toolUseId,
              ...(existingWork?.type === "activity" && existingWork.detail ? { detail: existingWork.detail } : {}),
              ...(existingWork?.type === "activity" && existingWork.data ? { data: existingWork.data } : {}),
              ...(existingWork?.type === "activity" && existingWork.toolName ? { toolName: existingWork.toolName } : {}),
              ...(toolResult.result !== undefined ? { result: toolResult.result } : {}),
              ...(toolResult.isError !== undefined ? { isError: toolResult.isError } : {}),
              timestamp: timestamp(),
            };
            appendAgentWork(turn, parentAgent.taskId, work);
            callbacks.onEvent({ type: "agent-work", threadId: request.threadId, taskId: parentAgent.taskId, work, timestamp: work.timestamp });
          }
          return;
        }
        for (const parsedActivity of parsedActivities) {
          const file = activityFilePath(cwd, parsedActivity);
          if (file) {
            const retained = rememberFileSnapshot(turn, file);
            if (retained && parsedActivity.toolUseId) turn.toolSnapshots.set(parsedActivity.toolUseId, file);
          }
          const item = attachPendingClassifier(turn, {
            label: parsedActivity.activity,
            detail: parsedActivity.detail,
            data: parsedActivity.data,
            ...(parsedActivity.todos ? { todos: parsedActivity.todos } : {}),
            toolUseId: parsedActivity.toolUseId,
            toolName: parsedActivity.toolName,
            timestamp: timestamp(),
          });
          if (isAgentTool(item.toolName) && item.toolUseId) {
            const unlinkedAgent = [...turn.agents.values()].find((agent) => agent.status === "running" && !agent.toolUseId);
            if (unlinkedAgent) updateAgent(turn, unlinkedAgent.taskId, { toolUseId: item.toolUseId });
          }
           appendBounded(turn.activity, item, MAX_RUN_ACTIVITY_ITEMS);
           appendBounded(turn.timeline, { type: "activity", ...item }, MAX_RUN_TIMELINE_ITEMS);
          callbacks.onEvent({ type: "activity", threadId: request.threadId, ...item });
          if (item.classifierDecision) {
            callbacks.onEvent({
              type: "classifier-decision",
              threadId: request.threadId,
              toolUseId: item.toolUseId!,
              toolName: item.toolName,
              decision: item.classifierDecision.decision,
              classifier: item.classifierDecision.classifier,
              reason: item.classifierDecision.reason,
              timestamp: item.timestamp,
            });
          }
        }
        if (update.agentStarted && isAgentTask(turn, update.agentStarted.taskType, update.agentStarted.toolUseId)) {
          const started = update.agentStarted;
          const existing = turn.agents.get(started.taskId);
          const agent = existing
            ? updateAgent(turn, started.taskId, {
                ...(started.toolUseId ? { toolUseId: started.toolUseId } : {}),
                description: started.description || existing.description,
                ...(started.taskType ? { taskType: started.taskType } : {}),
                status: "running",
              })!
            : startAgent(turn, started, timestamp());
          callbacks.onEvent({ type: "agent-started", threadId: request.threadId, taskId: agent.taskId, toolUseId: agent.toolUseId, description: agent.description, taskType: agent.taskType, agentType: agent.agentType, timestamp: agent.startedAt });
        }
        if (update.agentProgress) {
          const progress = update.agentProgress;
          let agent = turn.agents.get(progress.taskId);
          if (!agent && isAgentTask(turn, undefined, progress.toolUseId)) {
            agent = startAgent(turn, { taskId: progress.taskId, toolUseId: progress.toolUseId, description: progress.description || "Sub-agent task" }, timestamp());
            callbacks.onEvent({ type: "agent-started", threadId: request.threadId, taskId: agent.taskId, toolUseId: agent.toolUseId, description: agent.description, taskType: agent.taskType, agentType: agent.agentType, timestamp: agent.startedAt });
          }
          if (agent) {
            const at = timestamp();
            const next = appendAgentProgress(turn, progress.taskId, progress, at);
            if (next) {
              callbacks.onEvent({ type: "agent-progress", threadId: request.threadId, taskId: next.taskId, toolUseId: next.toolUseId, description: progress.description, lastToolName: next.lastToolName, summary: next.summary, usage: next.usage, timestamp: at });
              callbacks.onEvent({ type: "agent-work", threadId: request.threadId, taskId: next.taskId, work: {
                type: "activity",
                label: progress.description || "Agent progress",
                ...(progress.lastToolName ? { toolName: progress.lastToolName } : {}),
                ...(progress.summary ? { detail: progress.summary } : {}),
                timestamp: at,
              }, timestamp: at });
            }
          }
        }
        if (update.agentFinished) {
          const finishedUpdate = update.agentFinished;
          let agent = turn.agents.get(finishedUpdate.taskId);
          if (!agent && isAgentTask(turn, undefined, finishedUpdate.toolUseId)) {
            agent = startAgent(turn, { taskId: finishedUpdate.taskId, toolUseId: finishedUpdate.toolUseId, description: finishedUpdate.summary || "Sub-agent task" }, timestamp());
            callbacks.onEvent({ type: "agent-started", threadId: request.threadId, taskId: agent.taskId, toolUseId: agent.toolUseId, description: agent.description, taskType: agent.taskType, agentType: agent.agentType, timestamp: agent.startedAt });
          }
          if (agent) {
            const next = updateAgent(turn, finishedUpdate.taskId, {
              ...(finishedUpdate.toolUseId ? { toolUseId: finishedUpdate.toolUseId } : {}),
              status: finishedUpdate.status,
              ...(finishedUpdate.summary ? { summary: finishedUpdate.summary } : {}),
              ...(finishedUpdate.outputFile ? { outputFile: finishedUpdate.outputFile } : {}),
              ...(finishedUpdate.usage ? { usage: finishedUpdate.usage } : {}),
              finishedAt: timestamp(),
            });
            if (next) callbacks.onEvent({ type: "agent-finished", threadId: request.threadId, taskId: next.taskId, toolUseId: next.toolUseId, status: next.status as Exclude<AgentStatus, "running">, summary: next.summary, outputFile: next.outputFile, usage: next.usage, timestamp: next.finishedAt ?? timestamp() });
          }
        }
        if (update.interactive === "question" && update.requestId && update.data !== undefined) {
          callbacks.onEvent({ type: "question", threadId: request.threadId, requestId: update.requestId, toolUseId: update.toolUseId, toolName: update.toolName ?? "AskUserQuestion", data: update.data, timestamp: timestamp() });
        } else if (update.interactive === "permission" && update.requestId && update.data !== undefined) {
          callbacks.onEvent({ type: "permission", threadId: request.threadId, requestId: update.requestId, toolUseId: update.toolUseId, toolName: update.toolName ?? "Tool", data: update.data, timestamp: timestamp() });
        }
        if (update.classifierDecision) {
          const decision: ClassifierDecision = {
            decision: update.classifierDecision.decision,
            ...(update.classifierDecision.classifier ? { classifier: update.classifierDecision.classifier } : {}),
            ...(update.classifierDecision.reason ? { reason: update.classifierDecision.reason } : {}),
          };
          applyClassifierDecision(turn, update.classifierDecision.toolUseId, decision);
          callbacks.onEvent({
            type: "classifier-decision",
            threadId: request.threadId,
            toolUseId: update.classifierDecision.toolUseId,
            toolName: update.classifierDecision.toolName,
            decision: decision.decision,
            classifier: decision.classifier,
            reason: decision.reason,
            timestamp: timestamp(),
          });
        }
        for (const toolResult of update.toolResults ?? []) {
          const toolSnapshot = turn.toolSnapshots.get(toolResult.toolUseId);
          const fileChange = toolSnapshot ? collectFileChange(toolSnapshot) : undefined;
          const item = [...turn.activity].reverse().find((candidate) => candidate.toolUseId === toolResult.toolUseId);
          if (item) {
            item.result = toolResult.result;
            item.isError = toolResult.isError;
            if (fileChange) item.fileChange = fileChange;
            if (toolResult.classifierDecision) item.classifierDecision = toolResult.classifierDecision;
          }
          const timelineItem = [...turn.timeline].reverse().find((candidate): candidate is Extract<RunTimelineItem, { type: "activity" }> => candidate.type === "activity" && candidate.toolUseId === toolResult.toolUseId);
          if (timelineItem) {
            timelineItem.result = toolResult.result;
            timelineItem.isError = toolResult.isError;
            if (fileChange) timelineItem.fileChange = fileChange;
            if (toolResult.classifierDecision) timelineItem.classifierDecision = toolResult.classifierDecision;
          }
          const agent = [...turn.agents.values()].find((candidate) => candidate.toolUseId === toolResult.toolUseId);
          if (agent?.status === "running" && (toolResult.isError || !isAsyncAgentResult(toolResult.result))) {
            const status: Exclude<AgentStatus, "running"> = toolResult.isError ? "error" : "completed";
            const finished = updateAgent(turn, agent.taskId, {
              status,
              ...(toolResult.isError && toolResult.result ? { error: toolResult.result.slice(0, 2_000) } : {}),
              finishedAt: timestamp(),
            });
            if (finished) callbacks.onEvent({ type: "agent-finished", threadId: request.threadId, taskId: finished.taskId, toolUseId: finished.toolUseId, status, error: finished.error, timestamp: finished.finishedAt ?? timestamp() });
          }
          callbacks.onEvent({
            type: "activity-result",
            threadId: request.threadId,
            toolUseId: toolResult.toolUseId,
            result: toolResult.result,
            isError: toolResult.isError,
            ...(fileChange ? { fileChange } : {}),
            ...(toolResult.classifierDecision ? { classifierDecision: toolResult.classifierDecision } : {}),
            timestamp: timestamp(),
          });
        }
        if (update.toolResults?.length) flushQueued(true);
        if (update.result !== undefined) {
          turn.finalResult = update.result;
          if (update.isError) turn.resultWasError = true;
          const status: ThreadStatus = stopped ? "cancelled" : turn.resultWasError ? "error" : "complete";
          child.__pendingPrompt = false;
          void finishTurn(status, null, false, queuedFollowUps.length > 0).then(() => flushQueued(false));
        }
        if (update.isError) turn.resultWasError = true;
      } catch {
        callbacks.onEvent({ type: "log", threadId: request.threadId, level: "info", text: clean.slice(0, 2_000), timestamp: timestamp() });
      }
    };

    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += String(chunk);
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const clean = line.trim();
        if (clean) callbacks.onEvent({ type: "log", threadId: request.threadId, level: /error|failed/i.test(clean) ? "error" : "warning", text: clean.slice(0, 2_000), timestamp: timestamp() });
      }
    });

    child.on("error", (error) => {
      turn.resultWasError = true;
      turn.finalResult = error.message;
      callbacks.onEvent({ type: "log", threadId: request.threadId, level: "error", text: error.message, timestamp: timestamp() });
    });

    child.on("close", (code) => {
      child.__pendingPrompt = false;
      const pending = buffer.trim();
      if (pending) handleLine(pending);
      if (stderrBuffer.trim()) callbacks.onEvent({ type: "log", threadId: request.threadId, level: "warning", text: stderrBuffer.trim().slice(0, 2_000), timestamp: timestamp() });
      const status: ThreadStatus = stopped ? "cancelled" : code === 0 && !turn.resultWasError ? "complete" : "error";
      void finishTurn(status, code, true).finally(() => {
        callbacks.onEvent({ type: "finished", threadId: request.threadId, status, exitCode: code, timestamp: timestamp() });
        this.processes.delete(request.threadId);
      });
    });

    Object.defineProperty(child, "__markStopped", { value: () => { stopped = true; } });
    return child.pid ?? -1;
  }

  stop(threadId: string): boolean {
    const child = this.processes.get(threadId);
    if (!child) return false;
    child.__markStopped?.();
    child.kill("SIGTERM");
    setTimeout(() => {
      if (this.processes.get(threadId) === child && child.exitCode === null) child.kill("SIGKILL");
    }, 3_000).unref();
    return true;
  }

  stopAll(): void {
    for (const threadId of this.processes.keys()) this.stop(threadId);
  }
}
