import type { PermissionMode } from "./types.js";

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
