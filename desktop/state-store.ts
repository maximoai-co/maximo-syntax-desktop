import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { DEFAULT_SETTINGS, DEFAULT_THEME_PACKS, MAX_PROJECT_SOURCE_COUNT } from "./types.js";
import { normalizeThemePack } from "./theme.js";
import type { AppState, AskUserAnswer, Attachment, ChatMessage, ContextUsage, FileChange, PermissionMode, ProfileUsage, Project, RunActivity, RunTimelineItem, Settings, Space, SpaceIconName, ThemeVariant, Thread, ThreadStatus } from "./types.js";

const validSpaceIcons = new Set<SpaceIconName>([
  "briefcase", "home", "code", "rocket", "lightbulb", "palette", "file", "flask", "heart", "star",
  "globe", "cloud", "hammer", "gamepad", "camera", "target", "tree", "chart", "toolbox",
]);

const emptyProfileUsage: ProfileUsage = {
  totalTokens: 0,
  dailyTokens: {},
  modelTokens: {},
  threadTokenTotals: {},
};

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizedString(value: unknown, fallback = "", maximum = 2_000): string {
  return typeof value === "string" ? value.slice(0, maximum) : fallback;
}

export function normalizeSettings(input: unknown): Settings {
  const source = input && typeof input === "object" ? input as Partial<Settings> : {};
  const theme = source.theme === "light" || source.theme === "dark" ? source.theme : "system";
  const storedThemePacks = source.themePacks && typeof source.themePacks === "object"
    ? source.themePacks as Partial<Record<ThemeVariant, unknown>>
    : {};
  const themePacks = {
    light: normalizeThemePack(storedThemePacks.light, DEFAULT_THEME_PACKS.light),
    dark: normalizeThemePack(storedThemePacks.dark, DEFAULT_THEME_PACKS.dark),
  };
  const permission = source.defaultPermission;
  const defaultPermission: PermissionMode = permission === "default" || permission === "plan" || permission === "acceptEdits" || permission === "full"
    ? permission
    : "auto";
  const customModelSlugs = Array.isArray(source.customModelSlugs)
    ? [...new Set(source.customModelSlugs.filter((value): value is string => typeof value === "string").map((value) => value.trim().slice(0, 200)).filter(Boolean))].slice(0, 64)
    : [...DEFAULT_SETTINGS.customModelSlugs];
  return {
    ...DEFAULT_SETTINGS,
    theme,
    themePacks,
    cliPath: normalizedString(source.cliPath),
    defaultModel: normalizedString(source.defaultModel, "", 200),
    defaultEffort: normalizedString(source.defaultEffort, "", 40),
    defaultPermission,
    hideFullAccessWarning: typeof source.hideFullAccessWarning === "boolean" ? source.hideFullAccessWarning : DEFAULT_SETTINGS.hideFullAccessWarning,
    showInspector: typeof source.showInspector === "boolean" ? source.showInspector : DEFAULT_SETTINGS.showInspector,
    sendWithEnter: typeof source.sendWithEnter === "boolean" ? source.sendWithEnter : DEFAULT_SETTINGS.sendWithEnter,
    uiDensity: source.uiDensity === "compact" || source.uiDensity === "spacious" ? source.uiDensity : "comfortable",
    useSystemUiFont: typeof source.useSystemUiFont === "boolean" ? source.useSystemUiFont : DEFAULT_SETTINGS.useSystemUiFont,
    chatFontSizePx: finiteInteger(source.chatFontSizePx, DEFAULT_SETTINGS.chatFontSizePx, 11, 18),
    terminalFontSizePx: finiteInteger(source.terminalFontSizePx, DEFAULT_SETTINGS.terminalFontSizePx, 10, 22),
    terminalFontFamily: normalizedString(source.terminalFontFamily, "", 256).replace(/[;{}<>\n\r]/g, ""),
    timestampFormat: source.timestampFormat === "12-hour" || source.timestampFormat === "24-hour" ? source.timestampFormat : "locale",
    followUpBehavior: source.followUpBehavior === "queue" ? "queue" : "steer",
    enableAssistantStreaming: typeof source.enableAssistantStreaming === "boolean" ? source.enableAssistantStreaming : DEFAULT_SETTINGS.enableAssistantStreaming,
    diffWordWrap: typeof source.diffWordWrap === "boolean" ? source.diffWordWrap : DEFAULT_SETTINGS.diffWordWrap,
    confirmThreadDelete: typeof source.confirmThreadDelete === "boolean" ? source.confirmThreadDelete : DEFAULT_SETTINGS.confirmThreadDelete,
    confirmThreadArchive: typeof source.confirmThreadArchive === "boolean" ? source.confirmThreadArchive : DEFAULT_SETTINGS.confirmThreadArchive,
    confirmTerminalTabClose: typeof source.confirmTerminalTabClose === "boolean" ? source.confirmTerminalTabClose : DEFAULT_SETTINGS.confirmTerminalTabClose,
    enableTaskCompletionToasts: typeof source.enableTaskCompletionToasts === "boolean" ? source.enableTaskCompletionToasts : DEFAULT_SETTINGS.enableTaskCompletionToasts,
    enableSystemTaskCompletionNotifications: typeof source.enableSystemTaskCompletionNotifications === "boolean" ? source.enableSystemTaskCompletionNotifications : DEFAULT_SETTINGS.enableSystemTaskCompletionNotifications,
    enableNotificationSound: typeof source.enableNotificationSound === "boolean" ? source.enableNotificationSound : DEFAULT_SETTINGS.enableNotificationSound,
    environmentPanelDefaultOpen: typeof source.environmentPanelDefaultOpen === "boolean" ? source.environmentPanelDefaultOpen : DEFAULT_SETTINGS.environmentPanelDefaultOpen,
    showEnvironmentUsage: typeof source.showEnvironmentUsage === "boolean" ? source.showEnvironmentUsage : DEFAULT_SETTINGS.showEnvironmentUsage,
    showEnvironmentLocalServers: typeof source.showEnvironmentLocalServers === "boolean" ? source.showEnvironmentLocalServers : DEFAULT_SETTINGS.showEnvironmentLocalServers,
    showEnvironmentRepository: typeof source.showEnvironmentRepository === "boolean" ? source.showEnvironmentRepository : DEFAULT_SETTINGS.showEnvironmentRepository,
    showEnvironmentEditor: typeof source.showEnvironmentEditor === "boolean" ? source.showEnvironmentEditor : DEFAULT_SETTINGS.showEnvironmentEditor,
    showEnvironmentPinned: typeof source.showEnvironmentPinned === "boolean" ? source.showEnvironmentPinned : DEFAULT_SETTINGS.showEnvironmentPinned,
    showEnvironmentMarkers: typeof source.showEnvironmentMarkers === "boolean" ? source.showEnvironmentMarkers : DEFAULT_SETTINGS.showEnvironmentMarkers,
    showEnvironmentNotepad: typeof source.showEnvironmentNotepad === "boolean" ? source.showEnvironmentNotepad : DEFAULT_SETTINGS.showEnvironmentNotepad,
    showEnvironmentActivity: typeof source.showEnvironmentActivity === "boolean" ? source.showEnvironmentActivity : DEFAULT_SETTINGS.showEnvironmentActivity,
    sidebarProjectSortOrder: source.sidebarProjectSortOrder === "updated_at" || source.sidebarProjectSortOrder === "created_at" ? source.sidebarProjectSortOrder : "manual",
    sidebarThreadSortOrder: source.sidebarThreadSortOrder === "created_at" ? "created_at" : "updated_at",
    customModelSlugs,
  };
}

function normalizeSpaces(value: unknown): Space[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const source = item as Partial<Space>;
    if (typeof source.id !== "string" || !source.id.trim() || typeof source.name !== "string" || !source.name.trim()) return [];
    const icon = typeof source.icon === "string" && validSpaceIcons.has(source.icon as SpaceIconName) ? source.icon as SpaceIconName : "briefcase";
    const createdAt = typeof source.createdAt === "number" && Number.isFinite(source.createdAt) ? source.createdAt : Date.now();
    const updatedAt = typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : createdAt;
    return [{ id: source.id, name: source.name.trim().slice(0, 32), icon, createdAt, updatedAt } satisfies Space];
  });
}

function normalizeProfileUsage(value: unknown): ProfileUsage {
  const source = value && typeof value === "object" ? value as Partial<ProfileUsage> : {};
  const normalizeNumberMap = (candidate: unknown): Record<string, number> => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
    return Object.fromEntries(Object.entries(candidate).flatMap(([key, raw]) => {
      if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return [];
      return [[key.slice(0, 256), raw]];
    }));
  };
  return {
    totalTokens: typeof source.totalTokens === "number" && Number.isFinite(source.totalTokens) && source.totalTokens >= 0 ? source.totalTokens : 0,
    dailyTokens: normalizeNumberMap(source.dailyTokens),
    modelTokens: normalizeNumberMap(source.modelTokens),
    threadTokenTotals: normalizeNumberMap(source.threadTokenTotals),
  };
}

export function createInitialState(suggestedProjectPath?: string): AppState {
  const now = Date.now();
  const project = suggestedProjectPath
    ? {
        id: randomUUID(),
        name: basename(suggestedProjectPath),
        path: resolve(suggestedProjectPath),
        createdAt: now,
        lastOpenedAt: now,
      }
    : undefined;
  return {
    version: 1,
    settings: {
      ...DEFAULT_SETTINGS,
      customModelSlugs: [...DEFAULT_SETTINGS.customModelSlugs],
      themePacks: {
        light: { ...DEFAULT_SETTINGS.themePacks.light, fonts: { ...DEFAULT_SETTINGS.themePacks.light.fonts } },
        dark: { ...DEFAULT_SETTINGS.themePacks.dark, fonts: { ...DEFAULT_SETTINGS.themePacks.dark.fonts } },
      },
    },
    profile: structuredClone(emptyProfileUsage),
    spaces: [],
    projects: project ? [project] : [],
    threads: [],
    selectedProjectId: project?.id,
    onboardingComplete: false,
    selectedSpaceId: null,
    lastSeenWhatsNewVersion: null,
  };
}

function normalizeState(input: unknown, fallback: AppState): AppState {
  if (!input || typeof input !== "object") return fallback;
  const value = input as Partial<AppState>;
  const spaces = normalizeSpaces(value.spaces);
  const spaceIds = new Set(spaces.map((space) => space.id));
  const projects = Array.isArray(value.projects)
    ? value.projects.map((project) => {
      const sourcePaths = Array.isArray(project.sourcePaths)
        ? [...new Set(project.sourcePaths.filter((path): path is string => typeof path === "string").map((path) => resolve(path)).filter(Boolean))].slice(0, MAX_PROJECT_SOURCE_COUNT)
        : [];
      return {
        ...project,
        ...(sourcePaths.length > 0 ? { path: sourcePaths[0], sourcePaths } : {}),
        spaceId: typeof project.spaceId === "string" && spaceIds.has(project.spaceId) ? project.spaceId : null,
      };
    })
    : fallback.projects;
  const selectedSpaceId = typeof value.selectedSpaceId === "string" && spaceIds.has(value.selectedSpaceId) ? value.selectedSpaceId : null;
  const lastSeenWhatsNewVersion = typeof value.lastSeenWhatsNewVersion === "string" && value.lastSeenWhatsNewVersion.trim()
    ? value.lastSeenWhatsNewVersion.trim().slice(0, 40)
    : value.lastSeenWhatsNewVersion === null
      ? null
      : fallback.lastSeenWhatsNewVersion ?? null;
  return {
    ...fallback,
    ...value,
    version: 1,
    settings: normalizeSettings(value.settings),
    profile: normalizeProfileUsage(value.profile),
    spaces,
    projects,
    threads: Array.isArray(value.threads) ? value.threads.map((thread) => {
      const normalizedThread = {
        ...thread,
        ...(thread.title === "New task" ? { title: "New chat" } : {}),
        ...(thread.status === "running" ? { status: "cancelled" as const } : {}),
      };
      // detailLevel exists only on the lightweight renderer projection. Never
      // let it become part of the authoritative on-disk thread model.
      delete normalizedThread.detailLevel;
      return normalizedThread;
    }) : [],
    selectedSpaceId,
    lastSeenWhatsNewVersion,
  };
}

function normalizedChangePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Completed turns used to persist the same tool activity twice (`activity`
 * and `timeline`) and the same large patch once per edit plus once per turn.
 * The renderer has preferred `timeline` for years and can resolve an edit row
 * against the aggregate turn-level `fileChanges`, so those copies contain no
 * additional user-visible information.
 */
function compactMessageHistory(message: ChatMessage): boolean {
  let changed = false;
  if (message.timeline?.length && message.activity !== undefined) {
    delete message.activity;
    changed = true;
  }

  if (!message.timeline?.length || !message.fileChanges?.length) return changed;
  const aggregatePaths = new Set(message.fileChanges.map((change) => normalizedChangePath(change.path)));
  let timelineChanged = false;
  const timeline = message.timeline.map((item) => {
    if (item.type !== "activity" || !item.fileChange || !aggregatePaths.has(normalizedChangePath(item.fileChange.path))) return item;
    const { fileChange: _duplicatePatch, ...withoutDuplicatePatch } = item;
    timelineChanged = true;
    return withoutDuplicatePatch;
  });
  if (timelineChanged) {
    message.timeline = timeline;
    changed = true;
  }
  return changed;
}

function compactStateHistory(state: AppState): boolean {
  let changed = false;
  for (const thread of state.threads) {
    for (const message of thread.messages) changed = compactMessageHistory(message) || changed;
  }
  return changed;
}

function summaryMessage(message: ChatMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.model !== undefined ? { model: message.model } : {}),
    ...(message.attachments?.length ? { attachments: structuredClone(message.attachments) } : {}),
    ...(message.isError !== undefined ? { isError: message.isError } : {}),
    ...(message.interaction ? { interaction: structuredClone(message.interaction) } : {}),
    ...(message.kind ? { kind: message.kind } : {}),
    ...(message.uuid ? { uuid: message.uuid } : {}),
  };
}

interface StoredSelection {
  version: 1;
  selectedProjectId: string | null;
  selectedThreadId: string | null;
  selectedSpaceId: string | null;
  projectLastOpenedAt: Record<string, number>;
  readThreadIds: string[];
}

function applyContextUsage(draft: AppState, threadId: string, contextUsage: ContextUsage): void {
  const thread = draft.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return;
  thread.contextUsage = contextUsage;

  const currentTokens = contextUsage.totalProcessedTokens
    ?? (contextUsage.apiUsage
      ? contextUsage.apiUsage.input_tokens + contextUsage.apiUsage.output_tokens + contextUsage.apiUsage.cache_creation_input_tokens + contextUsage.apiUsage.cache_read_input_tokens
      : contextUsage.totalTokens);
  const previousTokens = draft.profile.threadTokenTotals[threadId] ?? 0;
  const delta = currentTokens >= previousTokens ? currentTokens - previousTokens : currentTokens;
  draft.profile.threadTokenTotals[threadId] = Math.max(0, currentTokens);
  if (delta <= 0) return;
  const day = new Date().toISOString().slice(0, 10);
  const model = contextUsage.model.trim() || thread.model?.trim() || "CLI default";
  draft.profile.totalTokens += delta;
  draft.profile.dailyTokens[day] = (draft.profile.dailyTokens[day] ?? 0) + delta;
  draft.profile.modelTokens[model] = (draft.profile.modelTokens[model] ?? 0) + delta;
}

export class StateStore {
  private readonly statePath: string;
  private readonly selectionPath: string;
  private state: AppState;
  private updateQueue: Promise<void> = Promise.resolve();
  private writeQueue: Promise<void> = Promise.resolve();
  private selectionWriteQueue: Promise<void> = Promise.resolve();
  private pendingContextUsage = new Map<string, ContextUsage>();

  constructor(dataDirectory: string, initialState: AppState) {
    this.statePath = join(dataDirectory, "state.json");
    this.selectionPath = join(dataDirectory, "selection.json");
    this.state = initialState;
  }

  async initialize(): Promise<AppState> {
    await mkdir(dirname(this.statePath), { recursive: true });
    let shouldPersistState = false;
    let historyChecked = false;
    try {
      const raw = await readFile(this.statePath, "utf8");
      this.state = normalizeState(JSON.parse(raw), this.state);
      shouldPersistState = compactStateHistory(this.state);
      historyChecked = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        const backup = `${this.statePath}.corrupt-${Date.now()}`;
        await rename(this.statePath, backup).catch(() => undefined);
      }
      shouldPersistState = true;
    }
    if (!historyChecked) shouldPersistState = compactStateHistory(this.state) || shouldPersistState;
    try {
      this.applyStoredSelection(JSON.parse(await readFile(this.selectionPath, "utf8")));
    } catch {
      // selection.json is a tiny best-effort navigation checkpoint. A missing
      // or malformed file must never make the authoritative state unreadable.
    }
    if (shouldPersistState) await this.persist();
    return this.snapshotForRenderer();
  }

  snapshot(): AppState {
    return structuredClone(this.state);
  }

  /**
   * Keep the workspace shell cheap: only the selected chat crosses Electron's
   * structured-clone boundary with timelines and patches. Other chats retain
   * searchable text and all sidebar/profile metadata.
   */
  snapshotForRenderer(selectedThreadId = this.state.selectedThreadId): AppState {
    const { threads: _threads, ...shell } = this.state;
    return {
      ...structuredClone(shell),
      threads: this.state.threads.map((thread) => {
        if (thread.id === selectedThreadId) {
          return { ...structuredClone(thread), detailLevel: "full" as const };
        }
        const { messages: _messages, detailLevel: _detailLevel, ...metadata } = thread;
        return {
          ...structuredClone(metadata),
          detailLevel: "summary" as const,
          messages: thread.messages.map(summaryMessage),
        };
      }),
    };
  }

  private async commit(mutator: (draft: AppState) => void): Promise<void> {
    const operation = this.updateQueue.then(async () => {
      const draft = this.snapshot();
      mutator(draft);
      this.state = draft;
      await this.persist();
    });
    this.updateQueue = operation.catch(() => undefined);
    await operation;
  }

  async update(mutator: (draft: AppState) => void): Promise<AppState> {
    await this.commit(mutator);
    return this.snapshotForRenderer();
  }

  async updateSettings(patch: Partial<Settings>): Promise<AppState> {
    return this.update((draft) => {
      const themePacks = patch.themePacks
        ? { ...draft.settings.themePacks, ...patch.themePacks }
        : draft.settings.themePacks;
      draft.settings = normalizeSettings({ ...draft.settings, ...patch, themePacks });
    });
  }

  async recordContextUsage(threadId: string, contextUsage: ContextUsage): Promise<void> {
    // Context deltas can arrive many times per second. Keep only the latest
    // reading in memory; finishRun persists it in the same atomic write as the
    // completed turn, eliminating periodic 55 MB archive clones while AI runs.
    this.pendingContextUsage.set(threadId, contextUsage);
  }

  /** Force a final usage persistence (e.g. when a run completes). */
  async flushContextUsage(threadId: string, contextUsage: ContextUsage): Promise<void> {
    const pendingAtStart = this.pendingContextUsage.get(threadId);
    await this.commit((draft) => applyContextUsage(draft, threadId, contextUsage));
    if (this.pendingContextUsage.get(threadId) === pendingAtStart) this.pendingContextUsage.delete(threadId);
  }

  async resetProviderSelections(): Promise<AppState> {
    return this.update((draft) => {
      draft.settings.defaultModel = "";
      draft.settings.defaultEffort = "";
      for (const thread of draft.threads) {
        delete thread.model;
        delete thread.effort;
        delete thread.cliSessionId;
        delete thread.contextUsage;
      }
    });
  }

  async createSpace(name: string, icon: SpaceIconName): Promise<AppState> {
    const normalizedName = name.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!normalizedName) throw new Error("Enter a space name.");
    if (!validSpaceIcons.has(icon)) throw new Error("Choose a valid space icon.");
    if (normalizedName.toLowerCase() === "void" || this.state.spaces.some((space) => space.name.toLowerCase() === normalizedName.toLowerCase())) {
      throw new Error("That space name is already taken.");
    }
    const now = Date.now();
    const space: Space = { id: randomUUID(), name: normalizedName, icon, createdAt: now, updatedAt: now };
    return this.update((draft) => {
      draft.spaces.push(space);
      draft.selectedSpaceId = space.id;
    });
  }

  async selectSpace(spaceId: string | null): Promise<AppState> {
    if (spaceId !== null && !this.state.spaces.some((space) => space.id === spaceId)) throw new Error("Space not found.");
    this.state.selectedSpaceId = spaceId;
    const project = this.state.projects.find((candidate) => (candidate.spaceId ?? null) === spaceId);
    this.state.selectedProjectId = project?.id;
    this.state.selectedThreadId = project
      ? this.state.threads.find((thread) => thread.projectId === project.id)?.id
      : undefined;
    const result = this.snapshotForRenderer();
    await this.persistSelection().catch(() => undefined);
    return result;
  }

  async addProject(projectPath: string): Promise<AppState> {
    const absolutePath = resolve(projectPath);
    const info = await stat(absolutePath);
    if (!info.isDirectory()) throw new Error("The selected project must be a folder.");
    const existing = this.state.projects.find((project) => project.path === absolutePath);
    if (existing) {
      return this.update((draft) => {
        const project = draft.projects.find((candidate) => candidate.id === existing.id);
        if (project) project.lastOpenedAt = Date.now();
        draft.selectedProjectId = existing.id;
        draft.selectedThreadId = undefined;
        draft.selectedSpaceId = existing.spaceId ?? null;
      });
    }
    return this.createProject(basename(absolutePath), [absolutePath]);
  }

  async createProject(name: string, sourcePaths: string[], spaceId: string | null = null): Promise<AppState> {
    const paths = [...new Set(sourcePaths.map((path) => resolve(path)).filter(Boolean))].slice(0, MAX_PROJECT_SOURCE_COUNT);
    if (paths.length === 0) throw new Error("Choose at least one source folder.");
    if (spaceId !== null && !this.state.spaces.some((space) => space.id === spaceId)) throw new Error("Space not found.");
    for (const path of paths) {
      const info = await stat(path);
      if (!info.isDirectory()) throw new Error("Every project source must be a folder.");
    }
    const projectName = name.trim().slice(0, 100) || basename(paths[0]);
    const primaryPath = paths[0];
    return this.update((draft) => {
      const existing = draft.projects.find((project) => project.path === primaryPath);
      if (existing) {
        existing.name = projectName;
        existing.sourcePaths = paths;
        existing.lastOpenedAt = Date.now();
        draft.selectedProjectId = existing.id;
        draft.selectedThreadId = undefined;
        draft.selectedSpaceId = existing.spaceId ?? null;
        return;
      }
      const now = Date.now();
      const project: Project = {
        id: randomUUID(),
        name: projectName,
        path: primaryPath,
        sourcePaths: paths,
        spaceId,
        createdAt: now,
        lastOpenedAt: now,
      };
      draft.projects.unshift(project);
      draft.selectedProjectId = project.id;
      draft.selectedThreadId = undefined;
      draft.selectedSpaceId = spaceId;
    });
  }

  async selectProject(projectId: string): Promise<AppState> {
    const project = this.state.projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new Error("Project not found.");
    project.lastOpenedAt = Date.now();
    this.state.selectedProjectId = projectId;
    this.state.selectedSpaceId = project.spaceId ?? null;
    const selectedThread = this.state.threads.find((thread) => thread.id === this.state.selectedThreadId);
    if (selectedThread && selectedThread.projectId !== projectId) this.state.selectedThreadId = undefined;
    const result = this.snapshotForRenderer();
    await this.persistSelection().catch(() => undefined);
    return result;
  }

  async renameProject(projectId: string, name: string): Promise<AppState> {
    return this.update((draft) => {
      const project = draft.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("Project not found.");
      project.name = name.trim().slice(0, 100) || basename(project.path);
      project.lastOpenedAt = Date.now();
    });
  }

  async toggleProjectPinned(projectId: string): Promise<AppState> {
    return this.update((draft) => {
      const project = draft.projects.find((candidate) => candidate.id === projectId);
      if (!project) throw new Error("Project not found.");
      project.pinned = !project.pinned;
    });
  }

  async reorderProjects(sourceProjectId: string, targetProjectId: string): Promise<AppState> {
    return this.update((draft) => {
      if (sourceProjectId === targetProjectId) return;
      const sourceIndex = draft.projects.findIndex((project) => project.id === sourceProjectId);
      const targetIndex = draft.projects.findIndex((project) => project.id === targetProjectId);
      if (sourceIndex < 0 || targetIndex < 0) throw new Error("Project not found.");
      const [source] = draft.projects.splice(sourceIndex, 1);
      if (!source) return;
      draft.projects.splice(targetIndex, 0, source);
    });
  }

  async archiveProjectThreads(projectId: string): Promise<AppState> {
    return this.update((draft) => {
      for (const thread of draft.threads) {
        if (thread.projectId === projectId && thread.messages.length > 0) thread.archived = true;
      }
      if (draft.selectedThreadId && draft.threads.find((thread) => thread.id === draft.selectedThreadId)?.projectId === projectId) {
        draft.selectedThreadId = undefined;
      }
    });
  }

  async archiveThread(threadId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.archived = true;
      thread.updatedAt = Date.now();
      if (draft.selectedThreadId === threadId) {
        draft.selectedThreadId = draft.threads.find((candidate) => candidate.projectId === thread.projectId && candidate.id !== threadId && !candidate.archived && candidate.messages.length > 0)?.id;
      }
    });
  }

  async unarchiveThread(threadId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.archived = false;
      thread.updatedAt = Date.now();
    });
  }

  async removeProject(projectId: string): Promise<AppState> {
    return this.update((draft) => {
      draft.projects = draft.projects.filter((project) => project.id !== projectId);
      draft.threads = draft.threads.filter((thread) => thread.projectId !== projectId);
      if (draft.selectedProjectId === projectId) {
        draft.selectedProjectId = draft.projects[0]?.id;
        draft.selectedThreadId = undefined;
      }
    });
  }

  async createThread(projectId: string): Promise<AppState> {
    if (!this.state.projects.some((project) => project.id === projectId)) throw new Error("Project not found.");
    const existingDraft = this.state.threads.find((candidate) => candidate.projectId === projectId && candidate.messages.length === 0 && candidate.status === "idle");
    if (existingDraft) {
      // Reuse empty draft without scanning all threads' messages; instant switch.
      this.state.selectedProjectId = projectId;
      this.state.selectedThreadId = existingDraft.id;
      this.state.selectedSpaceId = this.state.projects.find((project) => project.id === projectId)?.spaceId ?? null;
      const result = this.snapshotForRenderer();
      await this.persistSelection().catch(() => undefined);
      return result;
    }
    const thread: Thread = {
      id: randomUUID(),
      projectId,
      title: "New chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "idle",
      messages: [],
    };
    return this.update((draft) => {
      draft.threads = draft.threads.filter((candidate) => candidate.messages.length > 0);
      draft.threads.unshift(thread);
      draft.selectedProjectId = projectId;
      draft.selectedThreadId = thread.id;
      draft.selectedSpaceId = this.state.projects.find((project) => project.id === projectId)?.spaceId ?? null;
    });
  }

  async selectThread(threadId: string): Promise<AppState> {
    // Update selection synchronously, persist only the tiny checkpoint, and
    // keep the legacy full response for callers that have not adopted the
    // activateThread + threadDetail split yet.
    this.activateThreadInMemory(threadId);
    // The navigation checkpoint is a few hundred bytes on its own serialized
    // queue. Never stringify the whole chat archive just because the user
    // clicked a row, and never wait behind a large history write.
    const result = this.snapshotForRenderer();
    await this.persistSelection().catch(() => undefined);
    return result;
  }

  /** Select a chat without serializing any transcript back across IPC. */
  async activateThread(threadId: string): Promise<void> {
    this.activateThreadInMemory(threadId);
    await this.persistSelection().catch(() => undefined);
  }

  /** Load one compacted transcript on demand for the renderer detail cache. */
  threadDetail(threadId: string): Thread {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId);
    if (!thread) throw new Error("Chat not found.");
    return { ...structuredClone(thread), detailLevel: "full" };
  }

  private activateThreadInMemory(threadId: string): void {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId);
    if (!thread) throw new Error("Chat not found.");
    thread.unread = false;
    this.state.selectedThreadId = thread.id;
    this.state.selectedProjectId = thread.projectId;
    this.state.selectedSpaceId = this.state.projects.find((project) => project.id === thread.projectId)?.spaceId ?? null;
  }

  async markThreadRead(threadId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (thread) thread.unread = false;
    });
  }

  async markAllNotificationsRead(): Promise<AppState> {
    return this.update((draft) => {
      for (const thread of draft.threads) {
        thread.unread = false;
      }
    });
  }

  /**
   * Edit-and-resend: replaces the content of an existing user message, drops
   * every message after it (the assistant reply and later turns), and gives
   * the edited message a fresh CLI uuid (the CLI dedups by uuid, so the resent
   * turn cannot reuse the original). The desktop id is preserved for
   * display/revert targeting. Refuses to rewrite non-user messages.
   */
  async rewriteUserMessage(threadId: string, messageId: string, content: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const index = thread.messages.findIndex((candidate) => candidate.id === messageId);
      const message = thread.messages[index];
      if (!message || message.role !== "user") throw new Error("Message not found.");
      // Discard the assistant reply (and any later turns) so the UI matches the
      // forked CLI transcript that will be rebuilt from this edited prompt.
      if (index < thread.messages.length - 1) {
        const removed = thread.messages.slice(index + 1);
        thread.messages = thread.messages.slice(0, index + 1);
        const removedIds = new Set(removed.map((item) => item.id));
        if (thread.pinnedMessages) thread.pinnedMessages = thread.pinnedMessages.filter((pin) => !removedIds.has(pin.messageId));
        if (thread.markers) thread.markers = thread.markers.filter((marker) => !removedIds.has(marker.messageId));
      }
      message.content = content;
      message.uuid = randomUUID();
      // Anchor future runs at the message before the edited one so the edited
      // message replaces it in the CLI transcript rather than being appended.
      thread.truncateAtUuid = index > 0 ? (thread.messages[index - 1]?.uuid ?? undefined) : undefined;
      thread.updatedAt = Date.now();
    });
  }

  /**
   * Revert-to-message: discards every message after the target user message
   * (and their pins/markers) and returns the thread to idle. The CLI transcript
   * truncation is handled separately via --resume-session-at anchored at the
   * target's uuid.
   */
  async truncateThreadAt(threadId: string, messageId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const index = thread.messages.findIndex((candidate) => candidate.id === messageId);
      if (index < 0 || thread.messages[index]?.role !== "user") throw new Error("Message not found.");
      const removed = thread.messages.slice(index + 1);
      thread.messages = thread.messages.slice(0, index + 1);
      const removedIds = new Set(removed.map((message) => message.id));
      if (thread.pinnedMessages) thread.pinnedMessages = thread.pinnedMessages.filter((pin) => !removedIds.has(pin.messageId));
      if (thread.markers) thread.markers = thread.markers.filter((marker) => !removedIds.has(marker.messageId));
      thread.status = "idle";
      thread.truncateAtUuid = thread.messages[index]?.uuid ?? undefined;
      thread.updatedAt = Date.now();
    });
  }

  async renameThread(threadId: string, title: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.title = title.trim().slice(0, 100) || "New chat";
      thread.updatedAt = Date.now();
    });
  }

  async toggleThreadPinned(threadId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.pinned = !thread.pinned;
      thread.updatedAt = Date.now();
    });
  }

  async toggleMessagePinned(threadId: string, messageId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      if (!thread.messages.some((message) => message.id === messageId)) throw new Error("Message not found.");
      const pins = thread.pinnedMessages ?? [];
      const existingIndex = pins.findIndex((pin) => pin.messageId === messageId);
      if (existingIndex >= 0) pins.splice(existingIndex, 1);
      else pins.push({ messageId, label: null, done: false, pinnedAt: Date.now() });
      thread.pinnedMessages = pins;
      thread.updatedAt = Date.now();
    });
  }

  async setMessagePinDone(threadId: string, messageId: string, done: boolean): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const pin = thread.pinnedMessages?.find((candidate) => candidate.messageId === messageId);
      if (!pin) throw new Error("Pinned message not found.");
      pin.done = Boolean(done);
      thread.updatedAt = Date.now();
    });
  }

  async setMessagePinLabel(threadId: string, messageId: string, label: string | null): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const pin = thread.pinnedMessages?.find((candidate) => candidate.messageId === messageId);
      if (!pin) throw new Error("Pinned message not found.");
      const normalized = label?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "";
      pin.label = normalized || null;
      thread.updatedAt = Date.now();
    });
  }

  async removeMessagePin(threadId: string, messageId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.pinnedMessages = (thread.pinnedMessages ?? []).filter((pin) => pin.messageId !== messageId);
      thread.updatedAt = Date.now();
    });
  }

  async toggleThreadMarker(threadId: string, messageId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const message = thread.messages.find((candidate) => candidate.id === messageId);
      if (!message) throw new Error("Message not found.");
      const markers = thread.markers ?? [];
      const existingIndex = markers.findIndex((marker) => marker.messageId === messageId);
      if (existingIndex >= 0) {
        markers.splice(existingIndex, 1);
      } else {
        const selectedText = message.content.replace(/\s+/g, " ").trim().slice(0, 1_000);
        markers.push({
          id: randomUUID(),
          messageId,
          startOffset: 0,
          endOffset: selectedText.length,
          selectedText,
          style: "highlight",
          color: "yellow",
          label: null,
          done: false,
          createdAt: Date.now(),
        });
      }
      thread.markers = markers;
      thread.updatedAt = Date.now();
    });
  }

  async setThreadMarkerDone(threadId: string, markerId: string, done: boolean): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const marker = thread.markers?.find((candidate) => candidate.id === markerId);
      if (!marker) throw new Error("Marker not found.");
      marker.done = Boolean(done);
      thread.updatedAt = Date.now();
    });
  }

  async setThreadMarkerLabel(threadId: string, markerId: string, label: string | null): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const marker = thread.markers?.find((candidate) => candidate.id === markerId);
      if (!marker) throw new Error("Marker not found.");
      const normalized = label?.replace(/\s+/g, " ").trim().slice(0, 160) ?? "";
      marker.label = normalized || null;
      thread.updatedAt = Date.now();
    });
  }

  async removeThreadMarker(threadId: string, markerId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.markers = (thread.markers ?? []).filter((marker) => marker.id !== markerId);
      thread.updatedAt = Date.now();
    });
  }

  async updateThreadNotes(threadId: string, notes: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.notes = notes.slice(0, 10_000);
      thread.updatedAt = Date.now();
    });
  }

  async deleteThread(threadId: string): Promise<AppState> {
    return this.update((draft) => {
      draft.threads = draft.threads.filter((thread) => thread.id !== threadId);
      if (draft.selectedThreadId === threadId) {
        draft.selectedThreadId = draft.threads.find((thread) => thread.projectId === draft.selectedProjectId)?.id;
      }
    });
  }

  async beginRun(threadId: string, prompt: string, attachments: Attachment[], model: string, effort: string, permission: PermissionMode): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      this.pushUserMessage(thread, prompt, attachments, model, effort, permission);
      thread.status = "running";
      thread.unread = false;
      draft.selectedThreadId = threadId;
      draft.selectedProjectId = thread.projectId;
    });
  }

  /**
   * Edit-and-resend: marks the thread running after the edited user message was
   * rewritten in place, without pushing a duplicate message. The rewritten
   * message (which keeps its original id) is the active turn.
   */
  async beginEditAndResend(threadId: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.status = "running";
      thread.unread = false;
      draft.selectedThreadId = threadId;
      draft.selectedProjectId = thread.projectId;
    });
  }

  async sendRunMessage(
    threadId: string,
    prompt: string,
    attachments: Attachment[],
    model: string,
    effort: string,
    permission: PermissionMode,
    options?: { asFollowUp?: boolean },
  ): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      this.pushUserMessage(thread, prompt, attachments, model, effort, permission, options?.asFollowUp ? "follow-up" : undefined);
      thread.status = "running";
      thread.unread = false;
      thread.updatedAt = Date.now();
    });
  }

  private pushUserMessage(
    thread: Thread,
    prompt: string,
    attachments: Attachment[],
    model: string,
    effort: string,
    permission: PermissionMode,
    kind?: "follow-up",
  ): void {
    const message: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: prompt,
      attachments,
      createdAt: Date.now(),
      model: model.trim(),
      uuid: randomUUID(),
      ...(kind ? { kind } : {}),
    };
    thread.messages.push(message);
    if (thread.messages.filter((item) => item.role === "user").length === 1) {
      thread.title = prompt.replace(/\s+/g, " ").trim().slice(0, 54) || "New chat";
    }
    const trimmedModel = model.trim();
    const trimmedEffort = effort.trim();
    if (trimmedModel) thread.model = trimmedModel;
    else delete thread.model;
    if (trimmedEffort) thread.effort = trimmedEffort;
    else delete thread.effort;
    thread.permission = permission;
    thread.updatedAt = Date.now();
  }

  async recordQuestionInteraction(threadId: string, questions: AskUserAnswer[], toolUseId?: string): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      const recorded = questions
        .filter((question) => question.question.trim() && question.answer.trim())
        .slice(0, 20)
        .map((question) => ({
          question: question.question.trim().slice(0, 2_000),
          answer: question.answer.trim().slice(0, 2_000),
          ...(question.header?.trim() ? { header: question.header.trim().slice(0, 200) } : {}),
          ...(question.multiSelect ? { multiSelect: true } : {}),
        }));
      if (recorded.length === 0) return;
      thread.messages.push({
        id: randomUUID(),
        role: "system",
        content: "",
        createdAt: Date.now(),
        interaction: { type: "ask-user", questions: recorded, ...(toolUseId?.trim() ? { toolUseId: toolUseId.trim().slice(0, 200) } : {}) },
      });
      thread.updatedAt = Date.now();
    });
  }

  async recordPermissionInteraction(threadId: string, interaction: { toolName: string; decision: "approved" | "denied"; detail?: string; remember?: boolean; toolUseId?: string }): Promise<AppState> {
    return this.update((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error("Chat not found.");
      thread.messages.push({
        id: randomUUID(),
        role: "system",
        content: "",
        createdAt: Date.now(),
        interaction: {
          type: "permission",
          toolName: interaction.toolName.trim().slice(0, 200) || "Tool",
          decision: interaction.decision,
          ...(interaction.detail?.trim() ? { detail: interaction.detail.trim().slice(0, 2_000) } : {}),
          ...(interaction.remember ? { remember: true } : {}),
          ...(interaction.toolUseId?.trim() ? { toolUseId: interaction.toolUseId.trim().slice(0, 200) } : {}),
        },
      });
      thread.updatedAt = Date.now();
    });
  }

  async finishRun(threadId: string, content: string, status: ThreadStatus, sessionId?: string, error = false, activity: RunActivity[] = [], durationMs = 0, timeline: RunTimelineItem[] = [], fileChanges: FileChange[] = [], final = true, continueRunning = false): Promise<void> {
    const pendingUsage = this.pendingContextUsage.get(threadId);
    await this.commit((draft) => {
      const thread = draft.threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      if (pendingUsage) applyContextUsage(draft, threadId, pendingUsage);
      const assistantContent = content.trim() || (fileChanges.length > 0 ? "I updated the files listed below." : "");
      const answerModel = [...thread.messages].reverse().find((message) => message.role === "user" && message.kind !== "follow-up")?.model;
      const continuedContexts: ChatMessage[] = [];
      if (continueRunning) {
        while (thread.messages.at(-1)?.kind === "follow-up") {
          const context = thread.messages.pop();
          if (context) continuedContexts.unshift(context);
        }
      }
      const latest = thread.messages.at(-1);
      const duplicateFinal = final && assistantContent && latest?.role === "assistant" && latest.content === assistantContent;
      if (!duplicateFinal && (assistantContent || timeline.length > 0 || fileChanges.length > 0)) {
        const assistantMessage: ChatMessage = {
          id: randomUUID(),
          role: "assistant",
          content: assistantContent,
          createdAt: Date.now(),
          ...(answerModel !== undefined ? { model: answerModel } : {}),
          isError: error,
          activity,
          timeline,
          durationMs,
          ...(fileChanges.length > 0 ? { fileChanges } : {}),
        };
        compactMessageHistory(assistantMessage);
        thread.messages.push(assistantMessage);
      }
      if (continuedContexts.length > 0) thread.messages.push(...continuedContexts);
      if (final) thread.status = status;
      else thread.status = continueRunning ? "running" : "complete";
      if (draft.selectedThreadId === threadId) {
        thread.unread = false;
      } else {
        thread.unread = true;
      }
      thread.updatedAt = Date.now();
      if (sessionId) thread.cliSessionId = sessionId;
    });
    if (this.pendingContextUsage.get(threadId) === pendingUsage) this.pendingContextUsage.delete(threadId);
  }

  getProject(projectId: string): Project | undefined {
    return this.state.projects.find((project) => project.id === projectId);
  }

  getThread(threadId: string): Thread | undefined {
    return this.state.threads.find((thread) => thread.id === threadId);
  }

  getLastSeenWhatsNewVersion(): string | null {
    return this.state.lastSeenWhatsNewVersion ?? null;
  }

  getSelectedProjectPath(): string | undefined {
    return this.state.projects.find((project) => project.id === this.state.selectedProjectId)?.path;
  }

  getFirstProject(): Project | undefined {
    return this.state.projects[0];
  }

  hasThreads(): boolean {
    return this.state.threads.length > 0;
  }

  getTheme(): Settings["theme"] {
    return this.state.settings.theme;
  }

  getCliPath(): string {
    return this.state.settings.cliPath;
  }

  private selectionSnapshot(): StoredSelection {
    return {
      version: 1,
      selectedProjectId: this.state.selectedProjectId ?? null,
      selectedThreadId: this.state.selectedThreadId ?? null,
      selectedSpaceId: this.state.selectedSpaceId ?? null,
      projectLastOpenedAt: Object.fromEntries(this.state.projects.map((project) => [project.id, project.lastOpenedAt])),
      // Selecting an unread chat is part of navigation, so retain that tiny
      // read-state change without forcing a full transcript archive write.
      readThreadIds: this.state.threads.filter((thread) => !thread.unread).map((thread) => thread.id),
    };
  }

  private applyStoredSelection(input: unknown): void {
    if (!input || typeof input !== "object") return;
    const selection = input as Partial<StoredSelection>;
    if (selection.projectLastOpenedAt && typeof selection.projectLastOpenedAt === "object" && !Array.isArray(selection.projectLastOpenedAt)) {
      for (const project of this.state.projects) {
        const timestamp = selection.projectLastOpenedAt[project.id];
        if (typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > project.lastOpenedAt) project.lastOpenedAt = timestamp;
      }
    }
    if (Array.isArray(selection.readThreadIds)) {
      const readThreadIds = new Set(selection.readThreadIds.filter((id): id is string => typeof id === "string"));
      for (const thread of this.state.threads) {
        if (readThreadIds.has(thread.id)) thread.unread = false;
      }
    }

    const thread = typeof selection.selectedThreadId === "string"
      ? this.state.threads.find((candidate) => candidate.id === selection.selectedThreadId)
      : undefined;
    if (thread) {
      const project = this.state.projects.find((candidate) => candidate.id === thread.projectId);
      this.state.selectedThreadId = thread.id;
      this.state.selectedProjectId = thread.projectId;
      this.state.selectedSpaceId = project?.spaceId ?? null;
      thread.unread = false;
      return;
    }

    const project = typeof selection.selectedProjectId === "string"
      ? this.state.projects.find((candidate) => candidate.id === selection.selectedProjectId)
      : undefined;
    if (project) {
      this.state.selectedProjectId = project.id;
      this.state.selectedThreadId = undefined;
      this.state.selectedSpaceId = project.spaceId ?? null;
      return;
    }

    if (selection.selectedProjectId === null) {
      this.state.selectedProjectId = undefined;
      this.state.selectedThreadId = undefined;
      const requestedSpaceId = selection.selectedSpaceId;
      this.state.selectedSpaceId = typeof requestedSpaceId === "string" && this.state.spaces.some((space) => space.id === requestedSpaceId)
        ? requestedSpaceId
        : null;
    }
  }

  private persist(): Promise<void> {
    const payload = `${JSON.stringify(this.state)}\n`;
    const selectionPayload = `${JSON.stringify(this.selectionSnapshot())}\n`;
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const temporaryPath = `${this.statePath}.tmp`;
      await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.statePath);
    });
    const stateWrite = this.writeQueue;
    const selectionWrite = this.enqueueSelectionWrite(selectionPayload);
    return Promise.all([stateWrite, selectionWrite]).then(() => undefined);
  }

  private persistSelection(): Promise<void> {
    const payload = `${JSON.stringify(this.selectionSnapshot())}\n`;
    return this.enqueueSelectionWrite(payload);
  }

  private enqueueSelectionWrite(payload: string): Promise<void> {
    this.selectionWriteQueue = this.selectionWriteQueue.catch(() => undefined).then(async () => {
      const temporaryPath = `${this.selectionPath}.tmp`;
      await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.selectionPath);
    });
    return this.selectionWriteQueue;
  }
}
