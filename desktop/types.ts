export type ThemeMode = "system" | "light" | "dark";
export type ThemeVariant = "light" | "dark";
export type ThemePresetId =
  | "maximo"
  | "codex"
  | "ocean"
  | "forest"
  | "rose"
  | "synara"
  | "absolutely"
  | "ayu"
  | "catppuccin"
  | "dracula"
  | "everforest"
  | "github"
  | "gruvbox"
  | "linear"
  | "lobster"
  | "material"
  | "matrix"
  | "monokai"
  | "night-owl"
  | "nord"
  | "notion"
  | "one"
  | "oscurange"
  | "proof"
  | "raycast"
  | "rose-pine"
  | "sentry"
  | "solarized"
  | "temple"
  | "tokyo-night"
  | "vercel"
  | "vscode-plus"
  | "custom";
export type UiDensity = "compact" | "comfortable" | "spacious";
export type TimestampFormat = "locale" | "12-hour" | "24-hour";
export type FollowUpBehavior = "queue" | "steer";
export type SidebarProjectSortOrder = "updated_at" | "created_at" | "manual";
export type SidebarThreadSortOrder = "updated_at" | "created_at";
export type PermissionMode = "default" | "plan" | "acceptEdits" | "auto" | "full";
export type ThreadStatus = "idle" | "running" | "complete" | "error" | "cancelled";

export interface ThemePack {
  preset: ThemePresetId;
  accent: string;
  background: string;
  foreground: string;
  fonts: {
    ui: string;
    code: string;
  };
  translucentSidebar: boolean;
  contrast: number;
}

export const DEFAULT_THEME_PACKS: Record<ThemeVariant, ThemePack> = {
  light: {
    preset: "maximo",
    accent: "#00ad92",
    background: "#f8fbfa",
    foreground: "#173334",
    fonts: { ui: "", code: "" },
    translucentSidebar: true,
    contrast: 0,
  },
  dark: {
    preset: "maximo",
    accent: "#43bea4",
    background: "#1c1d1e",
    foreground: "#d6dcdb",
    fonts: { ui: "", code: "" },
    translucentSidebar: true,
    contrast: 0,
  },
};

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_SIZE = 100 * 1024 * 1024;
export const MAX_APPSNAP_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_SOURCE_COUNT = 5;

export type DesktopAppSnapPlatform = "macos" | "windows" | "linux" | "other";
export type DesktopAppSnapPermission =
  | "granted"
  | "denied"
  | "not-determined"
  | "restricted"
  | "unknown";
export type DesktopAppSnapStatus =
  | "unsupported"
  | "disabled"
  | "permission-required"
  | "starting"
  | "ready"
  | "error";

export type DesktopAppSnapShortcutModifier = "command" | "control" | "option" | "shift";

export interface DesktopAppSnapKeyChord {
  kind: "key-chord";
  modifier: DesktopAppSnapShortcutModifier;
  /** A physical DOM KeyboardEvent.code, such as `KeyS` or `Space`. */
  key: string;
}

export type DesktopAppSnapShortcut = { kind: "both-option-keys" } | DesktopAppSnapKeyChord;

export interface DesktopAppSnapShortcutAvailability {
  available: boolean;
  reason: string | null;
}

export interface DesktopAppSnapShortcutUpdateResult {
  state: DesktopAppSnapState;
  availability: DesktopAppSnapShortcutAvailability;
}

export interface DesktopAppSnapState {
  platform: DesktopAppSnapPlatform;
  supported: boolean;
  enabled: boolean;
  status: DesktopAppSnapStatus;
  shortcut: DesktopAppSnapShortcut | null;
  inputMonitoringPermission: DesktopAppSnapPermission;
  screenRecordingPermission: DesktopAppSnapPermission;
  /** Which System Settings pane to open next. Screen first, Input Monitoring after relaunch. */
  permissionPrompt: "screen" | "input" | null;
  message: string | null;
}

export interface DesktopAppSnapCapture {
  id: string;
  capturedAt: string;
  name: string;
  mimeType: "image/png";
  sizeBytes: number;
  bytes: Uint8Array;
  sourceAppName: string | null;
  sourceBundleIdentifier: string | null;
  sourceAppIconDataUrl: string | null;
  sourceWindowTitle: string | null;
}

export interface DesktopAppSnapErrorEvent {
  code: string;
  message: string;
  capturedAt: string;
}

export interface AppSnapSource {
  kind: "appsnap";
  captureId: string;
  capturedAt: string;
  appName: string | null;
  bundleIdentifier: string | null;
  appIconDataUrl: string | null;
  windowTitle: string | null;
}

export type ProjectColorName = "default" | "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink";

export type ProjectIconName =
  | "folder"
  | "circle"
  | "briefcase"
  | "box"
  | "code"
  | "file"
  | "file-text"
  | "terminal"
  | "pen"
  | "braces"
  | "bug"
  | "sparkles"
  | "rocket"
  | "target"
  | "star"
  | "heart"
  | "home"
  | "globe"
  | "cloud"
  | "database"
  | "cpu"
  | "monitor"
  | "calendar"
  | "clock"
  | "check"
  | "list"
  | "bookmark"
  | "tag"
  | "link"
  | "lock"
  | "shield"
  | "wrench"
  | "hammer"
  | "palette"
  | "camera"
  | "music"
  | "gamepad"
  | "coffee";

export type SpaceIconName =
  | "briefcase"
  | "home"
  | "code"
  | "rocket"
  | "lightbulb"
  | "palette"
  | "file"
  | "flask"
  | "heart"
  | "star"
  | "globe"
  | "cloud"
  | "hammer"
  | "gamepad"
  | "camera"
  | "target"
  | "tree"
  | "chart"
  | "toolbox";

export interface Settings {
  theme: ThemeMode;
  themePacks: Record<ThemeVariant, ThemePack>;
  cliPath: string;
  defaultModel: string;
  defaultEffort: string;
  defaultPermission: PermissionMode;
  hideFullAccessWarning: boolean;
  showInspector: boolean;
  sendWithEnter: boolean;
  uiDensity: UiDensity;
  useSystemUiFont: boolean;
  chatFontSizePx: number;
  terminalFontSizePx: number;
  terminalFontFamily: string;
  timestampFormat: TimestampFormat;
  followUpBehavior: FollowUpBehavior;
  enableAssistantStreaming: boolean;
  diffWordWrap: boolean;
  confirmThreadDelete: boolean;
  confirmThreadArchive: boolean;
  confirmTerminalTabClose: boolean;
  enableTaskCompletionToasts: boolean;
  enableSystemTaskCompletionNotifications: boolean;
  enableNotificationSound: boolean;
  environmentPanelDefaultOpen: boolean;
  showEnvironmentUsage: boolean;
  showEnvironmentLocalServers: boolean;
  showEnvironmentRepository: boolean;
  showEnvironmentEditor: boolean;
  showEnvironmentPinned: boolean;
  showEnvironmentMarkers: boolean;
  showEnvironmentNotepad: boolean;
  showEnvironmentActivity: boolean;
  sidebarProjectSortOrder: SidebarProjectSortOrder;
  sidebarThreadSortOrder: SidebarThreadSortOrder;
  customModelSlugs: string[];
  enableAppSnap: boolean;
  appSnapShortcut: DesktopAppSnapShortcut;
  appSnapPlaySound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  themePacks: {
    light: { ...DEFAULT_THEME_PACKS.light, fonts: { ...DEFAULT_THEME_PACKS.light.fonts } },
    dark: { ...DEFAULT_THEME_PACKS.dark, fonts: { ...DEFAULT_THEME_PACKS.dark.fonts } },
  },
  cliPath: "",
  defaultModel: "",
  defaultEffort: "",
  defaultPermission: "auto",
  hideFullAccessWarning: false,
  showInspector: false,
  sendWithEnter: true,
  uiDensity: "comfortable",
  useSystemUiFont: false,
  chatFontSizePx: 13,
  terminalFontSizePx: 12,
  terminalFontFamily: "",
  timestampFormat: "locale",
  // Steer matches the desktop's existing behavior: active-turn context is sent
  // to the running CLI as soon as the runner reaches a safe boundary.
  followUpBehavior: "steer",
  enableAssistantStreaming: true,
  diffWordWrap: false,
  confirmThreadDelete: true,
  confirmThreadArchive: false,
  confirmTerminalTabClose: true,
  enableTaskCompletionToasts: true,
  enableSystemTaskCompletionNotifications: true,
  enableNotificationSound: true,
  environmentPanelDefaultOpen: false,
  showEnvironmentUsage: true,
  showEnvironmentLocalServers: true,
  showEnvironmentRepository: true,
  showEnvironmentEditor: true,
  showEnvironmentPinned: true,
  showEnvironmentMarkers: true,
  showEnvironmentNotepad: true,
  showEnvironmentActivity: true,
  sidebarProjectSortOrder: "manual",
  sidebarThreadSortOrder: "updated_at",
  customModelSlugs: [],
  enableAppSnap: false,
  appSnapShortcut: { kind: "both-option-keys" },
  appSnapPlaySound: true,
};

export interface Space {
  id: string;
  name: string;
  icon: SpaceIconName;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  sourcePaths?: string[];
  spaceId?: string | null;
  pinned?: boolean;
  /** Optional for backwards compatibility with state files from before project appearance settings. */
  icon?: ProjectIconName;
  /** Optional for backwards compatibility with state files from before project appearance settings. */
  color?: ProjectColorName;
  createdAt: number;
  lastOpenedAt: number;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  source?: AppSnapSource;
}

export interface AttachmentRejection {
  name: string;
  size: number;
  reason: string;
}

export interface AttachmentResolution {
  attachment: Attachment | null;
  rejection?: AttachmentRejection;
}

export interface AttachmentSelectionResult {
  attachments: Attachment[];
  rejected: AttachmentRejection[];
}

export type AttachmentPreviewKind = "image" | "pdf" | "text" | "video" | "audio" | "unsupported";

export interface AttachmentPreview {
  name: string;
  size: number;
  mimeType: string;
  kind: AttachmentPreviewKind;
  dataUrl?: string;
  text?: string;
  truncated?: boolean;
  reason?: string;
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
  id?: string;
}

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
}

/** Outcome from the auto-mode / bash safety classifier (Approve for me). */
export interface ClassifierDecision {
  decision: "allowed" | "denied";
  /** e.g. "auto-mode", "bash" */
  classifier?: string;
  reason?: string;
}

export interface RunActivity {
  label: string;
  detail?: string;
  data?: string;
  todos?: TodoItem[];
  /** The patch produced by this individual file-edit tool call, when available. */
  fileChange?: FileChange;
  toolUseId?: string;
  toolName?: string;
  result?: string;
  isError?: boolean;
  /** Present when the safety classifier auto-allowed or denied this tool. */
  classifierDecision?: ClassifierDecision;
  timestamp: number;
}

export type AgentStatus = "running" | "completed" | "error" | "stopped";

export interface AgentUsage {
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

export interface AgentProgress {
  description?: string;
  lastToolName?: string;
  summary?: string;
  usage?: AgentUsage;
  timestamp: number;
}

export type AgentWorkItem =
  | { type: "text"; text: string; mode?: "append" | "replace"; timestamp: number }
  | { type: "activity"; label: string; detail?: string; data?: string; toolUseId?: string; toolName?: string; result?: string; isError?: boolean; timestamp: number };

export interface AgentRun {
  taskId: string;
  toolUseId?: string;
  description: string;
  taskType?: string;
  agentType?: string;
  status: AgentStatus;
  lastToolName?: string;
  summary?: string;
  error?: string;
  outputFile?: string;
  usage?: AgentUsage;
  progress?: AgentProgress[];
  work?: AgentWorkItem[];
  startedAt: number;
  finishedAt?: number;
}

export type RunTimelineItem =
  | { type: "text"; text: string; timestamp: number }
  | ({ type: "activity" } & RunActivity)
  | { type: "agent"; agent: AgentRun; timestamp: number }
  | { type: "user-context"; text: string; attachments?: Attachment[]; timestamp: number };

export interface AskUserAnswer {
  question: string;
  answer: string;
  header?: string;
  multiSelect?: boolean;
}

export type ChatInteraction =
  | { type: "ask-user"; questions: AskUserAnswer[]; toolUseId?: string }
  | { type: "permission"; toolName: string; decision: "approved" | "denied"; detail?: string; remember?: boolean; toolUseId?: string };

export interface FileChange {
  path: string;
  patch: string;
  additions: number;
  deletions: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  /** Model selection used for this request/answer; absent on older history. */
  model?: string;
  attachments?: Attachment[];
  activity?: RunActivity[];
  timeline?: RunTimelineItem[];
  durationMs?: number;
  isError?: boolean;
  /** True when the user stopped this assistant turn before it completed. */
  interrupted?: boolean;
  interaction?: ChatInteraction;
  fileChanges?: FileChange[];
  /** Context added while a run was active; rendered inside the assistant work disclosure. */
  kind?: "follow-up";
  /**
   * The CLI transcript uuid for this message. Defaults to the desktop id for
   * user messages (passed as the stream-json uuid), so edits/reverts can target
   * it with --resume-session-at / rewind_files. After an edit-and-resend the
   * rewritten message receives a fresh uuid (the CLI dedups by uuid, so the
   * resent turn cannot reuse the original).
   */
  uuid?: string;
}

export interface ProfileUsage {
  totalTokens: number;
  dailyTokens: Record<string, number>;
  modelTokens: Record<string, number>;
  threadTokenTotals: Record<string, number>;
}

export type ThreadMarkerColor = "yellow" | "blue" | "green" | "pink";

export interface PinnedMessage {
  messageId: string;
  label?: string | null;
  done: boolean;
  pinnedAt: number;
}

export interface ThreadMarker {
  id: string;
  messageId: string;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  style: "highlight";
  color: ThreadMarkerColor;
  label?: string | null;
  done: boolean;
  createdAt: number;
}

/** Snapshot of an active /goal run driven by maximo-syntax-cli. */
export interface ThreadGoalState {
  /** Full latest status text from the CLI (e.g. "Goal continuing — …"). */
  statusText: string;
  /** Coarse phase for UI chrome. */
  phase: "active" | "paused" | "complete" | "unknown";
  updatedAt: number;
}

export interface Thread {
  id: string;
  projectId: string;
  /**
   * Renderer-only hydration marker. The main process keeps complete threads,
   * while workspace snapshots carry lightweight message shells for every
   * thread except the selected one.
   */
  detailLevel?: "summary" | "full";
  title: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  cliSessionId?: string;
  model?: string;
  effort?: string;
  permission?: PermissionMode;
  pinned?: boolean;
  archived?: boolean;
  unread?: boolean;
  contextUsage?: ContextUsage;
  /** Autonomous /goal mode status when a goal is active on this thread. */
  goal?: ThreadGoalState | null;
  messages: ChatMessage[];
  pinnedMessages?: PinnedMessage[];
  markers?: ThreadMarker[];
  notes?: string;
  /**
   * The CLI transcript uuid this thread is anchored to after an edit-and-resend
   * or revert-to-message. Subsequent runs pass it as --resume-session-at so the
   * CLI never reloads turns the desktop already discarded.
   */
  truncateAtUuid?: string;
}

export interface AppState {
  version: 1;
  settings: Settings;
  profile: ProfileUsage;
  spaces: Space[];
  projects: Project[];
  threads: Thread[];
  selectedProjectId?: string;
  selectedThreadId?: string;
  selectedSpaceId?: string | null;
  onboardingComplete: boolean;
  /**
   * Last app version whose What's New notes the user dismissed or silently
   * bootstrapped. `null` means first launch / never recorded.
   */
  lastSeenWhatsNewVersion: string | null;
}

export interface WhatsNewFeature {
  id: string;
  title: string;
  description: string;
}

export interface WhatsNewEntry {
  version: string;
  date: string;
  title: string | null;
  summary: string | null;
  releaseUrl: string | null;
  features: readonly WhatsNewFeature[];
}

export interface WhatsNewSnapshot {
  currentVersion: string;
  lastSeenVersion: string | null;
  decision: "show" | "silent-bootstrap" | "noop";
  currentEntry: WhatsNewEntry | null;
  allEntries: readonly WhatsNewEntry[];
  nextLastSeenVersion: string | null;
}

export type EngineSource = "configured" | "development" | "system" | "bundled" | "managed";
export type EnginePhase = "checking" | "installing" | "ready" | "error";

export interface EngineStatus {
  phase: EnginePhase;
  available: boolean;
  source?: EngineSource;
  entryPath?: string;
  version?: string;
  /** The newest published CLI version known to the app (from the npm registry). */
  latestVersion?: string;
  message: string;
  checkedAt: number;
}

/** Sign-in methods mirrored from Maximo Syntax CLI login. */
export type LoginMethod =
  | "maximoai" // Maximo AI subscription (browser OAuth)
  | "maximoai_api" // Maximo AI API key
  | "mytabulon" // MyTabulon Coding Plan (browser OAuth)
  | "mytabulon_api" // MyTabulon Coding Plan API key
  | "cencori" // Cencori API key
  | "openrouter" // OpenRouter API key
  | "opencode"; // OpenCode Go or Zen API key

export type OpenCodePlan = "zen" | "go";

export interface EngineModel {
  value: string;
  displayName: string;
  description: string;
  contextWindow?: number;
  isCurrent?: boolean;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  defaultEffort?: string;
  activeEffort?: string;
  supportsAutoMode?: boolean;
}

/** Live context-window telemetry derived from the Maximo Syntax CLI. */
export interface ContextUsageCategory {
  name: string;
  tokens: number;
  color?: string;
  isDeferred?: boolean;
}

export interface ContextApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ContextUsage {
  categories: ContextUsageCategory[];
  totalTokens: number;
  totalProcessedTokens?: number;
  maxTokens: number;
  rawMaxTokens: number;
  percentage: number;
  model: string;
  estimated?: boolean;
  lastInputTokens?: number;
  lastOutputTokens?: number;
  lastCachedInputTokens?: number;
  compactsAutomatically?: boolean;
  autoCompactThreshold?: number;
  isAutoCompactEnabled?: boolean;
  apiUsage?: ContextApiUsage | null;
}

export interface UsageLimit {
  id: string;
  label: string;
  utilization: number | null;
  resetsAt: string | null;
  used?: number;
  limit?: number;
}

export interface UsageSnapshot {
  available: boolean;
  provider: "maximoai" | "mytabulon" | "openrouter" | "opencode" | "unknown";
  planName?: string;
  concurrency?: number | null;
  balance?: number;
  walletBalance?: number;
  totalSpent?: number;
  totalDeposited?: number;
  currency?: string;
  limits: UsageLimit[];
  message?: string;
  fetchedAt: number;
}

export interface AccountStatus {
  loggedIn: boolean;
  authMethod: string;
  apiProvider?: string;
  email?: string;
  displayName?: string;
  orgName?: string;
  subscriptionType?: string;
}

export interface AccountActionResult {
  ok: boolean;
  message: string;
  status: AccountStatus;
}

export interface DesktopNotificationInput {
  title: string;
  body: string;
  threadId?: string;
  silent?: boolean;
}

export interface GitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  stagedAdditions?: number;
  stagedDeletions?: number;
  unstagedAdditions?: number;
  unstagedDeletions?: number;
  staged?: boolean;
  unstaged?: boolean;
}

export interface GitStatus {
  isRepository: boolean;
  branch: string;
  additions: number;
  deletions: number;
  files: GitFile[];
  clean: boolean;
}

export interface GitDiff {
  path: string;
  patch: string;
  /** UI provenance. Git IPC responses omit this; task-history selections set it in the renderer. */
  source?: "working-tree" | "unstaged" | "staged" | "turn";
  /** Assistant message that owns a persisted turn diff, used to reveal sibling files from the same turn. */
  turnId?: string;
}

export interface GitRemote {
  name: string;
  url: string;
}

export type WorkspaceEntryKind = "file" | "directory";

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  kind: WorkspaceEntryKind;
  size?: number;
  modifiedAt?: number;
}

export type WorkspaceFileKind = "text" | "image" | "pdf" | "unsupported";

export interface WorkspaceFileContent {
  name: string;
  path: string;
  kind: WorkspaceFileKind;
  mimeType: string;
  size: number;
  modifiedAt: number;
  content?: string;
  dataUrl?: string;
  truncated?: boolean;
  reason?: string;
}

export interface LocalServer {
  address: string;
  port: number;
  protocol: "http" | "https";
  pid?: number;
}

export type BrowserTabStatus = "live" | "suspended" | "error";

export interface BrowserTabState {
  id: string;
  url: string;
  title: string;
  status: BrowserTabStatus;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  faviconUrl: string | null;
  lastCommittedUrl: string | null;
  lastError: string | null;
  zoomFactor: number;
}

export interface BrowserCredentialPrompt {
  id: string;
  origin: string;
  host: string;
  username: string;
  mode: "save" | "update";
}

export interface BrowserPermissionPrompt {
  id: string;
  origin: string;
  host: string;
  permission: string;
  label: string;
}

export interface BrowserFindState {
  query: string;
  activeMatch: number;
  matches: number;
}

export type BrowserDownloadStatus = "progressing" | "completed" | "cancelled" | "interrupted";

export interface BrowserDownloadState {
  id: string;
  filename: string;
  path: string | null;
  url: string;
  receivedBytes: number;
  totalBytes: number;
  status: BrowserDownloadStatus;
  startedAt: number;
  canResume: boolean;
}

export interface BrowserState {
  threadId: string;
  version: number;
  open: boolean;
  activeTabId: string | null;
  tabs: BrowserTabState[];
  lastError: string | null;
  credentialPrompt: BrowserCredentialPrompt | null;
  permissionPrompt: BrowserPermissionPrompt | null;
  find: BrowserFindState | null;
  downloads: BrowserDownloadState[];
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  faviconUrl: string | null;
  lastVisitedAt: number;
  visitCount: number;
}

export interface BrowserProfileSettings {
  savePasswords: boolean;
  askWhereToSaveDownloads: boolean;
  downloadDirectory: string | null;
}

export interface BrowserProfileSnapshot extends BrowserProfileSettings {
  persistent: boolean;
  passwordStorageAvailable: boolean;
  historyCount: number;
  credentialCount: number;
  permissionCount: number;
  storagePath: string | null;
  defaultDownloadDirectory: string;
}

export interface BrowserProfileSettingsInput {
  savePasswords?: boolean;
  askWhereToSaveDownloads?: boolean;
  downloadDirectory?: string | null;
}

export interface BrowserHistorySearchInput {
  query: string;
  limit?: number;
}

export interface BrowserClearDataInput {
  history?: boolean;
  passwords?: boolean;
  permissions?: boolean;
  cookiesAndSiteData?: boolean;
  cache?: boolean;
}

export interface BrowserCredentialPromptResponse extends BrowserThreadInput {
  promptId: string;
  action: "save" | "never" | "not-now";
}

export interface BrowserPermissionPromptResponse extends BrowserThreadInput {
  promptId: string;
  action: "allow-once" | "allow-always" | "block";
}

export interface BrowserFindInput extends BrowserTabInput {
  query: string;
  forward?: boolean;
  findNext?: boolean;
}

export interface BrowserZoomInput extends BrowserTabInput {
  action: "in" | "out" | "reset";
}

export interface BrowserDownloadActionInput {
  downloadId: string;
  action: "open" | "show" | "cancel" | "resume" | "remove";
}

export type BrowserCommand = "focus-address" | "toggle-find";

export interface BrowserCommandEvent extends BrowserThreadInput {
  command: BrowserCommand;
}

export interface BrowserPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserThreadInput {
  threadId: string;
}

export interface BrowserTabInput extends BrowserThreadInput {
  tabId: string;
}

export interface BrowserOpenInput extends BrowserThreadInput {
  initialUrl?: string;
}

export interface BrowserNavigateInput extends BrowserThreadInput {
  tabId?: string;
  url: string;
}

export interface BrowserNewTabInput extends BrowserThreadInput {
  url?: string;
  activate?: boolean;
}

export interface BrowserSetPanelBoundsInput extends BrowserThreadInput {
  bounds: BrowserPanelBounds | null;
}

export interface BrowserScreenshotResult {
  name: string;
  mimeType: "image/png";
  sizeBytes: number;
  bytes: Uint8Array;
  /** Ready-to-render data URL for freeze-frames under HTML overlays. */
  dataUrl: string;
}

export interface BrowserCopyLinkEvent {
  threadId: string;
  url: string;
}

export interface BrowserOpenPanelRequest {
  threadId: string;
}

export interface BrowserControlApi {
  open(input: BrowserOpenInput): Promise<BrowserState>;
  close(input: BrowserThreadInput): Promise<BrowserState>;
  hide(input: BrowserThreadInput): Promise<void>;
  getState(input: BrowserThreadInput): Promise<BrowserState>;
  setPanelBounds(input: BrowserSetPanelBoundsInput): Promise<void>;
  navigate(input: BrowserNavigateInput): Promise<BrowserState>;
  reload(input: BrowserTabInput): Promise<BrowserState>;
  goBack(input: BrowserTabInput): Promise<BrowserState>;
  goForward(input: BrowserTabInput): Promise<BrowserState>;
  newTab(input: BrowserNewTabInput): Promise<BrowserState>;
  closeTab(input: BrowserTabInput): Promise<BrowserState>;
  selectTab(input: BrowserTabInput): Promise<BrowserState>;
  captureScreenshot(input: BrowserTabInput): Promise<BrowserScreenshotResult>;
  copyScreenshotToClipboard(input: BrowserTabInput): Promise<void>;
  copyLink(input: BrowserTabInput): Promise<void>;
  openDevTools(input: BrowserTabInput): Promise<void>;
  searchHistory(input: BrowserHistorySearchInput): Promise<BrowserHistoryEntry[]>;
  getProfile(): Promise<BrowserProfileSnapshot>;
  updateProfileSettings(input: BrowserProfileSettingsInput): Promise<BrowserProfileSnapshot>;
  chooseDownloadDirectory(): Promise<string | null>;
  clearData(input: BrowserClearDataInput): Promise<BrowserProfileSnapshot>;
  respondToCredentialPrompt(input: BrowserCredentialPromptResponse): Promise<BrowserState>;
  respondToPermissionPrompt(input: BrowserPermissionPromptResponse): Promise<BrowserState>;
  findInPage(input: BrowserFindInput): Promise<BrowserState>;
  stopFindInPage(input: BrowserTabInput): Promise<BrowserState>;
  zoom(input: BrowserZoomInput): Promise<BrowserState>;
  downloadAction(input: BrowserDownloadActionInput): Promise<void>;
  onState(callback: (state: BrowserState) => void): () => void;
  onOpenPanelRequest(callback: (request: BrowserOpenPanelRequest) => void): () => void;
  onCopyLink(callback: (event: BrowserCopyLinkEvent) => void): () => void;
  onCommand(callback: (event: BrowserCommandEvent) => void): () => void;
}

export interface TerminalSession {
  sessionId: string;
  cwd: string;
  shell: string;
}

export type AutomationSchedule =
  | { type: "manual" }
  | { type: "once"; runAt: string }
  | { type: "interval"; everyMinutes: number }
  | { type: "daily"; timeOfDay: string; timezone: string }
  | { type: "weekdays"; timeOfDay: string; timezone: string }
  | { type: "weekly"; dayOfWeek: number; timeOfDay: string; timezone: string }
  | { type: "cron"; expression: string; timezone: string };

export type AutomationDestination = "new_chat" | "dedicated_chat" | "existing_chat";
export type AutomationWorkspaceMode = "auto" | "local" | "worktree";
export type AutomationNotificationPolicy = "all" | "failures_only" | "none";

export interface AutomationDefinition {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  projectId: string;
  destination: AutomationDestination;
  threadId?: string;
  schedule: AutomationSchedule;
  enabled: boolean;
  model: string;
  effort: string;
  permission: PermissionMode;
  workspaceMode: AutomationWorkspaceMode;
  allowLocalFallback: boolean;
  notificationPolicy: AutomationNotificationPolicy;
  maxRuntimeMinutes: number;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: AutomationRunStatus;
}

export type AutomationRunTrigger = "scheduled" | "manual" | "catch_up";
export type AutomationRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped" | "interrupted";

export interface AutomationRun {
  id: string;
  automationId: string;
  projectId: string;
  threadId?: string;
  trigger: AutomationRunTrigger;
  status: AutomationRunStatus;
  scheduledFor: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  workspacePath?: string;
  unread: boolean;
}

export interface AutomationSnapshot {
  automations: AutomationDefinition[];
  runs: AutomationRun[];
  activeCount: number;
  unreadCount: number;
}

export interface AutomationCreateInput {
  name: string;
  description?: string;
  prompt: string;
  projectId: string;
  destination?: AutomationDestination;
  threadId?: string;
  schedule: AutomationSchedule;
  enabled?: boolean;
  model?: string;
  effort?: string;
  permission?: PermissionMode;
  workspaceMode?: AutomationWorkspaceMode;
  allowLocalFallback?: boolean;
  notificationPolicy?: AutomationNotificationPolicy;
  maxRuntimeMinutes?: number;
}

export type AutomationUpdateInput = Partial<Omit<AutomationCreateInput, "projectId">> & {
  projectId?: string;
};

export interface AutomationControlApi {
  list(): Promise<AutomationSnapshot>;
  create(input: AutomationCreateInput): Promise<AutomationSnapshot>;
  update(automationId: string, input: AutomationUpdateInput): Promise<AutomationSnapshot>;
  setEnabled(automationId: string, enabled: boolean): Promise<AutomationSnapshot>;
  delete(automationId: string): Promise<AutomationSnapshot>;
  runNow(automationId: string): Promise<AutomationSnapshot>;
  cancelRun(runId: string): Promise<AutomationSnapshot>;
  markRunsRead(automationId?: string): Promise<AutomationSnapshot>;
  onChanged(callback: (snapshot: AutomationSnapshot) => void): () => void;
}

export type TerminalEvent =
  | { type: "started"; sessionId: string; cwd: string; shell: string; timestamp: number }
  | { type: "output"; sessionId: string; text: string; timestamp: number }
  | { type: "exit"; sessionId: string; code: number | null; signal?: string; timestamp: number }
  | { type: "error"; sessionId: string; message: string; timestamp: number };

export interface RunRequest {
  threadId: string;
  prompt: string;
  attachments: Attachment[];
  model: string;
  effort: string;
  permission: PermissionMode;
  /** Additional project folders exposed to the CLI for this run. */
  additionalDirectories?: string[];
  /** Model context limit from the provider catalog, when available. */
  contextWindow?: number;
  /** True when this message was added as context while a run was active. */
  asFollowUp?: boolean;
  /**
   * Edit-and-resend: the desktop ChatMessage.id of the user message being
   * edited. When present, the run resumes the transcript truncated at that
   * message (the CLI's --resume-session-at) and replays the edited prompt.
   */
  editMessageId?: string;
  /**
   * Revert-to-message: the desktop ChatMessage.id of the user message to
   * roll the transcript back to. When present, the run resumes the
   * transcript truncated at that message with no new prompt turn.
   */
  revertToMessageId?: string;
  /** Revert-to-message with file restore: also rewind tracked files to this user message. */
  revertFiles?: boolean;
  /**
   * The CLI transcript uuid to truncate at for this run (--resume-session-at).
   * For edit-and-resend this is the uuid of the message before the edited one
   * (so the edited message is replaced, not kept); for revert it is the target
   * user message's uuid (kept inclusive). When set, the run also forks the
   * session so the truncated history is durable.
   */
  resumeSessionAt?: string;
  /** The CLI uuid to use for this run's first user turn. */
  userMessageUuid?: string;
}

export interface RevertResult {
  ok: boolean;
  error?: string;
  /** Number of conversation messages discarded by the revert. */
  removedMessages?: number;
  /** Number of tracked files restored when revertFiles was requested. */
  restoredFiles?: number;
}

export type RunEvent =
  | { type: "started"; threadId: string; pid: number; timestamp: number }
  | { type: "session"; threadId: string; sessionId: string; timestamp: number }
  | { type: "commands"; threadId: string; commands: SlashCommand[]; skills?: SlashCommand[]; timestamp: number }
  | { type: "text"; threadId: string; text: string; mode: "append" | "replace"; timestamp: number }
  | { type: "activity"; threadId: string; label: string; detail?: string; data?: string; todos?: TodoItem[]; fileChange?: FileChange; toolUseId?: string; toolName?: string; timestamp: number }
  | { type: "activity-result"; threadId: string; toolUseId: string; result?: string; isError?: boolean; fileChange?: FileChange; classifierDecision?: ClassifierDecision; timestamp: number }
  | { type: "context"; threadId: string; context: ContextUsage; timestamp: number }
  | { type: "agent-started"; threadId: string; taskId: string; toolUseId?: string; description: string; taskType?: string; agentType?: string; timestamp: number }
  | { type: "agent-progress"; threadId: string; taskId: string; toolUseId?: string; description?: string; lastToolName?: string; summary?: string; usage?: AgentUsage; timestamp: number }
  | { type: "agent-work"; threadId: string; taskId: string; work: AgentWorkItem; timestamp: number }
  | { type: "agent-finished"; threadId: string; taskId: string; toolUseId?: string; status: Exclude<AgentStatus, "running">; summary?: string; error?: string; outputFile?: string; usage?: AgentUsage; timestamp: number }
  | { type: "classifier-decision"; threadId: string; toolUseId: string; toolName?: string; decision: ClassifierDecision["decision"]; classifier?: string; reason?: string; timestamp: number }
  | { type: "question"; threadId: string; requestId: string; toolUseId?: string; toolName: string; data: string; timestamp: number }
  | { type: "permission"; threadId: string; requestId: string; toolUseId?: string; toolName: string; data: string; timestamp: number }
  | { type: "log"; threadId: string; level: "info" | "warning" | "error"; text: string; timestamp: number }
  | { type: "status"; threadId: string; status: string | null; timestamp: number }
  | { type: "retrying"; threadId: string; attempt: number; max: number; delayMs: number; message: string; timestamp: number }
  | { type: "turn-started"; threadId: string; timestamp: number }
  | { type: "turn-complete"; threadId: string; status: ThreadStatus; timestamp: number }
  | { type: "finished"; threadId: string; status: ThreadStatus; exitCode: number | null; timestamp: number };

export interface RunResult {
  accepted: boolean;
  error?: string;
  state?: AppState;
}

export type AppUpdateStatus = "idle" | "checking" | "available" | "up-to-date" | "error";

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  message: string | null;
  checkedAt: string | null;
}

export interface AppUpdateOpenResult {
  opened: boolean;
  url: string | null;
  state: AppUpdateState;
}

export interface DesktopApi {
  appInfo(): Promise<{ version: string; platform: string; dataPath: string }>;
  getUpdateState(): Promise<AppUpdateState>;
  checkForUpdates(): Promise<AppUpdateState>;
  openUpdateDownload(): Promise<AppUpdateOpenResult>;
  onUpdateState(callback: (state: AppUpdateState) => void): () => void;
  loadWhatsNew(): Promise<WhatsNewSnapshot>;
  markWhatsNewSeen(version?: string): Promise<AppState>;
  loadState(): Promise<AppState>;
  listSkills(projectPath?: string): Promise<SlashCommand[]>;
  completeOnboarding(): Promise<AppState>;
  updateSettings(patch: Partial<Settings>): Promise<AppState>;
  resetProviderSelections(): Promise<AppState>;
  createSpace(name: string, icon: SpaceIconName): Promise<AppState>;
  selectSpace(spaceId: string | null): Promise<AppState>;
  chooseProject(): Promise<Project | null>;
  chooseProjectSources(): Promise<string[]>;
  createProject(name: string, sourcePaths: string[], spaceId?: string | null, icon?: ProjectIconName, color?: ProjectColorName): Promise<AppState>;
  addProject(path: string): Promise<AppState>;
  selectProject(projectId: string): Promise<AppState>;
  renameProject(projectId: string, name: string): Promise<AppState>;
  updateProject(projectId: string, name: string, sourcePaths: string[], icon: ProjectIconName, color: ProjectColorName): Promise<AppState>;
  toggleProjectPinned(projectId: string): Promise<AppState>;
  reorderProjects(sourceProjectId: string, targetProjectId: string): Promise<AppState>;
  archiveProjectThreads(projectId: string): Promise<AppState>;
  archiveThread(threadId: string): Promise<AppState>;
  unarchiveThread(threadId: string): Promise<AppState>;
  removeProject(projectId: string): Promise<AppState>;
  createThread(projectId: string): Promise<AppState>;
  recordQuestionInteraction(threadId: string, questions: AskUserAnswer[], toolUseId?: string): Promise<AppState>;
  recordPermissionInteraction(threadId: string, interaction: { toolName: string; decision: "approved" | "denied"; detail?: string; remember?: boolean; toolUseId?: string }): Promise<AppState>;
  selectThread(threadId: string): Promise<AppState>;
  activateThread(threadId: string): Promise<void>;
  loadThreadDetail(threadId: string): Promise<Thread>;
  markThreadRead(threadId: string): Promise<AppState>;
  markAllNotificationsRead(): Promise<AppState>;
  renameThread(threadId: string, title: string): Promise<AppState>;
  toggleThreadPinned(threadId: string): Promise<AppState>;
  toggleMessagePinned(threadId: string, messageId: string): Promise<AppState>;
  setMessagePinDone(threadId: string, messageId: string, done: boolean): Promise<AppState>;
  setMessagePinLabel(threadId: string, messageId: string, label: string | null): Promise<AppState>;
  removeMessagePin(threadId: string, messageId: string): Promise<AppState>;
  toggleThreadMarker(threadId: string, messageId: string): Promise<AppState>;
  setThreadMarkerDone(threadId: string, markerId: string, done: boolean): Promise<AppState>;
  setThreadMarkerLabel(threadId: string, markerId: string, label: string | null): Promise<AppState>;
  removeThreadMarker(threadId: string, markerId: string): Promise<AppState>;
  updateThreadNotes(threadId: string, notes: string): Promise<AppState>;
  deleteThread(threadId: string): Promise<AppState>;
  chooseAttachments(): Promise<AttachmentSelectionResult>;
  attachmentFromPath(path: string): Promise<AttachmentResolution>;
  savePastedAttachment(name: string, bytes: Uint8Array): Promise<AttachmentResolution>;
  previewAttachment(path: string, thumbnail?: boolean): Promise<AttachmentPreview | null>;
  filePath(file: unknown): string;
  ensureEngine(forceRepair?: boolean): Promise<EngineStatus>;
  engineStatus(): Promise<EngineStatus>;
  updateEngine(): Promise<EngineStatus>;
  engineModels(): Promise<EngineModel[]>;
  accountStatus(): Promise<AccountStatus>;
  accountLogin(method: LoginMethod, apiKey?: string, openCodePlan?: OpenCodePlan): Promise<AccountActionResult>;
  accountCancelLogin(): Promise<{ ok: boolean; message: string }>;
  accountLogout(): Promise<AccountActionResult>;
  accountUsage(): Promise<UsageSnapshot>;
  notifications: {
    isSupported(): Promise<boolean>;
    show(input: DesktopNotificationInput): Promise<boolean>;
    playSound(): Promise<boolean>;
    onOpenThread(callback: (threadId: string) => void): () => void;
  };
  appSnap: {
    getState(): Promise<DesktopAppSnapState>;
    setEnabled(enabled: boolean): Promise<DesktopAppSnapState>;
    checkShortcut(shortcut: DesktopAppSnapShortcut): Promise<DesktopAppSnapShortcutAvailability>;
    setShortcut(shortcut: DesktopAppSnapShortcut): Promise<DesktopAppSnapShortcutUpdateResult>;
    requestPermissions(): Promise<DesktopAppSnapState>;
    requestInputMonitoring(): Promise<DesktopAppSnapState>;
    triggerCapture(): Promise<boolean>;
    openPrivacySettings(pane?: "input" | "screen"): Promise<boolean>;
    listPendingCaptures(): Promise<DesktopAppSnapCapture[]>;
    acknowledgeCapture(captureId: string): Promise<void>;
    onCaptured(listener: (capture: DesktopAppSnapCapture) => void): () => void;
    onError(listener: (error: DesktopAppSnapErrorEvent) => void): () => void;
    onState(listener: (state: DesktopAppSnapState) => void): () => void;
  };
  startRun(request: RunRequest): Promise<RunResult>;
  sendToRun(request: RunRequest): Promise<RunResult>;
  editAndResendMessage(request: RunRequest): Promise<RunResult>;
  revertToMessage(input: { threadId: string; messageId: string; revertFiles?: boolean }): Promise<RevertResult & { state?: AppState }>;
  contextUsage(threadId: string): Promise<ContextUsage | null>;
  respondToPermission(threadId: string, response: { requestId: string; behavior: "allow" | "deny"; updatedInput?: Record<string, unknown>; message?: string; toolUseID?: string; updatedPermissions?: unknown[] }): Promise<boolean>;
  stopRun(threadId: string): Promise<boolean>;
  gitStatus(projectId: string): Promise<GitStatus>;
  gitBranches(projectId: string): Promise<{ current: string; branches: string[]; dirty: boolean }>;
  gitCheckout(projectId: string, branch: string): Promise<GitStatus>;
  gitCreateBranch(projectId: string, branch: string): Promise<GitStatus>;
  gitDiff(projectId: string, path: string, scope?: "working-tree" | "unstaged" | "staged"): Promise<GitDiff>;
  gitStage(projectId: string, paths: string[]): Promise<GitStatus>;
  gitUnstage(projectId: string, paths: string[]): Promise<GitStatus>;
  gitCommitPush(projectId: string, message: string): Promise<GitStatus>;
  gitRemote(projectId: string): Promise<GitRemote | null>;
  listWorkspaceFiles(projectId: string, relativePath?: string, query?: string): Promise<WorkspaceFileEntry[]>;
  readWorkspaceFile(projectId: string, relativePath: string): Promise<WorkspaceFileContent>;
  writeWorkspaceFile(projectId: string, relativePath: string, content: string, expectedModifiedAt?: number): Promise<WorkspaceFileContent>;
  listLocalServers(): Promise<LocalServer[]>;
  terminalStart(projectId: string): Promise<TerminalSession>;
  terminalInput(sessionId: string, input: string): Promise<boolean>;
  terminalResize(sessionId: string, columns: number, rows: number): Promise<boolean>;
  terminalStop(sessionId: string): Promise<boolean>;
  revealPath(path: string): Promise<void>;
  openPath(path: string): Promise<string>;
  copyImageToClipboard(bytes: Uint8Array): Promise<boolean>;
  openInEditor(path: string): Promise<void>;
  browser: BrowserControlApi;
  automations: AutomationControlApi;
  onRunEvent(callback: (event: RunEvent) => void): () => void;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  onMenuAction(callback: (action: string) => void): () => void;
}
