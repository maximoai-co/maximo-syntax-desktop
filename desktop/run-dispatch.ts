import type { PermissionMode, RunRequest, RunResult } from "./types.js";

export const RUN_ALREADY_RUNNING_ERROR = "This chat is already running.";
export const RUN_NOT_RUNNING_ERROR = "This chat is not running.";

export interface RunLaunchConfiguration {
  model: string;
  effort: string;
  permission: PermissionMode;
}

/** The runner is authoritative; renderer state can lag behind turn completion. */
export function resolveAsFollowUp(_requestedAsFollowUp: boolean | undefined, turnActive: boolean): boolean {
  return turnActive;
}

export function launchConfigurationChanged(current: RunLaunchConfiguration, next: RunLaunchConfiguration): boolean {
  return current.model !== next.model
    || current.effort !== next.effort
    || current.permission !== next.permission;
}

interface RunDispatchHandlers {
  start(request: RunRequest): Promise<RunResult>;
  send(request: RunRequest): Promise<RunResult>;
}

/**
 * Dispatch a new user message using the renderer's best session snapshot, then
 * recover once from a stale snapshot using the main process's authoritative
 * runner state. The rejected first attempt cannot mutate the chat, so this
 * never duplicates a user message or model turn.
 */
export async function dispatchRunRequest(
  request: RunRequest,
  sessionAlive: boolean,
  handlers: RunDispatchHandlers,
): Promise<RunResult> {
  const result = await (sessionAlive ? handlers.send(request) : handlers.start(request));
  if (result.accepted) return result;
  if (!sessionAlive && result.error === RUN_ALREADY_RUNNING_ERROR) return handlers.send(request);
  if (sessionAlive && result.error === RUN_NOT_RUNNING_ERROR) return handlers.start(request);
  return result;
}
