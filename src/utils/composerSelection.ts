export interface ComposerRunSelection<TPermission extends string> {
  model: string;
  effort: string;
  permission: TPermission;
}

type PersistedRunSelection<TPermission extends string> = {
  model?: string;
  effort?: string;
  permission?: TPermission;
};

/**
 * Resolve a new run from the currently visible composer choices first.
 * Empty model/effort strings are intentional "provider default" selections,
 * so a present draft must not fall through with truthiness checks.
 */
export function resolveComposerRunSelection<TPermission extends string>(
  draft: ComposerRunSelection<TPermission> | undefined,
  thread: PersistedRunSelection<TPermission>,
  defaults: ComposerRunSelection<TPermission>,
): ComposerRunSelection<TPermission> {
  if (draft) {
    return {
      model: draft.model,
      effort: draft.effort,
      permission: draft.permission,
    };
  }
  return {
    model: thread.model ?? defaults.model,
    effort: thread.effort ?? defaults.effort,
    permission: thread.permission ?? defaults.permission,
  };
}
