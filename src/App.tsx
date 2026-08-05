import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Activity as ActivityIcon, AlertCircle, Archive, ArrowLeft, ArrowRight, ArrowUp, Bell, Bot, Box, Boxes, Bug, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDot, CircleHelp, CirclePlus, CircleStop, Clock3, Code2, CodeXml, Columns3, Command, Copy, CornerDownRight, Eye, FileCheck2, Gauge, Keyboard, Monitor,
  File, FileAudio, FileCode2, FileImage, FilePenLine, FilePlus2, FileSearch, FileText, FileVideo, Folder, FolderOpen, Folders, GitBranch, Globe2, HardDrive, LogOut, Menu, SquarePen,
  GitPullRequest, Link2, ListChecks, ListTodo, MessageSquare, MoreHorizontal, PanelLeft, PanelRight, Paperclip, Pencil, Pin, PinOff, Plus, Plug, RefreshCw, Search, Settings, Share2, SlidersHorizontal,
  Download, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, Sun, Target, TerminalSquare, Trash2, Undo2, Upload, UserCircle, UserRound, Users, WandSparkles, Wrench, Workflow, X, Zap,
} from "lucide-react";
import { DEFAULT_SETTINGS, MAX_ATTACHMENT_COUNT } from "../desktop/types";
import type {
  AccountStatus, AgentRun, AgentStatus, AgentWorkItem, AppState, AppUpdateState, AskUserAnswer, Attachment, AttachmentPreview, AttachmentPreviewKind, ChatInteraction, ChatMessage, ContextUsage, EngineModel, EngineStatus, FileChange, FollowUpBehavior, GitDiff, GitStatus, LoginMethod, OpenCodePlan, PermissionMode, ProfileUsage, Project, RunActivity, RunEvent, RunTimelineItem, SlashCommand, Space, SpaceIconName, ThemeMode, ThemePack, ThemePresetId, ThemeVariant, Thread, ThreadGoalState, TimestampFormat, TodoItem, UsageSnapshot, WhatsNewSnapshot,
} from "../desktop/types";
import {
  getAppUpdateButtonLabel,
  getAppUpdateButtonTooltip,
  shouldShowAppUpdateButton,
} from "../desktop/app-updater";
import { createThemeShareString, buildThemeCssVariables, getAvailableThemePresets, getThemePreset, normalizeFontFamily, normalizeHexColor, parseThemeShareString, resolveThemeVariant } from "../desktop/theme";
import logoUrl from "./assets/maximoai-logo.svg";
import modelOpenAiUrl from "./assets/model-openai.svg";
import modelOpenAiCodexUrl from "./assets/model-openai-codex.svg";
import modelClaudeUrl from "./assets/model-claudeai.svg";
import modelAnthropicUrl from "./assets/model-anthropic.svg";
import modelGrokUrl from "./assets/model-grok.svg";
import modelGoogleUrl from "./assets/model-google.svg";
import modelDeepSeekUrl from "./assets/model-deepseek.svg";
import modelMistralUrl from "./assets/model-mistral.svg";
import modelMetaUrl from "./assets/model-meta.svg";
import modelPerplexityUrl from "./assets/model-perplexity.svg";
import modelOllamaUrl from "./assets/model-ollama.svg";
import CreateProjectModal from "./components/CreateProjectModal";
import SpaceEditorModal from "./components/SpaceEditorModal";
import { SpaceIcon } from "./components/SpaceIcon";
import DiffReview, { DiffCode, patchStats } from "./components/DiffReview";
import ActivitySidebar from "./components/ActivitySidebar";
import KanbanView from "./components/KanbanView";
import MarkdownContent from "./components/MarkdownContent";
import PullRequestsView from "./components/PullRequestsView";
import SearchPalette from "./components/SearchPalette";
import QuestionModal, { type Question } from "./components/QuestionModal";
import PermissionRequestModal, { type PermissionRequestPayload } from "./components/PermissionRequestModal";
import SidebarHoverCard from "./components/SidebarHoverCard";
import MessageTrail from "./components/MessageTrail";
import WorkspaceDock, { type WorkspaceDockRequest, type WorkspacePaneKind } from "./components/WorkspaceDock";
import WorkspaceEnvironment from "./components/WorkspaceEnvironment";
import WhatsNewDialog from "./components/WhatsNewDialog";
import WhatsNewPopoutCard from "./components/WhatsNewPopoutCard";
import { composerKeyAction, composerSendShortcutLabel } from "./composerKeyboard";
import { MAXIMO_SHORTCUTS, matchesShortcut, shortcutLabel } from "./shortcuts";

type LiveRun = { text: string; activity: RunActivity[]; timeline: RunTimelineItem[]; logs: Array<{ level: string; text: string; timestamp: number }> };
type WorkspaceSurface = "chat" | "activity" | "kanban" | "pull-requests";

const MAX_LIVE_ACTIVITY_ITEMS = 500;
const MAX_LIVE_TIMELINE_ITEMS = 800;
const MAX_LIVE_LOG_ITEMS = 200;

const permissionOptions: SelectOption<PermissionMode>[] = [
  { value: "default", label: "Ask for approval", description: "Permission prompts restored for every tool action", icon: <ShieldCheck size={14} /> },
  { value: "plan", label: "Plan mode", description: "Read-only until you approve a plan", icon: <Eye size={14} /> },
  { value: "acceptEdits", label: "Accept edits", description: "File edits are auto-approved; commands still ask", icon: <FileCheck2 size={14} /> },
  { value: "auto", label: "Approve for me", description: "Safe tools run; risky tools are classified by the AI classifier", icon: <CircleHelp size={14} /> },
  { value: "full", label: "Full access", description: "No prompts and no safety classifier; use only in trusted projects", icon: <ShieldAlert size={14} /> },
];
type LoginMethodOption = {
  value: LoginMethod;
  label: string;
  description: string;
  needsKey: boolean;
  placeholder?: string;
  helpUrl?: string;
  helpLabel?: string;
  browserHint?: string;
};

const loginMethodOptions: LoginMethodOption[] = [
  {
    value: "maximoai",
    label: "Maximo AI subscription",
    description: "Browser sign-in · Plus, Prime, and Pro",
    needsKey: false,
    browserHint: "Opens your browser to sign in with your Maximo AI plan.",
  },
  {
    value: "maximoai_api",
    label: "Maximo AI API key",
    description: "API usage billing from the Maximo AI platform",
    needsKey: true,
    placeholder: "Paste your Maximo AI API key",
    helpUrl: "https://maximoai.co/platform",
    helpLabel: "Get a key at maximoai.co/platform",
  },
  {
    value: "mytabulon",
    label: "MyTabulon · browser",
    description: "Recommended Coding Plan sign-in",
    needsKey: false,
    browserHint: "Opens your browser to connect a MyTabulon Coding Plan.",
  },
  {
    value: "mytabulon_api",
    label: "MyTabulon · API key",
    description: "Use an existing mtb_live_ key",
    needsKey: true,
    placeholder: "mtb_live_…",
    helpUrl: "https://platform.mytabulon.com/dashboard/keys",
    helpLabel: "Get a key at platform.mytabulon.com",
  },
  {
    value: "cencori",
    label: "Cencori API key",
    description: "OpenAI-compatible key from api.cencori.com",
    needsKey: true,
    placeholder: "csk_…",
    helpUrl: "https://api.cencori.com/dashboard/keys",
    helpLabel: "Get a key at api.cencori.com",
  },
  {
    value: "openrouter",
    label: "OpenRouter API key",
    description: "OpenAI-compatible access to many models",
    needsKey: true,
    placeholder: "sk-or-v1-…",
    helpUrl: "https://openrouter.ai/settings/keys",
    helpLabel: "Get a key at openrouter.ai",
  },
  {
    value: "opencode",
    label: "OpenCode",
    description: "Choose OpenCode Go or Zen",
    needsKey: true,
    placeholder: "Paste your OpenCode API key",
    helpUrl: "https://opencode.ai/auth",
    helpLabel: "Get a key at opencode.ai/auth",
  },
];

function providerLabel(account: AccountStatus | null | undefined): string {
  if (!account?.loggedIn) return "Account";
  const method = account.authMethod;
  if (method === "mytabulon") return "MyTabulon";
  if (method === "cencori") return "Cencori";
  if (method === "openrouter") return "OpenRouter";
  if (method === "opencode_go") return "OpenCode Go";
  if (method === "opencode_zen") return "OpenCode Zen";
  if (method === "maximoai_api" || method === "api_key") return "Maximo AI · API key";
  if (account.apiProvider) return account.apiProvider;
  return "Maximo AI";
}

function accountDetailText(account: AccountStatus | null | undefined): string {
  if (!account) return "Reading account status…";
  if (!account.loggedIn) return "Sign in to use Maximo Syntax with your plan or API key.";
  if (account.authMethod === "maximo.ai") {
    return `Maximo AI ${account.subscriptionType ? `${account.subscriptionType} ` : ""}subscription`;
  }
  if (account.authMethod === "mytabulon") {
    return `MyTabulon ${account.subscriptionType ?? "Coding Plan"}`;
  }
  if (account.authMethod === "cencori") return "Cencori API key";
  if (account.authMethod === "openrouter") return "OpenRouter API key";
  if (account.authMethod === "opencode_go") return "OpenCode Go";
  if (account.authMethod === "opencode_zen") return "OpenCode Zen";
  if (account.authMethod === "maximoai_api" || account.authMethod === "api_key") return "Maximo AI API key";
  return account.orgName || account.subscriptionType || account.apiProvider || "Connected provider";
}

type AccountSignInStep = "hub" | "method" | "details";

function OpenCodePlanPicker({ plan, onChange, disabled }: { plan: OpenCodePlan; onChange: (plan: OpenCodePlan) => void; disabled: boolean }) {
  return (
    <div className="opencode-plan-picker" role="radiogroup" aria-label="OpenCode plan">
      {(["zen", "go"] as OpenCodePlan[]).map((value) => (
        <button
          type="button"
          key={value}
          className={plan === value ? "active" : ""}
          role="radio"
          aria-checked={plan === value}
          disabled={disabled}
          onClick={() => onChange(value)}
        >
          <strong>{value === "zen" ? "Zen" : "Go"}</strong>
          <small>{value === "zen" ? "Curated models" : "Low-cost plan"}</small>
        </button>
      ))}
    </div>
  );
}

const fallbackModelOptions: SelectOption<string>[] = [{ value: "", label: "CLI default", description: "Use the default reported by Syntax" }];

/** Brand whose logo should be shown for a model id (or provider label). */
export type ModelProvider =
  | "maximo"
  | "openai"
  | "openai-codex"
  | "claude"
  | "anthropic"
  | "grok"
  | "google"
  | "deepseek"
  | "mistral"
  | "meta"
  | "perplexity"
  | "ollama"
  | "unknown";

/**
 * Map a raw model id / display label to a provider brand. Checks the exact
 * id first, then falls back to prefix patterns so future model versions
 * (gpt-5.x, claude-opus-5, gemini-3, …) automatically match their brand.
 * Display labels are matched by brand words ("Maximo Atlas", "Claude Sonnet 4").
 * An empty/unknown id and the "CLI default"/"Default …" labels resolve to the
 * app's own brand (Maximo) rather than the robot fallback, since those always
 * mean the signed-in provider's recommended model. Never throws.
 */
export function modelProvider(modelId: string | undefined | null): ModelProvider {
  const raw = (modelId ?? "").trim();
  const id = raw.toLowerCase();
  if (!id || id === "default" || id === "cli default" || id === "default (recommended)") return "maximo";
  // Exact / alias matches before pattern matching.
  if (id === "codex" || id === "gpt-codex" || id === "openai-codex") return "openai-codex";
  if (id === "chatgpt" || id === "openai" || id === "gpt") return "openai";
  if (id === "claude" || id === "anthropic") return "claude";
  if (id === "gemini" || id === "google") return "google";
  if (id === "grok" || id === "xai") return "grok";
  if (id === "deepseek") return "deepseek";
  if (id === "mistral" || id === "mixtral" || id === "codestral") return "mistral";
  if (id === "llama" || id === "meta" || id === "meta-ai") return "meta";
  if (id === "maximo" || id === "maximo ai") return "maximo";
  if (id === "perplexity" || id === "pplx") return "perplexity";
  if (id === "ollama") return "ollama";
  // Pattern matches (lowercased). Order matters: more specific first.
  if (/^maximo-(pandora|atlas|astra|alpha)/.test(id) || /(^|[\s-_])maximo/.test(id)) return "maximo";
  if (/^gpt-?/.test(id) || /^o[0-9](-|$)/.test(id) || /^chatgpt/.test(id) || /(^|[\s-_])gpt-?[0-9]/.test(id)) return "openai";
  if (/codex/.test(id)) return "openai-codex";
  if (/^claude/.test(id) || /(^|[\s-_])claude/.test(id)) return "claude";
  if (/^anthropic/.test(id) || /(^|[\s-_])anthropic/.test(id)) return "anthropic";
  if (/^gemini/.test(id) || /^google/.test(id) || /(^|[\s-_])gemini/.test(id)) return "google";
  if (/^grok/.test(id) || /^xai/.test(id) || /(^|[\s-_])grok/.test(id)) return "grok";
  if (/^deepseek/.test(id) || /(^|[\s-_])deepseek/.test(id)) return "deepseek";
  if (/^(mistral|mixtral|codestral)/.test(id) || /(^|[\s-_])mistral/.test(id)) return "mistral";
  if (/^(llama|meta)/.test(id) || /(^|[\s-_])llama/.test(id) || /(^|[\s-_])meta/.test(id)) return "meta";
  if (/^perplexity|^pplx/.test(id) || /(^|[\s-_])perplexity/.test(id)) return "perplexity";
  if (/^ollama/.test(id) || /(^|[\s-_])ollama/.test(id)) return "ollama";
  return "unknown";
}

const MODEL_PROVIDER_LOGOS: Partial<Record<ModelProvider, string>> = {
  maximo: logoUrl,
  openai: modelOpenAiUrl,
  "openai-codex": modelOpenAiCodexUrl,
  claude: modelClaudeUrl,
  anthropic: modelAnthropicUrl,
  grok: modelGrokUrl,
  google: modelGoogleUrl,
  deepseek: modelDeepSeekUrl,
  mistral: modelMistralUrl,
  meta: modelMetaUrl,
  perplexity: modelPerplexityUrl,
  ollama: modelOllamaUrl,
};

function ModelLogo({ model, className }: { model?: string | null; className?: string }) {
  const provider = modelProvider(model);
  const src = provider === "unknown" ? undefined : MODEL_PROVIDER_LOGOS[provider];
  if (src) {
    return <img className={`model-logo ${className ?? ""}`.trim()} src={src} alt="" aria-hidden="true" draggable={false} />;
  }
  return <Bot className={`model-logo-fallback ${className ?? ""}`.trim()} size={13} aria-hidden="true" />;
}
// User-invocable commands used while the engine catalog is loading. The live
// CLI catalog and local SKILL.md files replace these as soon as they arrive.
const fallbackSlashCommands: SlashCommand[] = [
  { name: "goal", description: "Set or manage an autonomous goal (status | pause | resume | clear)", argumentHint: "<objective> [--budget <tokens>] | status | pause | resume | clear" },
  { name: "update-config", description: "Configure Maximo Syntax via settings.json (permissions, hooks, env vars)" },
  { name: "simplify", description: "Review changed code for reuse, quality, and efficiency, then fix any issues found" },
  { name: "debug", description: "Enable debug logging for this session and help diagnose issues" },
  { name: "batch", description: "Research and plan a large-scale change, then execute it in parallel across isolated worktree agents" },
];

function parseThreadGoalPhase(statusText: string): "active" | "paused" | "complete" | "unknown" {
  const lower = statusText.toLowerCase();
  if (lower.includes("goal complete") || lower.startsWith("goal complete")) return "complete";
  if (lower.includes("goal paused") || lower.includes("paused —") || lower.includes("paused -")) return "paused";
  if (lower.includes("goal continuing") || lower.includes("goal set") || lower.includes("resuming goal") || lower.includes("goal:")) return "active";
  return "unknown";
}

function goalStateFromText(statusText: string, timestamp: number): ThreadGoalState {
  return {
    statusText: statusText.slice(0, 500),
    phase: parseThreadGoalPhase(statusText),
    updatedAt: timestamp,
  };
}
// Built-in CLI commands that only operate in the CLI's terminal UI and are
// useless (or harmful) inside the desktop app. They are excluded from the
// desktop "/" menu while supported commands and skills remain available.
const desktopIncompatibleCommands = new Set([
  "clear", "compact", "cost", "model", "help", "btw", "theme", "color", "vim",
  "keybindings", "exit", "statusline", "stickers", "mobile", "fast", "effort",
  "output-style", "permissions", "plan", "auto", "config", "context", "branch",
  "rename", "resume", "rewind", "summary", "share", "export", "copy", "usage",
  "upgrade", "update", "doctor", "stats", "status", "tag", "diff", "files",
  "memory", "mcp", "ide", "add-dir", "agent", "agents", "init", "install",
  "login", "logout", "feedback", "privacy-settings", "hooks", "release-notes",
  "reload-plugins", "sandbox", "terminal-setup", "remote-control", "session",
  "extra-usage", "rate-limit-options", "tasks", "pr-comments", "security-review",
  "commit", "commit-push-pr", "create-moved-to-plugin", "bridge-kick", "issue",
  "review", "ultrareview", "passes", "brief", "voice", "proactive", "buddy",
  "web", "fork", "thinkback", "thinkback-play", "remote-env", "teleport",
  "good-maximo", "bughunter", "mock-limits", "reset-limits", "backfill-sessions",
  "break-cache", "ctx_viz", "env", "oauth-refresh", "debug-tool-call", "perf-issue",
  "onboarding", "autofix-pr", "init-verifiers", "agents-platform", "ant-trace",
  "version", "color", "mobile", "fast", "auto", "plan", "exit", "skills",
  "help", "compact", "clear", "config", "context", "branch", "statusline",
  "keybindings", "theme", "vim", "copy", "cost", "usage", "model", "btw",
  "stickers", "feedback", "upgrade", "update", "doctor", "stats", "status",
  "tag", "diff", "files", "memory", "mcp", "ide", "add-dir", "resume",
  "rename", "summary", "share", "export", "output-style", "permissions",
  "effort", "release-notes", "reload-plugins", "sandbox", "terminal-setup",
  "session", "pr-comments", "security-review", "commit", "commit-push-pr",
]);

type SlashMenuKind = "command" | "skill";
type SlashMenuItem = SlashCommand & { kind: SlashMenuKind };

function slashCommandKey(name: string): string {
  return name.trim().replace(/^\/+/, "").toLowerCase();
}

function slashCommandLabel(name: string): string {
  const value = name.replace(/[-_]+/g, " ").trim();
  if (!value) return name;
  return value.split(/\s+/).map((word) => word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word).join(" ");
}

function SlashCommandIcon({ name, kind }: { name: string; kind: SlashMenuKind }) {
  const iconProps = { size: 15, strokeWidth: 1.8, "aria-hidden": true } as const;
  if (kind === "skill") return <Box {...iconProps} />;
  const command = slashCommandKey(name);
  if (/new[-_:]?chat/.test(command)) return <CirclePlus {...iconProps} />;
  if (/continue|resume|fork/.test(command)) return <CornerDownRight {...iconProps} />;
  if (/compact|context/.test(command)) return <CircleDot {...iconProps} />;
  if (/fast|speed/.test(command)) return <Zap {...iconProps} />;
  if (/feedback|question|ask/.test(command)) return <MessageSquare {...iconProps} />;
  if (/goal|target/.test(command)) return <Target {...iconProps} />;
  if (/mcp|connector|link/.test(command)) return <Link2 {...iconProps} />;
  if (/model/.test(command)) return <Box {...iconProps} />;
  if (/pet|profile|account/.test(command)) return <UserCircle {...iconProps} />;
  if (/review|debug|bug|security|test/.test(command)) return <Bug {...iconProps} />;
  if (/plan|todo|task/.test(command)) return <ListChecks {...iconProps} />;
  if (/batch|parallel|agent/.test(command)) return <Boxes {...iconProps} />;
  if (/simplify|design|write|create/.test(command)) return <WandSparkles {...iconProps} />;
  if (/web|browser/.test(command)) return <Globe2 {...iconProps} />;
  if (/init|setup/.test(command)) return <FilePlus2 {...iconProps} />;
  if (/config|setting/.test(command)) return <Settings {...iconProps} />;
  return <Command {...iconProps} />;
}

function toModelOptions(models: EngineModel[]): SelectOption<string>[] {
  if (models.length === 0) return fallbackModelOptions;
  return models.map((model) => ({
    value: model.value === "default" ? "" : model.value,
    label: model.displayName,
    description: compactModelDescription(model),
    icon: <ModelLogo model={model.value === "default" ? model.displayName : model.value} />,
  }));
}

function compactModelDescription(model: EngineModel): string | undefined {
  if (model.value === "default" && !model.isCurrent) return "Use your signed-in provider’s recommended model";
  const firstLine = model.description?.replace(/\s+/g, " ").split(/[.!?](?:\s|$)/)[0]?.trim();
  if (!firstLine) return undefined;
  return firstLine.length > 62 ? `${firstLine.slice(0, 59).trimEnd()}…` : firstLine;
}

function formatUsagePercentage(utilization: number | null): string {
  if (utilization === null || !Number.isFinite(utilization)) return "—";
  return `${Math.round(Math.max(0, Math.min(100, utilization)))}% used`;
}

function isNotificationDay(timestamp: number, offset: number): boolean {
  const date = new Date(timestamp);
  const target = new Date();
  target.setDate(target.getDate() - offset);
  return date.toDateString() === target.toDateString();
}

function formatTimestamp(timestamp: number, format: TimestampFormat): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    ...(format === "12-hour" ? { hour12: true } : format === "24-hour" ? { hour12: false } : {}),
  });
}

function notificationTime(timestamp: number, format: TimestampFormat = "locale"): string {
  return formatTimestamp(timestamp, format);
}

function notificationDate(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function effortLabel(value: string): string {
  if (value === "xhigh") return "Extra High";
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : "Default";
}

type EffortTone = "default" | "low" | "medium" | "high" | "xhigh" | "max";

function effortTone(value: string | undefined): EffortTone {
  const normalized = value?.trim().toLowerCase().replace(/[-_\s]+/g, "") ?? "";
  if (normalized === "low") return "low";
  if (normalized === "medium" || normalized === "med") return "medium";
  if (normalized === "high") return "high";
  if (normalized === "xhigh" || normalized === "extrahigh" || normalized === "ultra") return "xhigh";
  if (normalized === "max" || normalized === "maximum") return "max";
  return "default";
}

function effortOptionsFor(model: EngineModel | undefined): SelectOption<string>[] {
  const configuredDefault = model?.activeEffort ? effortLabel(model.activeEffort) : model?.defaultEffort ? effortLabel(model.defaultEffort) : "model default";
  const defaultValue = model?.activeEffort ?? model?.defaultEffort ?? "";
  const options: SelectOption<string>[] = [{ value: defaultValue, label: defaultValue ? configuredDefault : "Default" }];
  for (const value of model?.supportedEffortLevels ?? []) {
    if (value === defaultValue || options.some((option) => option.value === value)) continue;
    options.push({ value, label: effortLabel(value) });
  }
  return options;
}

function terminalFontStack(value: string): string {
  const normalized = value.replace(/["';{}<>\n\r]/g, "").trim();
  if (!normalized) return "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  return normalized.includes(",") ? `${normalized}, monospace` : `"${normalized}", monospace`;
}

function playNotificationTone(): void {
  try {
    const AudioContextConstructor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    const context = new AudioContextConstructor();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(988, context.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.19);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Notification sound is best effort and must never affect a run.
  }
}

async function playNotificationSound(): Promise<void> {
  const played = await window.maximoDesktop.notifications.playSound().catch(() => false);
  if (!played) playNotificationTone();
}

type SelectOption<T extends string> = { value: T; label: string; description?: string; icon?: ReactNode };

function CustomSelect<T extends string>({ value, options, onChange, icon, disabled = false, className = "", placement = "bottom", ariaLabel }: {
  value: T; options: SelectOption<T>[]; onChange: (value: T) => void; icon?: ReactNode; disabled?: boolean; className?: string;
  placement?: "top" | "bottom"; ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value))), [value, options]);

  const move = (amount: number) => setActiveIndex((index) => (index + amount + options.length) % options.length);
  const choose = (option: SelectOption<T>) => { onChange(option.value); setOpen(false); };
  return (
    <div className={`custom-select ${placement} ${open ? "open" : ""} ${className}`} ref={rootRef}>
      <button type="button" className="custom-select-trigger" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) setOpen(true); move(event.key === "ArrowDown" ? 1 : -1); }
          if (event.key === "Escape") setOpen(false);
          if (open && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); choose(options[activeIndex]); }
        }}>
        {(selected?.icon ?? icon) ? <span className="select-option-icon">{selected?.icon ?? icon}</span> : null}
        <span className="select-option-label">{selected?.label ?? value}</span>
        <ChevronDown size={12} />
      </button>
      {open && <div className="custom-select-menu glass-panel" role="listbox" aria-label={ariaLabel}>
        {options.map((option, index) => <button type="button" role="option" aria-selected={option === selected} className={`${index === activeIndex ? "active " : ""}${option.icon ? "has-icon" : ""}`}
          key={`${option.value || "default"}-${option.label}-${index}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}>
          {option.icon && <span className="select-option-icon">{option.icon}</span>}
          <span className="select-option-copy"><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          <span className="select-check">{option === selected && <Check size={13} />}</span>
        </button>)}
      </div>}
    </div>
  );
}

function ModelControl({ model, effort, models, modelOptions, disabled, onModel, onEffort }: {
  model: string; effort: string; models: EngineModel[]; modelOptions: SelectOption<string>[]; disabled: boolean;
  onModel: (model: string) => void; onEffort: (effort: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"model" | "effort" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = modelOptions.find((option) => option.value === model) ?? modelOptions[0];
  const selectedModel = models.find((item) => (item.value === "default" ? "" : item.value) === model);
  const efforts = effortOptionsFor(selectedModel);
  const selectedEffort = efforts.find((option) => option.value === effort) ?? efforts[0];
  const selectedEffortTone = effortTone(effort || selectedModel?.activeEffort || selectedEffort?.value);
  const displayedEffort = selectedModel?.supportsEffort
    ? (effort ? effortLabel(effort) : selectedModel.activeEffort ? effortLabel(selectedModel.activeEffort) : selectedEffort?.label)
    : undefined;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setSubmenu(null); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    const onPicker = (event: Event) => {
      const detail = (event as CustomEvent<"model" | "effort">).detail;
      setOpen(true);
      setSubmenu(detail === "effort" && selectedModel?.supportsEffort ? "effort" : "model");
    };
    const onCycle = (event: Event) => {
      const direction = Number((event as CustomEvent<number>).detail) || 1;
      if (modelOptions.length === 0) return;
      const currentIndex = Math.max(0, modelOptions.findIndex((option) => option.value === model));
      const next = modelOptions[(currentIndex + direction + modelOptions.length) % modelOptions.length];
      if (!next) return;
      onModel(next.value);
      onEffort("");
    };
    window.addEventListener("maximo:model-picker", onPicker);
    window.addEventListener("maximo:model-cycle", onCycle);
    return () => {
      window.removeEventListener("maximo:model-picker", onPicker);
      window.removeEventListener("maximo:model-cycle", onCycle);
    };
  }, [model, modelOptions, onEffort, onModel, selectedModel?.supportsEffort]);
  const reset = () => { onModel(""); onEffort(""); setOpen(false); setSubmenu(null); };
  return <div className={`model-control effort-tone-${selectedEffortTone} ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="model-control-trigger" disabled={disabled} aria-label="Model and reasoning effort" aria-haspopup="menu" aria-expanded={open}
      onClick={() => { setOpen((value) => !value); setSubmenu(null); }}>
      {selected?.icon ?? <Bot size={13} />}<span>{selected?.label ?? "CLI default"}</span>{displayedEffort && <small>{displayedEffort}</small>}<ChevronDown size={11} />
    </button>
    {open && <div className="model-control-menu glass-panel" role="menu" onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setSubmenu(null); } }}>
      <button type="button" className={submenu === "model" ? "active" : ""} onClick={() => setSubmenu("model")}><span>Model</span><strong>{selected?.label}</strong><ChevronRight size={12} /></button>
      {selectedModel?.supportsEffort && <button type="button" className={submenu === "effort" ? "active" : ""} onClick={() => setSubmenu("effort")}><span>Effort</span><strong>{displayedEffort ?? selectedEffort?.label}</strong><ChevronRight size={12} /></button>}
      <div className="model-control-divider" />
      <button type="button" className="model-reset" onClick={reset}><span>Use active defaults</span><RefreshCw size={11} /></button>
      {submenu === "model" && <div className="model-submenu glass-panel" role="menu" aria-label="Models">
         {modelOptions.map((option) => <button type="button" className={`model-submenu-row${option === selected ? " selected" : ""}`} key={option.value || "default"} onClick={() => { onModel(option.value); onEffort(""); setSubmenu(null); }}>
           <span className="model-submenu-icon">{option.icon ?? <Bot size={12} />}</span><div><strong>{option.label}{option === selected && <Check size={11} className="model-submenu-check" />}</strong>{option.description && <small>{option.description}</small>}</div>
         </button>)}
      </div>}
      {submenu === "effort" && <div className="model-submenu effort-submenu glass-panel" role="menu" aria-label="Reasoning effort">
          <span className="menu-label">Effort</span>{efforts.map((option) => <button type="button" className={`effort-option effort-tone-${effortTone(option.value)}${option === selectedEffort ? " selected" : ""}`} key={option.value || "default"} onClick={() => { onEffort(option.value); setSubmenu(null); }}>
            <div><strong>{option.label}{option === selectedEffort && <Check size={12} />}</strong>{option.description && <small>{option.description}</small>}</div>
          </button>)}
      </div>}
    </div>}
  </div>;
}

function formatContextTokens(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.round(value));
}

function contextUsagePercent(usage: ContextUsage | null): number {
  if (!usage || !Number.isFinite(usage.percentage)) return 0;
  return Math.round(Math.max(0, Math.min(100, usage.percentage)));
}

function contextCategoryTone(name: string, index: number): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("free space")) return "free";
  if (normalized.includes("system prompt")) return "prompt";
  if (normalized.includes("tool") || normalized.includes("mcp")) return "tools";
  if (normalized.includes("memory") || normalized.includes("skill")) return "memory";
  if (normalized.includes("message")) return "messages";
  if (normalized.includes("compact") || normalized.includes("buffer")) return "buffer";
  return ["workspace", "messages", "memory", "tools"][index % 4] ?? "workspace";
}

function estimateThreadContextUsage(thread: Thread, models: EngineModel[], defaultModel: string): ContextUsage | null {
  if (thread.messages.length === 0) return null;
  const requestedModel = thread.model ?? defaultModel;
  const selectedModel = models.find((model) => (model.value === "default" ? "" : model.value) === requestedModel)
    ?? models.find((model) => model.isCurrent);
  const maxTokens = selectedModel?.contextWindow ?? 200_000;
  let characters = 0;
  const addText = (value: unknown) => {
    if (typeof value === "string") characters += value.length;
  };

  for (const message of thread.messages) {
    addText(message.content);
    for (const attachment of message.attachments ?? []) addText(`${attachment.name}${attachment.path}`);
    if (message.timeline?.length) {
      for (const item of message.timeline) {
        if (item.type === "activity") {
          addText(item.label);
          addText(item.detail);
          addText(item.data);
          addText(item.result);
        } else if (item.type === "user-context") {
          addText(item.text);
        }
      }
    } else {
      for (const item of message.activity ?? []) {
        addText(item.label);
        addText(item.detail);
        addText(item.data);
        addText(item.result);
      }
    }
  }

  const usedTokens = Math.min(maxTokens, Math.max(1, Math.ceil(characters / 4)));
  return {
    categories: [
      { name: "Saved conversation", tokens: usedTokens, color: "messages" },
      { name: "Free space", tokens: Math.max(0, maxTokens - usedTokens), color: "promptBorder" },
    ],
    totalTokens: usedTokens,
    maxTokens,
    rawMaxTokens: maxTokens,
    percentage: Math.round((usedTokens / maxTokens) * 100),
    model: selectedModel?.displayName ?? (requestedModel.trim() ? requestedModel.trim() : "Maximo Syntax"),
    estimated: true,
  };
}

function ContextUsageControl({ usage, loading, onRefresh }: { usage: ContextUsage | null; loading: boolean; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const used = contextUsagePercent(usage);
  const free = Math.max(0, 100 - used);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const show = () => {
    setOpen((value) => !value);
    if (!open) void onRefresh();
  };

  return <div className={`context-usage-control ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="context-usage-trigger" onClick={show} aria-label="Context window usage" aria-haspopup="dialog" aria-expanded={open}>
      <span className="context-usage-trigger-meter" style={{ "--context-used": `${used}%` } as CSSProperties}><i /></span>
      <span>{usage ? `${used}% used` : loading ? "Loading…" : "Context"}</span>
    </button>
    {open && <div className="context-usage-popover glass-panel" role="dialog" aria-label="Context window usage">
      <div className="context-usage-heading">
        <div><strong>Context window</strong><small>{usage?.estimated ? "Estimated from this saved chat" : "Everything sent with your next message"}</small></div>
        <span>{usage ? `${used}% used` : loading ? "Loading…" : "Unavailable"}</span>
      </div>
      {usage ? <>
        <div className="context-usage-total"><strong>{formatContextTokens(usage.totalTokens)} / {formatContextTokens(usage.rawMaxTokens || usage.maxTokens)} tokens</strong><b>{free}% free</b></div>
        <div className="context-usage-meter"><i style={{ width: `${used}%` }} /></div>
        <div className="context-usage-categories">
          {usage.categories.map((category, index) => {
            const categoryPercent = category.isDeferred ? null : Math.round((category.tokens / Math.max(1, usage.rawMaxTokens || usage.maxTokens)) * 100);
            return <div className="context-usage-category" key={`${category.name}-${index}`}>
              <span className={`context-category-dot ${contextCategoryTone(category.name, index)}`} />
              <span>{category.name}</span>
              <strong>{formatContextTokens(category.tokens)}</strong>
              <small>{categoryPercent === null ? "—" : `${categoryPercent}%`}</small>
            </div>;
          })}
        </div>
        {(usage.autoCompactThreshold !== undefined || usage.isAutoCompactEnabled !== undefined) && <div className="context-usage-note">
          <span>{usage.isAutoCompactEnabled ? "Auto-compacts before the context window is full" : "Manual compaction is available"}</span>
          {usage.autoCompactThreshold !== undefined && <small>Threshold {formatContextTokens(usage.autoCompactThreshold)}</small>}
        </div>}
        <div className="context-usage-foot"><span>{usage.model}</span><button type="button" onClick={() => void onRefresh()} disabled={loading} title="Refresh context usage" aria-label="Refresh context usage"><RefreshCw size={11} className={loading ? "spin" : ""} /></button></div>
      </> : <div className="context-usage-empty"><RefreshCw size={14} className={loading ? "spin" : ""} /><span>{loading ? "Reading the latest context from Syntax…" : "Context usage is available after the first model request."}</span></div>}
    </div>}
  </div>;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return compact ? (
    <span className="logo-mark" aria-label="Maximo AI"><img src={logoUrl} alt="" /></span>
  ) : <img className="full-logo" src={logoUrl} alt="Maximo AI" />;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function resolveProjectFile(projectPath: string, filePath: string): string {
  if (filePath.startsWith("/") || filePath.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(filePath)) return filePath;
  return `${projectPath.replace(/[\\/]+$/, "")}/${filePath.replace(/^[/\\]+/, "")}`;
}

function activityVerb(label: string): string {
  return label.replace(/^Using\s+/i, "Used ").replace(/^Running\s+/i, "Ran ");
}

type TimedInteraction = { interaction: ChatInteraction; createdAt: number };
type WorkTimelineEntry =
  | RunTimelineItem
  | { type: "interaction"; interaction: ChatInteraction; timestamp: number };

function isAgentActivity(item: RunActivity): boolean {
  return /^(?:agent|task)$/i.test(item.toolName?.trim() ?? "") || /(?:^|\s)(?:using|running)\s+(?:agent|task)\b/i.test(item.label);
}

function agentActivityInput(item: RunActivity): Record<string, unknown> | undefined {
  if (!item.data) return undefined;
  try {
    const value = JSON.parse(item.data);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function activityAgentMetadata(item: RunActivity): { description: string; agentType?: string } {
  const input = agentActivityInput(item);
  const description = [input?.description, item.detail].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "Sub-agent task";
  const agentType = [input?.subagent_type, input?.agent_type, input?.name].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
  return { description: description.slice(0, 500), ...(agentType ? { agentType: agentType.slice(0, 200) } : {}) };
}

function fallbackAgentFromActivity(item: RunActivity): AgentRun {
  const metadata = activityAgentMetadata(item);
  const finished = item.result !== undefined;
  return {
    taskId: item.toolUseId ?? `activity-${item.timestamp}`,
    ...(item.toolUseId ? { toolUseId: item.toolUseId } : {}),
    description: metadata.description,
    ...(metadata.agentType ? { agentType: metadata.agentType } : {}),
    status: item.isError ? "error" : finished ? "completed" : "running",
    ...(item.isError && item.result ? { error: item.result.slice(0, 2_000) } : {}),
    startedAt: item.timestamp,
    ...(finished ? { finishedAt: item.timestamp } : {}),
  };
}

type AgentTimelineRow = { agent: AgentRun; sourceIndex: number };

function mergeAgentActivity(agent: AgentRun, item: RunActivity): AgentRun {
  const fallback = fallbackAgentFromActivity(item);
  return {
    ...agent,
    description: agent.description === "Sub-agent task" ? fallback.description : agent.description,
    ...(agent.agentType || !fallback.agentType ? {} : { agentType: fallback.agentType }),
    ...(item.isError ? { status: "error" as const, ...(fallback.error ? { error: fallback.error } : {}) } : {}),
  };
}

function agentTimelineRows(entries: WorkTimelineEntry[]): AgentTimelineRow[] {
  const rows: AgentTimelineRow[] = [];
  const byToolUseId = new Map<string, AgentTimelineRow>();
  for (const [sourceIndex, entry] of entries.entries()) {
    if (entry.type !== "agent") continue;
    const row = { agent: entry.agent, sourceIndex };
    rows.push(row);
    if (entry.agent.toolUseId) byToolUseId.set(entry.agent.toolUseId, row);
  }

  const activities = entries.flatMap((entry, sourceIndex) => entry.type === "activity" && isAgentActivity(entry) ? [{ entry, sourceIndex }] : []);
  const used = new Set<string>();
  for (const { entry, sourceIndex } of activities) {
    const fallback = fallbackAgentFromActivity(entry);
    let row = entry.toolUseId ? byToolUseId.get(entry.toolUseId) : undefined;
    if (row && used.has(row.agent.taskId)) row = undefined;
    if (!row) {
      const metadata = activityAgentMetadata(entry);
      row = rows.find((candidate) => !used.has(candidate.agent.taskId) && (
        (metadata.agentType && candidate.agent.agentType === metadata.agentType)
        || candidate.agent.description === metadata.description
        || candidate.agent.description === "Sub-agent task"
      ));
    }
    if (!row) row = rows.find((candidate) => !used.has(candidate.agent.taskId));
    if (row) {
      row.agent = mergeAgentActivity(row.agent, entry);
      row.sourceIndex = Math.min(row.sourceIndex, sourceIndex);
      used.add(row.agent.taskId);
      if (entry.toolUseId) byToolUseId.set(entry.toolUseId, row);
      continue;
    }
    const fallbackRow = { agent: fallback, sourceIndex };
    rows.push(fallbackRow);
    if (fallback.toolUseId) byToolUseId.set(fallback.toolUseId, fallbackRow);
  }

  return [...new Map(rows.map((row) => [row.agent.taskId, row])).values()].sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function agentRunsFromEntries(entries: WorkTimelineEntry[]): AgentRun[] {
  return agentTimelineRows(entries).map((row) => row.agent);
}

const syntaxWorkPhrases = [
  "Thinking in Syntax",
  "Reading the room",
  "Warming up the codebase",
  "Following the breadcrumbs",
  "Untangling the logic",
  "Herding the imports",
  "Mapping the moving parts",
  "Polishing the rough edges",
  "Consulting the local wisdom",
  "Keeping the diff tidy",
  "Crossing the type-check bridge",
  "Listening to the test suite",
  "Counting braces so you don't have to",
  "Searching with purpose",
  "Giving bugs a gentle nudge",
  "Putting pieces in place",
  "Turning thoughts into tools",
  "Following the signal",
  "Making progress, not promises",
  "Checking the corners",
  "Watching the edge cases",
  "Refactoring with intent",
  "Negotiating with the compiler",
  "Finding the shortest path",
  "Sweeping up loose ends",
  "Turning red into green",
  "Keeping context warm",
  "Building the bridge",
  "Reading between the lines",
  "Checking the receipts",
  "Making the next edit count",
  "Letting tools do the talking",
  "Sharpening the solution",
  "Chasing down the why",
  "Threading the needle",
  "Keeping the worktree happy",
  "Making the code sing",
  "One careful step at a time",
  "Putting the pieces together",
  "Giving the syntax a stretch",
  "Making a little compile-y",
  "No bug left behind",
  "Diffing and thriving",
  "Branching out responsibly",
  "Testing the waters",
  "Querying the code oracle",
  "Turning bytes into breakthroughs",
  "Keeping tabs on the tabs",
  "Making the right kind of noise",
  "Syntax in motion",
] as const;

function liveWorkLabel(live: LiveRun | undefined, activeAgent: AgentRun | undefined): string {
  if (activeAgent) {
    if (activeAgent.lastToolName) return `Using ${activeAgent.lastToolName}`;
    if (activeAgent.agentType) return `Thinking with ${activeAgent.agentType}`;
    return "Thinking with a sub-agent";
  }
  const item = live?.activity.at(-1);
  if (!item) return "Thinking";
  const finished = item.result !== undefined || item.isError;
  if (/^using\s+/i.test(item.label) || /^running\s+/i.test(item.label)) return finished ? activityVerb(item.label) : item.label;
  return item.label;
}

function LiveWorkStatus({ running, waiting, live, inline = false, shimmer = true }: { running: boolean; waiting: boolean; live?: LiveRun; inline?: boolean; shimmer?: boolean }) {
  const activeAgent = agentRunsFromEntries(live?.timeline ?? []).find((agent) => agent.status === "running");
  const workLabel = liveWorkLabel(live, activeAgent);
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!running || !shimmer) {
      setPhraseIndex(0);
      return;
    }
    if (waiting) return;
    const timer = window.setInterval(() => setPhraseIndex((index) => (index + 1) % syntaxWorkPhrases.length), 2_600);
    return () => window.clearInterval(timer);
  }, [running, waiting, shimmer]);

  useEffect(() => {
    if (running && shimmer && !waiting) setPhraseIndex((index) => (index + 1) % syntaxWorkPhrases.length);
  }, [running, waiting, shimmer, workLabel]);

  if (!running) return null;
  return <div className={`${inline ? "inline-progress" : "run-progress-pill"} ${waiting ? "waiting" : ""}`} role="status" aria-live="polite">
    <i />
    <span className="live-work-status-copy">
      <strong className={waiting || !shimmer ? "" : "live-work-shimmer"}>{waiting ? "Waiting for your response" : workLabel}</strong>
      {!waiting && shimmer && <small className="live-work-shimmer">{syntaxWorkPhrases[phraseIndex]}</small>}
    </span>
  </div>;
}

function agentStatusLabel(status: AgentStatus): string {
  if (status === "running") return "Running";
  if (status === "completed") return "Completed";
  if (status === "error") return "Error";
  return "Stopped";
}

function AgentStatusIcon({ status }: { status: AgentStatus }) {
  if (status === "running") return <i className="agent-status-spinner" aria-label="Running" />;
  if (status === "completed") return <CheckCircle2 size={12} aria-label="Completed" />;
  if (status === "error") return <AlertCircle size={12} aria-label="Error" />;
  return <CircleStop size={12} aria-label="Stopped" />;
}

function AgentWorkTimeline({ work }: { work?: AgentWorkItem[] }) {
  if (!work?.length) return <div className="agent-work-empty">No intermediate work reported yet.</div>;
  return <div className="agent-work-timeline">
    {work.map((item, index) => item.type === "text" ? (
      <MarkdownContent className="agent-work-partial" key={`agent-text-${item.timestamp}-${index}`}>{item.text}</MarkdownContent>
    ) : (
      <details className={`agent-work-item ${item.isError ? "error" : ""}`} key={`agent-work-${item.toolUseId ?? item.timestamp}-${index}`}>
        <summary>
          <span className="agent-work-icon"><ToolIcon toolName={item.toolName} label={item.label} size={11} /></span>
          <span>{activityTitle(item)}</span>
          {item.detail && <small>{item.detail}</small>}
          <ChevronRight size={11} />
        </summary>
        {(item.result || item.data) && <div className="agent-work-detail">
          {item.result && <pre className={item.isError ? "error" : ""}>{item.result}</pre>}
          {item.data && <details className="tool-payload"><summary>Show input<ChevronRight size={10} /></summary><pre>{item.data}</pre></details>}
        </div>}
      </details>
    ))}
  </div>;
}

function mergeAgentWork(agent: AgentRun, work: AgentWorkItem): AgentRun {
  const workItems = [...(agent.work ?? [])];
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
  return { ...agent, work: workItems.slice(-100) };
}

function cloneLiveRun(run: LiveRun | undefined): LiveRun {
  const existing = run ?? { text: "", activity: [], timeline: [], logs: [] };
  return {
    ...existing,
    activity: [...existing.activity],
    timeline: existing.timeline.map((item) => ({ ...item })),
    logs: [...existing.logs],
  };
}

function reduceLiveRunEvents(current: Record<string, LiveRun>, events: readonly RunEvent[]): Record<string, LiveRun> {
  const next = { ...current };
  const runs = new Map<string, LiveRun>();
  for (const event of events) {
    if (event.type === "finished") continue;
    if (event.type === "turn-complete") {
      runs.delete(event.threadId);
      delete next[event.threadId];
      continue;
    }

    let run = runs.get(event.threadId);
    if (!run) {
      run = cloneLiveRun(next[event.threadId]);
      runs.set(event.threadId, run);
    }
    if (event.type === "started" || event.type === "turn-started") {
      run.text = "";
      run.activity = [];
      run.timeline = [];
      run.logs = [];
    }
    if (event.type === "text") {
      run.text = event.mode === "append" ? run.text + event.text : event.text;
      const last = run.timeline.at(-1);
      if (last?.type === "text") last.text = event.mode === "append" ? last.text + event.text : event.text;
      else run.timeline.push({ type: "text", text: event.text, timestamp: event.timestamp });
    }
    if (event.type === "activity") {
      const item: RunActivity = {
        label: event.label,
        detail: event.detail,
        data: event.data,
        ...(event.todos ? { todos: event.todos } : {}),
        ...(event.fileChange ? { fileChange: event.fileChange } : {}),
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        timestamp: event.timestamp,
      };
      run.activity.push(item);
      run.timeline.push({ type: "activity", ...item });
    }
    if (event.type === "agent-started") {
      const currentAgent = run.timeline.find((item): item is Extract<RunTimelineItem, { type: "agent" }> => item.type === "agent" && item.agent.taskId === event.taskId)?.agent;
      const agent: AgentRun = {
        ...(currentAgent ?? { taskId: event.taskId, status: "running", startedAt: event.timestamp }),
        ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
        description: event.description,
        ...(event.taskType ? { taskType: event.taskType } : {}),
        ...(event.agentType ? { agentType: event.agentType } : {}),
        status: "running",
      };
      if (currentAgent) run.timeline = run.timeline.map((item) => item.type === "agent" && item.agent.taskId === event.taskId ? { ...item, agent } : item);
      else run.timeline.push({ type: "agent", agent, timestamp: event.timestamp });
    }
    if (event.type === "agent-progress") {
      const currentAgent = run.timeline.find((item): item is Extract<RunTimelineItem, { type: "agent" }> => item.type === "agent" && item.agent.taskId === event.taskId)?.agent;
      const agent: AgentRun = {
        ...(currentAgent ?? { taskId: event.taskId, description: event.description ?? "Sub-agent task", status: "running", startedAt: event.timestamp }),
        ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
        ...(event.description ? { description: event.description } : {}),
        ...(event.lastToolName ? { lastToolName: event.lastToolName } : {}),
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.usage ? { usage: event.usage } : {}),
        status: "running",
      };
      if (currentAgent) run.timeline = run.timeline.map((item) => item.type === "agent" && item.agent.taskId === event.taskId ? { ...item, agent } : item);
      else run.timeline.push({ type: "agent", agent, timestamp: event.timestamp });
    }
    if (event.type === "agent-work") {
      const currentAgent = run.timeline.find((item): item is Extract<RunTimelineItem, { type: "agent" }> => item.type === "agent" && item.agent.taskId === event.taskId)?.agent;
      const agent = mergeAgentWork(currentAgent ?? { taskId: event.taskId, description: "Sub-agent task", status: "running", startedAt: event.timestamp }, event.work);
      if (currentAgent) run.timeline = run.timeline.map((item) => item.type === "agent" && item.agent.taskId === event.taskId ? { ...item, agent } : item);
      else run.timeline.push({ type: "agent", agent, timestamp: event.timestamp });
    }
    if (event.type === "agent-finished") {
      const currentAgent = run.timeline.find((item): item is Extract<RunTimelineItem, { type: "agent" }> => item.type === "agent" && item.agent.taskId === event.taskId)?.agent;
      const agent: AgentRun = {
        ...(currentAgent ?? { taskId: event.taskId, description: "Sub-agent task", startedAt: event.timestamp }),
        ...(event.toolUseId ? { toolUseId: event.toolUseId } : {}),
        status: event.status,
        ...(event.summary ? { summary: event.summary } : {}),
        ...(event.error ? { error: event.error } : {}),
        ...(event.outputFile ? { outputFile: event.outputFile } : {}),
        ...(event.usage ? { usage: event.usage } : {}),
        finishedAt: event.timestamp,
      };
      if (currentAgent) run.timeline = run.timeline.map((item) => item.type === "agent" && item.agent.taskId === event.taskId ? { ...item, agent } : item);
      else run.timeline.push({ type: "agent", agent, timestamp: event.timestamp });
    }
    if (event.type === "status" && event.status === null) {
      run.activity = run.activity.filter((item) => item.label.trim().toLowerCase() !== "compacting");
      run.timeline = run.timeline.filter((item) => !(item.type === "activity" && item.label.trim().toLowerCase() === "compacting"));
    }
    if (event.type === "activity-result") {
      run.activity = run.activity.map((item) => item.toolUseId === event.toolUseId ? {
        ...item,
        result: event.result,
        isError: event.isError,
        ...(event.fileChange ? { fileChange: event.fileChange } : {}),
        ...(event.classifierDecision ? { classifierDecision: event.classifierDecision } : {}),
      } : item);
      run.timeline = run.timeline.map((item) => item.type === "activity" && item.toolUseId === event.toolUseId ? {
        ...item,
        result: event.result,
        isError: event.isError,
        ...(event.fileChange ? { fileChange: event.fileChange } : {}),
        ...(event.classifierDecision ? { classifierDecision: event.classifierDecision } : {}),
      } : item);
    }
    if (event.type === "classifier-decision") {
      const decision = {
        decision: event.decision,
        ...(event.classifier ? { classifier: event.classifier } : {}),
        ...(event.reason ? { reason: event.reason } : {}),
      };
      run.activity = run.activity.map((item) => item.toolUseId === event.toolUseId ? { ...item, classifierDecision: decision } : item);
      run.timeline = run.timeline.map((item) => item.type === "activity" && item.toolUseId === event.toolUseId ? { ...item, classifierDecision: decision } : item);
    }
    if (event.type === "log") run.logs.push({ level: event.level, text: event.text, timestamp: event.timestamp });
  }

  for (const [threadId, run] of runs) {
    run.activity = run.activity.slice(-MAX_LIVE_ACTIVITY_ITEMS);
    run.timeline = run.timeline.slice(-MAX_LIVE_TIMELINE_ITEMS);
    run.logs = run.logs.slice(-MAX_LIVE_LOG_ITEMS);
    next[threadId] = run;
  }
  return next;
}

function AgentTimelineEvent({ agent }: { agent: AgentRun }) {
  // Keep closed rows cheap: sub-agent work can include large nested tool I/O + markdown.
  const [expanded, setExpanded] = useState(false);
  const name = agent.agentType || "Sub-agent";
  const progress = agent.status === "running" ? (agent.lastToolName ? `Running ${agent.lastToolName}` : "Running") : agentStatusLabel(agent.status);
  return <details className={`work-event agent-event ${agent.status}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="work-event-icon"><AgentStatusIcon status={agent.status} /></span>
      <span title={agent.description}>{name}</span>
      <small>{progress}</small>
      <ChevronRight size={12} />
    </summary>
    {expanded && <div className="work-event-detail agent-event-detail">
      <span>{agent.description}</span>
      <AgentWorkTimeline work={agent.work} />
      {agent.summary && agent.summary !== agent.description && <small>{agent.summary}</small>}
      {agent.error && <pre className="error">{agent.error}</pre>}
      {agent.outputFile && <code title={agent.outputFile}>Output: {agent.outputFile}</code>}
      {agent.usage && <small>{[agent.usage.toolUses !== undefined ? `${agent.usage.toolUses} tool uses` : "", agent.usage.durationMs ? formatDuration(agent.usage.durationMs) : ""].filter(Boolean).join(" · ")}</small>}
    </div>}
  </details>;
}

const MemoizedAgentTimelineEvent = memo(AgentTimelineEvent);

function AgentStatusList({ agents }: { agents: AgentRun[] }) {
  if (agents.length === 0) return null;
  const running = agents.filter((agent) => agent.status === "running").length;
  return <div className="agent-status-panel" aria-label="Sub-agent status">
    <div className="agent-status-heading"><span><Users size={12} />Sub-agents</span><small>{running > 0 ? `${running} running` : `${agents.length} total`}</small></div>
    <div className="agent-status-list">
      {agents.slice(-6).map((agent) => <div className={`agent-status-row ${agent.status}`} key={agent.taskId}>
        <span className="agent-status-icon"><AgentStatusIcon status={agent.status} /></span>
        <span className="agent-status-copy"><strong title={agent.agentType || "Sub-agent"}>{agent.agentType || "Sub-agent"}</strong><small title={agent.description}>{agent.description}</small></span>
        <small className="agent-status-label">{agentStatusLabel(agent.status)}</small>
      </div>)}
    </div>
  </div>;
}

type QueuedFollowUp = {
  id: string;
  prompt: string;
  attachments: Attachment[];
  model: string;
  effort: string;
  permission: PermissionMode;
};

function activityFilePath(item: RunActivity): string | undefined {
  if (item.data) {
    try {
      const value = JSON.parse(item.data) as Record<string, unknown>;
      for (const key of ["file_path", "path", "notebook_path"]) if (typeof value[key] === "string") return value[key];
    } catch { /* use the summarized detail */ }
  }
  if (!item.detail) return undefined;
  const tool = (item.toolName ?? item.label).toLowerCase();
  if (tool === "write") return item.detail;
  return /(?:Edit|Read|Notebook|Patch)/i.test(tool) ? item.detail : undefined;
}

function shortPath(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function activityTitle(item: RunActivity): string {
  const tool = (item.toolName ?? "").toLowerCase();
  const path = activityFilePath(item);
  if (path && tool === "write") return `Created ${shortPath(path)}`;
  if (path && /edit|notebook|patch/.test(tool)) return `Edited ${shortPath(path)}`;
  if (path && tool === "read") return `Read ${shortPath(path)}`;
  if (tool === "bash") return "Ran command";
  if (/grep|glob|search/.test(tool)) return "Searched project";
  if (tool === "askuserquestion") return "Asked user";
  return activityVerb(item.label);
}

function ToolIcon({ toolName, label, size = 12 }: { toolName?: string; label?: string; size?: number }) {
  const tool = `${toolName ?? ""} ${label ?? ""}`.toLowerCase();
  const iconProps = { size, "aria-hidden": true } as const;

  if (/ask.?user|question|elicitation/.test(tool)) return <CircleHelp {...iconProps} />;
  if (/mcp|plugin|connector/.test(tool)) return <Plug {...iconProps} />;
  if (/web.?search|web.?fetch|web.?browser|browser|url/.test(tool)) return <Globe2 {...iconProps} />;
  if (/grep|glob|search|find|tool.?search/.test(tool)) return <FileSearch {...iconProps} />;
  if (/write/.test(tool)) return <FilePlus2 {...iconProps} />;
  if (/multi.?edit|edit|patch|notebook/.test(tool)) return <FilePenLine {...iconProps} />;
  if (/send.?user.?file|attach/.test(tool)) return <Paperclip {...iconProps} />;
  if (/read|open|file/.test(tool)) return <FileText {...iconProps} />;
  if (/bash|shell|terminal|command|kill.?shell|repl/.test(tool)) return <TerminalSquare {...iconProps} />;
  if (/todo/.test(tool)) return <ListTodo {...iconProps} />;
  if (/task|plan/.test(tool)) return <ListChecks {...iconProps} />;
  if (/peer|team|send.?message|message/.test(tool)) return <Users {...iconProps} />;
  if (/agent/.test(tool)) return <Bot {...iconProps} />;
  if (/skill/.test(tool)) return <Sparkles {...iconProps} />;
  if (/lsp|code|test|compile/.test(tool)) return <CodeXml {...iconProps} />;
  if (/git|branch|commit|push|pull.?request/.test(tool)) return <GitBranch {...iconProps} />;
  if (/cron|schedule|sleep/.test(tool)) return <Clock3 {...iconProps} />;
  if (/workflow/.test(tool)) return <Workflow {...iconProps} />;
  if (/monitor|usage|rate.?limit/.test(tool)) return <Gauge {...iconProps} />;
  if (/notification|notify/.test(tool)) return <Bell {...iconProps} />;
  if (/config|setting/.test(tool)) return <Settings {...iconProps} />;
  if (/brief|summary/.test(tool)) return <FileText {...iconProps} />;
  return <Wrench {...iconProps} />;
}

function interactionToolName(interaction: ChatInteraction): string {
  return interaction.type === "ask-user" ? "AskUserQuestion" : interaction.toolName;
}

function mergeWorkTimeline(timeline: RunTimelineItem[], interactions: TimedInteraction[]): WorkTimelineEntry[] {
  const entries: WorkTimelineEntry[] = [];
  const inserted = new Set<number>();
  const activityByToolUseId = new Map<string, number>();
  const interactionByToolUseId = new Map<string, number>();
  const unkeyedInteractionsByName = new Map<string, number[]>();
  interactions.forEach((item, index) => {
    const toolUseId = item.interaction.toolUseId;
    if (toolUseId) {
      if (!interactionByToolUseId.has(toolUseId)) interactionByToolUseId.set(toolUseId, index);
      return;
    }
    const name = interactionToolName(item.interaction).toLowerCase();
    const candidates = unkeyedInteractionsByName.get(name);
    if (candidates) candidates.push(index);
    else unkeyedInteractionsByName.set(name, [index]);
  });
  for (const timelineItem of timeline) {
    if (timelineItem.type === "activity") {
      const directIndex = timelineItem.toolUseId ? interactionByToolUseId.get(timelineItem.toolUseId) ?? -1 : -1;
      let fallbackIndex = directIndex;
      if (fallbackIndex < 0) {
        const candidates = unkeyedInteractionsByName.get((timelineItem.toolName ?? "").toLowerCase()) ?? [];
        fallbackIndex = candidates.find((index) => {
          const item = interactions[index];
          return item !== undefined && !inserted.has(index) && item.createdAt >= timelineItem.timestamp;
        }) ?? -1;
      }
      if (fallbackIndex >= 0) {
        if (!inserted.has(fallbackIndex)) entries.push({ type: "interaction", interaction: interactions[fallbackIndex].interaction, timestamp: timelineItem.timestamp });
        inserted.add(fallbackIndex);
        continue;
      }
      if (timelineItem.toolUseId && activityByToolUseId.has(timelineItem.toolUseId)) {
        const existingIndex = activityByToolUseId.get(timelineItem.toolUseId)!;
        const existing = entries[existingIndex];
        if (existing?.type === "activity") {
            entries[existingIndex] = {
              ...existing,
              result: timelineItem.result ?? existing.result,
              isError: timelineItem.isError ?? existing.isError,
              fileChange: timelineItem.fileChange ?? existing.fileChange,
              classifierDecision: timelineItem.classifierDecision ?? existing.classifierDecision,
            };
        }
        continue;
      }
      if (timelineItem.toolUseId) activityByToolUseId.set(timelineItem.toolUseId, entries.length);
    }
    entries.push({ ...timelineItem });
  }
  interactions.forEach((item, index) => {
    if (!inserted.has(index)) entries.push({ type: "interaction", interaction: item.interaction, timestamp: item.createdAt });
  });
  return entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.timestamp - b.entry.timestamp || a.index - b.index).map(({ entry }) => entry);
}

function todoStatusIcon(status: TodoItem["status"]): ReactNode {
  if (status === "completed") return <Check size={11} />;
  if (status === "in_progress") return <i className="todo-status-dot active" />;
  return <i className="todo-status-dot" />;
}

function TodoTimelineEvent({ todos, data }: { todos: TodoItem[]; data?: string }) {
  const [expanded, setExpanded] = useState(false);
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const active = todos.find((todo) => todo.status === "in_progress");
  return <details className="work-event todo-event" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span className="work-event-icon"><ListTodo size={12} /></span><span>Task checklist</span><small>{completed}/{todos.length} complete{active ? ` · ${active.content}` : ""}</small><ChevronRight size={12} /></summary>
    {expanded && <div className="work-event-detail todo-list-detail">
      {todos.map((todo, index) => <div className={`todo-item ${todo.status}`} key={todo.id ?? `${todo.content}-${index}`}><span className="todo-item-status">{todoStatusIcon(todo.status)}</span><span>{todo.content}</span></div>)}
      {data && <details className="tool-payload"><summary>Show input<ChevronRight size={11} /></summary><pre>{data}</pre></details>}
    </div>}
  </details>;
}

const MemoizedTodoTimelineEvent = memo(TodoTimelineEvent);

function UserContextTimelineEvent({ entry, onPreviewAttachment }: { entry: Extract<RunTimelineItem, { type: "user-context" }>; onPreviewAttachment?: (attachment: Attachment) => void }) {
  return <div className="work-user-context">
    <span className="work-user-context-label">Added context</span>
    <div className="work-user-context-bubble">
      {entry.attachments?.length && onPreviewAttachment ? <AttachmentList attachments={entry.attachments} onPreview={onPreviewAttachment} className="work-user-context-attachments" /> : null}
      <MarkdownContent>{entry.text}</MarkdownContent>
      <time>{new Date(entry.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
    </div>
  </div>;
}

const MemoizedUserContextTimelineEvent = memo(UserContextTimelineEvent);

function followUpContextItem(message: ChatMessage): Extract<RunTimelineItem, { type: "user-context" }> {
  return {
    type: "user-context",
    text: message.content,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    timestamp: message.createdAt,
  };
}

function classifierBadgeLabel(decision: NonNullable<RunActivity["classifierDecision"]>): string {
  const allowed = decision.decision === "allowed";
  if (decision.classifier === "bash" || decision.classifier === "bash_allow") {
    return allowed
      ? (decision.reason ? `auto-approved · ${decision.reason}` : "auto-approved")
      : "classifier denied";
  }
  return allowed ? "classifier allowed" : "classifier denied";
}

function ClassifierBadge({ decision }: { decision: NonNullable<RunActivity["classifierDecision"]> }) {
  const allowed = decision.decision === "allowed";
  return <span className={`classifier-badge ${allowed ? "allowed" : "denied"}`} title={decision.reason || (allowed ? "Allowed by auto mode classifier" : "Denied by auto mode classifier")}>
    {allowed ? <Check size={9} /> : <X size={9} />}
    {classifierBadgeLabel(decision)}
  </span>;
}

function InteractionTimelineEvent({ interaction }: { interaction: ChatInteraction }) {
  const [expanded, setExpanded] = useState(false);
  if (interaction.type === "permission") {
    const approved = interaction.decision === "approved";
    return <details className={`work-event interaction-event ${approved ? "approved" : "denied"}`} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><span className="work-event-icon">{approved ? <Check size={12} /> : <X size={12} />}</span><span>{approved ? "Approved" : "Denied"} {interaction.toolName}</span>{interaction.detail && <small>{interaction.detail}</small>}<ChevronRight size={12} /></summary>
      {expanded && <div className="work-event-detail"><span>{approved ? "Permission granted" : "Permission denied"}{interaction.remember ? " for matching actions" : " for this action"}.</span>{interaction.detail && <code>{interaction.detail}</code>}</div>}
    </details>;
  }
  const first = interaction.questions[0];
  const answer = first?.answer ?? "Answered";
  return <details className="work-event interaction-event answered" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span className="work-event-icon"><Check size={12} /></span><span>{interaction.questions.length > 1 ? `${interaction.questions.length} questions answered` : "Answered user question"}</span><small>{answer}</small><ChevronRight size={12} /></summary>
    {expanded && <div className="work-event-detail interaction-answers">{interaction.questions.map((item, index) => <div key={`${item.question}-${index}`}>{item.header && <b>{item.header}</b>}<span>{item.question}</span><strong>{item.answer}</strong></div>)}</div>}
  </details>;
}

const MemoizedInteractionTimelineEvent = memo(InteractionTimelineEvent);

function ActivityTimelineEvent({ entry, path, created, reviewable, change, project, onOpenFile }: {
  entry: Extract<RunTimelineItem, { type: "activity" }>;
  path?: string;
  created: boolean;
  reviewable: boolean;
  change?: FileChange;
  project?: Project;
  onOpenFile?: (path: string, diff?: GitDiff) => void;
}) {
  const [loadedDiff, setLoadedDiff] = useState<GitDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const knownChange = reviewable ? entry.fileChange ?? change : undefined;
  const diff = reviewable ? (knownChange ? { path: knownChange.path, patch: knownChange.patch } : loadedDiff) : null;

  useEffect(() => {
    setLoadedDiff(null);
    setLoadingDiff(false);
    setDiffError(null);
  }, [path, project?.id]);

  const loadDiff = () => {
    if (!reviewable || knownChange || loadedDiff || loadingDiff || !project || !path) return;
    setLoadingDiff(true);
    setDiffError(null);
    void window.maximoDesktop.gitDiff(project.id, relativeProjectPath(project.path, path)).then(setLoadedDiff).catch((error) => {
      setDiffError(error instanceof Error ? error.message : "Unable to read the file diff.");
    }).finally(() => setLoadingDiff(false));
  };

  const stats = knownChange ?? (diff ? patchStats(diff.patch) : { additions: 0, deletions: 0 });
  const additions = diff?.patch ? stats.additions : 0;
  const deletions = diff?.patch ? stats.deletions : 0;
  const showDiff = Boolean(diff?.patch.trim());
  const reviewDiff = diff ? { path: diff.path, patch: diff.patch } : undefined;
  const diffPath = path && project ? relativeProjectPath(project.path, path) : path;

  // Only mount result/diff/input DOM when this row is opened — closed rows are just a summary line.
  const [expanded, setExpanded] = useState(false);

  return <details className={`work-event ${created ? "created" : ""} ${entry.isError ? "error" : ""} ${entry.classifierDecision ? `classifier-${entry.classifierDecision.decision}` : ""}`} onToggle={(event) => {
    const next = event.currentTarget.open;
    setExpanded(next);
    if (next) loadDiff();
  }}>
    <summary>
      <span className="work-event-icon"><ToolIcon toolName={entry.toolName} label={entry.label} /></span>
      <span>{activityTitle(entry)}</span>
      {entry.classifierDecision && <ClassifierBadge decision={entry.classifierDecision} />}
      {entry.detail && <small>{entry.detail}</small>}
      {diff && <span className="work-event-diff-count"><b>+{additions}</b><i>-{deletions}</i></span>}
      <ChevronRight size={12} />
    </summary>
    {expanded && <div className="work-event-detail">
      {entry.classifierDecision && (
        <span className={`classifier-note ${entry.classifierDecision.decision}`}>
          {entry.classifierDecision.decision === "allowed" ? "Allowed by auto mode classifier" : "Denied by auto mode classifier"}
          {entry.classifierDecision.reason ? ` · ${entry.classifierDecision.reason}` : ""}
        </span>
      )}
      {/* Full classifier denial text is long model guidance — keep UI compact when we already show the reason. */}
      {entry.result && !(entry.classifierDecision?.decision === "denied" && entry.result.startsWith("Permission for this action has been denied")) && (
        <pre className={entry.isError ? "error" : ""}>{entry.result}</pre>
      )}
      {reviewable && path && onOpenFile && <>
        <button type="button" className="review-work-file" onClick={() => onOpenFile(path, reviewDiff)}><FileCode2 size={12} />{created ? "Review new file" : "Review changes"}<ChevronRight size={11} /></button>
        {loadingDiff && <div className="work-event-diff-status"><RefreshCw size={12} className="spin" />Reading code diff…</div>}
        {diffError && <div className="work-event-diff-status error">{diffError}</div>}
        {diff && !showDiff && !loadingDiff && <div className="work-event-diff-status"><FileCode2 size={12} />No textual diff is available for this file.</div>}
        {diff && showDiff && <div className="work-event-diff" aria-label={`Code diff for ${path}`}>
          <div className="work-event-diff-header"><span title={diffPath}><FileCode2 size={12} />{diffPath}</span><span className="work-event-diff-count"><b>+{additions}</b><i>-{deletions}</i></span></div>
          <DiffCode patch={diff.patch} className="work-diff-code" showMetadata={false} showHunks={false} />
        </div>}
      </>}
      {entry.data && <details className="tool-payload"><summary>Show input<ChevronRight size={11} /></summary><pre>{entry.data}</pre></details>}
      {!entry.result && !entry.data && entry.detail && <code>{entry.detail}</code>}
    </div>}
  </details>;
}

const MemoizedActivityTimelineEvent = memo(ActivityTimelineEvent);

function WorkTimeline({ entries, onOpenFile, fileChanges, project, onPreviewAttachment }: { entries: WorkTimelineEntry[]; onOpenFile?: (path: string, diff?: GitDiff) => void; fileChanges?: FileChange[]; project?: Project; onPreviewAttachment?: (attachment: Attachment) => void }) {
  const agentRows = useMemo(() => agentTimelineRows(entries), [entries]);
  const rowsBySource = useMemo(() => {
    const map = new Map<number, AgentTimelineRow[]>();
    for (const row of agentRows) map.set(row.sourceIndex, [...(map.get(row.sourceIndex) ?? []), row]);
    return map;
  }, [agentRows]);
  const renderEntry = (entry: WorkTimelineEntry, index: number): ReactNode => {
    const assignedAgents = rowsBySource.get(index);
    if (assignedAgents?.length) return <>{assignedAgents.map((row) => <MemoizedAgentTimelineEvent agent={row.agent} key={`agent-${row.agent.taskId}`} />)}</>;
    if (entry.type === "text") return <MarkdownContent className="work-partial" key={`text-${entry.timestamp}-${index}`}>{entry.text}</MarkdownContent>;
    if (entry.type === "interaction") return <MemoizedInteractionTimelineEvent interaction={entry.interaction} key={`interaction-${entry.timestamp}-${index}`} />;
    if (entry.type === "agent" || (entry.type === "activity" && isAgentActivity(entry))) return null;
    if (entry.type === "user-context") return <MemoizedUserContextTimelineEvent entry={entry} onPreviewAttachment={onPreviewAttachment} key={`context-${entry.timestamp}-${index}`} />;
    const path = activityFilePath(entry);
    const created = (entry.toolName ?? "").toLowerCase() === "write";
    const reviewable = Boolean(path && /edit|write|notebook|patch/i.test(entry.toolName ?? entry.label));
    const change = reviewable && path ? matchingFileChange(fileChanges, project, path) : undefined;
    if (entry.todos?.length) return <MemoizedTodoTimelineEvent todos={entry.todos} data={entry.data} key={`todo-${entry.timestamp}-${index}`} />;
    return <MemoizedActivityTimelineEvent entry={entry} path={path} created={created} reviewable={reviewable} change={change} project={project} onOpenFile={onOpenFile} key={`activity-${entry.timestamp}-${index}`} />;
  };
  return <div className="work-timeline">{entries.map(renderEntry)}</div>;
}

// Small first paint so expanding "Worked for" feels instant; more rows stream in after.
const INITIAL_WORK_ENTRIES = 12;
const WORK_ENTRIES_PER_FRAME = 24;
const MAX_VISIBLE_LIVE_WORK_ENTRIES = 64;

function WorkDisclosure({ timeline, interactions = [], durationMs, live = false, finalContent, onOpenFile, fileChanges, project, onPreviewAttachment }: { timeline?: RunTimelineItem[]; interactions?: TimedInteraction[]; durationMs?: number; live?: boolean; finalContent?: string; onOpenFile?: (path: string, diff?: GitDiff) => void; fileChanges?: FileChange[]; project?: Project; onPreviewAttachment?: (attachment: Attachment) => void }) {
  const [open, setOpen] = useState(false);
  // Defer mounting the body one frame so the chevron/open state paints immediately.
  const [bodyReady, setBodyReady] = useState(false);
  const [renderedEntryCount, setRenderedEntryCount] = useState(INITIAL_WORK_ENTRIES);
  const entries = useMemo(() => mergeWorkTimeline(timeline ?? [], interactions), [timeline, interactions]);
  const normalizedFinal = finalContent?.trim();
  const workEntries = useMemo(() => entries.filter((entry) => entry.type !== "text" || !normalizedFinal || entry.text.trim() !== normalizedFinal), [entries, normalizedFinal]);

  useEffect(() => {
    if (!open) {
      setBodyReady(false);
      setRenderedEntryCount(INITIAL_WORK_ENTRIES);
      return;
    }
    // Yield so the summary toggle paints before we mount timeline nodes.
    const frame = window.requestAnimationFrame(() => setBodyReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !bodyReady) return;
    if (renderedEntryCount >= workEntries.length) return;
    const frame = window.requestAnimationFrame(() => {
      startTransition(() => {
        setRenderedEntryCount((count) => Math.min(workEntries.length, count + WORK_ENTRIES_PER_FRAME));
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, bodyReady, renderedEntryCount, workEntries.length]);

  if (live) {
    const visibleLiveEntries = entries.length > MAX_VISIBLE_LIVE_WORK_ENTRIES ? entries.slice(-MAX_VISIBLE_LIVE_WORK_ENTRIES) : entries;
    return visibleLiveEntries.length > 0 ? <div className="agent-flow live-agent-flow"><WorkTimeline entries={visibleLiveEntries} onOpenFile={onOpenFile} fileChanges={fileChanges} project={project} onPreviewAttachment={onPreviewAttachment} /></div> : null;
  }
  if (!durationMs && workEntries.length === 0) return null;
  const visibleWorkEntries = workEntries.slice(0, renderedEntryCount);
  return <div className="agent-flow"><details className="worked-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span>Worked for {formatDuration(durationMs ?? 0)}</span><ChevronRight size={13} /></summary>
    {open && (workEntries.length > 0 ? (
      bodyReady ? <>
        <WorkTimeline entries={visibleWorkEntries} onOpenFile={onOpenFile} fileChanges={fileChanges} project={project} onPreviewAttachment={onPreviewAttachment} />
        {visibleWorkEntries.length < workEntries.length && <div className="work-timeline-loading" role="status">Loading more work details…</div>}
      </> : <div className="work-timeline-loading" role="status">Loading work details…</div>
    ) : <div className="work-timeline-empty">No intermediate actions were reported.</div>)}
  </details></div>;
}

const MemoizedWorkDisclosure = memo(WorkDisclosure);

function relativeProjectPath(projectPath: string, filePath: string): string {
  const root = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const candidate = filePath.replace(/\\/g, "/");
  return candidate.startsWith(`${root}/`) ? candidate.slice(root.length + 1) : candidate.replace(/^\.\//, "");
}

function matchingFileChange(fileChanges: FileChange[] | undefined, project: Project | undefined, filePath: string): FileChange | undefined {
  if (!fileChanges?.length) return undefined;
  const target = project ? relativeProjectPath(project.path, filePath) : filePath.replace(/\\/g, "/");
  return fileChanges.find((change) => (project ? relativeProjectPath(project.path, change.path) : change.path.replace(/\\/g, "/")) === target);
}

function TurnFileChanges({ timeline, fileChanges, project, git, onOpenFile }: { timeline?: RunTimelineItem[]; fileChanges?: FileChange[]; project?: Project; git?: GitStatus | null; onOpenFile: (path: string, diff?: GitDiff) => void }) {
  if (!project) return null;
  const recordedChanges = (fileChanges ?? []).map((change) => ({ ...change, path: relativeProjectPath(project.path, change.path) }));
  const timelinePaths = (timeline ?? []).flatMap((item) => {
    if (item.type !== "activity" || !/edit|write|notebook|patch/i.test(item.toolName ?? item.label)) return [];
    const path = activityFilePath(item);
    return path ? [{ path, tool: item.toolName ?? "" }] : [];
  });
  const paths = recordedChanges.length > 0 ? [...new Set(recordedChanges.map((change) => change.path))] : [...new Set(timelinePaths.map((item) => relativeProjectPath(project.path, item.path)))];
  if (paths.length === 0) return null;
  const counts = paths.reduce((total, path) => {
    const change = recordedChanges.find((item) => item.path === path);
    const gitFile = git?.files.find((file) => file.path.replace(/\\/g, "/") === path);
    return { additions: total.additions + (change?.additions ?? gitFile?.additions ?? 0), deletions: total.deletions + (change?.deletions ?? gitFile?.deletions ?? 0) };
  }, { additions: 0, deletions: 0 });
  const createdCount = timelinePaths.filter((item) => (item.tool || "").toLowerCase() === "write" && recordedChanges.length === 0).length;
  const headerLabel = createdCount === paths.length ? "Created" : "Edited";
  return <div className="turn-file-changes">
    <div className="turn-file-changes-header"><span><FileCode2 size={13} />{headerLabel} {paths.length} file{paths.length === 1 ? "" : "s"}</span>{(counts.additions > 0 || counts.deletions > 0) && <span className="turn-file-count"><b>+{counts.additions}</b> <i>-{counts.deletions}</i></span>}</div>
    {paths.map((path) => {
    const change = recordedChanges.find((item) => item.path === path);
    const changed = git?.files.find((file) => file.path.replace(/\\/g, "/") === path);
    const created = recordedChanges.length === 0 && timelinePaths.some((item) => (item.tool || "").toLowerCase() === "write" && relativeProjectPath(project.path, item.path) === path);
    return <div className={`turn-file-change ${created ? "created" : ""}`} key={path}>
      <span className="turn-file-icon"><FileCode2 size={14} /></span>
      <span><strong>{created ? "Created" : "Edited"} {shortPath(path)}</strong><small>{path}</small></span>
      {(change || changed) && <span className="turn-file-count"><b>+{change?.additions ?? changed?.additions ?? 0}</b> <i>-{change?.deletions ?? changed?.deletions ?? 0}</i></span>}
      <button type="button" onClick={() => onOpenFile(path, change ? { path: change.path, patch: change.patch } : undefined)}>{created ? "Review new file" : "Review"}</button>
    </div>;
  })}</div>;
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }
}

function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <button type="button" className="message-copy" onClick={() => void copy()} data-tooltip={copied ? "Copied" : "Copy message"} aria-label={copied ? "Copied" : "Copy message"}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>;
}

type AttachmentPreviewState = {
  attachment: Attachment;
  preview: AttachmentPreview | null;
  loading: boolean;
  error?: string;
};

const MAX_ATTACHMENT_THUMBNAIL_SIZE = 8 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1_024) return `${Math.max(0, bytes || 0)} B`;
  if (bytes < 1_024 * 1_024) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(bytes >= 10 * 1_024 * 1_024 ? 0 : 1)} MB`;
}

function attachmentKindForName(name: string): AttachmentPreviewKind {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"].includes(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (["aac", "flac", "m4a", "mp3", "oga", "ogg", "wav"].includes(extension)) return "audio";
  if (["3gp", "m4v", "mov", "mp4", "ogv", "webm"].includes(extension)) return "video";
  if (["c", "cc", "conf", "cpp", "css", "csv", "env", "go", "h", "hpp", "htm", "html", "ini", "java", "js", "jsx", "json", "less", "log", "markdown", "md", "mjs", "mts", "py", "rs", "sass", "scss", "sh", "sql", "toml", "ts", "tsx", "txt", "vue", "xml", "yaml", "yml", "zsh"].includes(extension)) return "text";
  return "unsupported";
}

function attachmentKindLabel(kind: AttachmentPreviewKind): string {
  if (kind === "image") return "Image";
  if (kind === "pdf") return "PDF";
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  if (kind === "text") return "Text";
  return "File";
}

function AttachmentGlyph({ kind }: { kind: AttachmentPreviewKind }) {
  if (kind === "image") return <FileImage size={18} />;
  if (kind === "audio") return <FileAudio size={18} />;
  if (kind === "video") return <FileVideo size={18} />;
  if (kind === "text") return <FileCode2 size={18} />;
  if (kind === "pdf") return <FileText size={18} />;
  return <File size={18} />;
}

function AttachmentCard({ attachment, onPreview, onRemove, compact = false }: {
  attachment: Attachment;
  onPreview: (attachment: Attachment) => void;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const kind = attachmentKindForName(attachment.name);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setThumbnail(null);
    if (kind !== "image" || attachment.size > MAX_ATTACHMENT_THUMBNAIL_SIZE) return () => { active = false; };
     void window.maximoDesktop.previewAttachment(attachment.path, true).then((preview) => {
      if (active) setThumbnail(preview?.dataUrl ?? null);
    }).catch(() => {
      if (active) setThumbnail(null);
    });
    return () => { active = false; };
  }, [attachment.path, kind]);
  return (
    <div className={`attachment-card-shell ${onRemove ? "removable" : ""}`}>
      <button type="button" className={`attachment-card ${compact ? "compact" : ""}`} onClick={() => onPreview(attachment)} title={`Preview ${attachment.name}`}>
        <span className={`attachment-thumbnail ${thumbnail ? "has-image" : ""}`}>
          {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <AttachmentGlyph kind={kind} />}
        </span>
        <span className="attachment-card-copy"><strong title={attachment.name}>{attachment.name}</strong><small>{attachmentKindLabel(kind)} · {formatFileSize(attachment.size)}</small></span>
        <ChevronRight size={13} className="attachment-card-chevron" />
      </button>
      {onRemove && <button type="button" className="attachment-remove" onClick={(event) => { event.stopPropagation(); onRemove(); }} aria-label={`Remove ${attachment.name}`} title={`Remove ${attachment.name}`}><X size={12} /></button>}
    </div>
  );
}

function AttachmentList({ attachments, onPreview, onRemove, className = "" }: {
  attachments: Attachment[];
  onPreview: (attachment: Attachment) => void;
  onRemove?: (attachment: Attachment) => void;
  className?: string;
}) {
  return <div className={`attachment-list ${className}`}>{attachments.map((attachment) => <AttachmentCard key={attachment.path} attachment={attachment} onPreview={onPreview} onRemove={onRemove ? () => onRemove(attachment) : undefined} compact />)}</div>;
}

function AttachmentPreviewModal({ state, theme, onClose }: { state: AttachmentPreviewState; theme: ThemeMode; onClose: () => void }) {
  const [openError, setOpenError] = useState<string | null>(null);
  const { attachment, preview, loading } = state;
  const kind = preview?.kind ?? attachmentKindForName(attachment.name);
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const openFile = async () => {
    const error = await window.maximoDesktop.openPath(attachment.path);
    if (error) setOpenError(error);
    else onClose();
  };
  const content = loading ? <div className="attachment-preview-loading"><RefreshCw size={21} className="spin" /><span>Preparing preview…</span></div>
    : preview?.dataUrl && kind === "image" ? <img className="attachment-preview-image" src={preview.dataUrl} alt={attachment.name} />
    : preview?.dataUrl && kind === "pdf" ? <iframe className="attachment-preview-pdf" src={preview.dataUrl} title={`Preview of ${attachment.name}`} />
    : preview?.dataUrl && kind === "video" ? <video className="attachment-preview-video" src={preview.dataUrl} controls autoPlay={false} />
    : preview?.dataUrl && kind === "audio" ? <audio className="attachment-preview-audio" src={preview.dataUrl} controls />
    : preview?.text !== undefined ? <pre className="attachment-preview-text">{preview.text}</pre>
    : <div className="attachment-preview-unavailable"><AttachmentGlyph kind={kind} /><strong>Preview unavailable</strong><p>{state.error ?? preview?.reason ?? "The original file could not be read."}</p></div>;
  return createPortal(
    <div className={`attachment-preview-backdrop theme-${theme}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="attachment-preview-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title">
        <header className="attachment-preview-header">
          <span className="attachment-preview-title-icon"><AttachmentGlyph kind={kind} /></span>
          <div><strong id="attachment-preview-title" title={attachment.name}>{attachment.name}</strong><small>{attachmentKindLabel(kind)} · {formatFileSize(attachment.size)}</small></div>
          <button type="button" onClick={onClose} aria-label="Close preview" title="Close preview"><X size={17} /></button>
        </header>
        <div className={`attachment-preview-stage kind-${kind}`}>{content}</div>
        <footer className="attachment-preview-footer">
          <span>{preview?.truncated ? "Preview truncated" : preview?.mimeType ?? "Local attachment"}</span>
          <div>{openError && <small className="attachment-preview-error">{openError}</small>}<button type="button" onClick={() => void window.maximoDesktop.revealPath(attachment.path)}>Show in Files</button><button type="button" className="primary-button compact" onClick={() => void openFile()}>Open file</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function SetupGate({ status, onRetry, onContinue }: { status: EngineStatus | null; onRetry: () => void; onContinue: () => void }) {
  const phase = status?.phase ?? "checking";
  const [copied, setCopied] = useState(false);
  const installCommand = "npm install -g @maximoai/maximo-syntax-cli";
  const copyInstallCommand = async () => {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };
  return (
    <main className="setup-shell">
      <section className="setup-card glass-panel">
        <Logo />
        <div className="eyebrow">MAXIMO SYNTAX DESKTOP</div>
        <h1>{phase === "ready" ? "Your AI workspace is ready" : phase === "error" ? "CLI setup needs attention" : "Preparing your workspace"}</h1>
        <p>{status?.message ?? "Checking for the Maximo Syntax CLI…"}</p>
        <div className={`engine-progress ${phase}`}>
          <span className="engine-progress-icon">
            {phase === "ready" ? <Check size={16} /> : phase === "error" ? <AlertCircle size={16} /> : <RefreshCw size={16} className="spin" />}
          </span>
          <span>
            <strong>{phase === "checking" ? "Checking CLI" : phase === "installing" ? "Installing CLI" : phase === "ready" ? `CLI ${status?.version ?? "installed"}` : "Setup paused"}</strong>
            <small>{phase === "ready" ? "Included with the desktop app. No terminal setup required." : phase === "error" ? "Retry automatic repair or use one of the recovery options below." : "This normally takes less than a minute."}</small>
          </span>
        </div>
        {phase === "error" && <div className="setup-recovery">
          <div className="recovery-option"><span>1</span><div><strong>Recommended: reinstall the desktop app</strong><small>Download and reinstall Maximo Syntax Desktop. The installer includes the CLI, so no separate CLI installation is required.</small></div></div>
          <div className="recovery-option"><span>2</span><div><strong>Or install the CLI with npm</strong><small>If Node.js and npm are already installed, open Terminal in any folder and run:</small></div></div>
          <div className="install-command"><code>{installCommand}</code><button type="button" onClick={() => void copyInstallCommand()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button></div>
          <p>When installation finishes, return here and select <b>Retry setup</b>.</p>
        </div>}
        {phase === "ready" ? (
          <button className="primary-button" onClick={onContinue}>Open Maximo Syntax <ArrowUp size={15} /></button>
        ) : phase === "error" ? (
          <button className="primary-button" onClick={onRetry}><RefreshCw size={15} /> Retry setup</button>
        ) : <div className="setup-note">You can keep this window open while setup completes.</div>}
      </section>
    </main>
  );
}

/**
 * Full-stage signed-out experience. 2026 pattern: focused auth gate before the
 * workspace shell (not a full fake-logged-in app with dead controls).
 */
function SignInGate({
  theme,
  busy,
  onLogin,
  onCancelLogin,
  onRefresh,
}: {
  theme: ThemeMode;
  busy: boolean;
   onLogin: (method: LoginMethod, apiKey?: string, openCodePlan?: OpenCodePlan) => Promise<boolean>;
  onCancelLogin: () => void;
  onRefresh: () => void;
}) {
  const [method, setMethod] = useState<LoginMethod>("maximoai");
  const [apiKey, setApiKey] = useState("");
  const [openCodePlan, setOpenCodePlan] = useState<OpenCodePlan>("zen");
  const [step, setStep] = useState<"methods" | "details">("methods");
  const selected = loginMethodOptions.find((option) => option.value === method) ?? loginMethodOptions[0];
  const canSubmit = !busy && (!selected.needsKey || apiKey.trim().length > 0);

  const submitLogin = async () => {
    if (!canSubmit) return;
    const ok = await onLogin(method, selected.needsKey ? apiKey.trim() : undefined, method === "opencode" ? openCodePlan : undefined);
    if (ok) setApiKey("");
  };

  return (
    <main className={`setup-shell signin-gate theme-${theme}`}>
      <section className="signin-gate-card glass-panel">
        <div className="signin-gate-brand">
          <Logo />
          <div className="eyebrow">MAXIMO SYNTAX</div>
          <h1>Sign in to start working</h1>
           <p>Connect Maximo AI, MyTabulon, Cencori, OpenRouter, or OpenCode to use models and agent runs. Your workspace stays local on this Mac.</p>
        </div>

        <div className="signin-gate-body">
          {step === "methods" ? (
            <>
              <div className="signin-gate-section-label">Choose a sign-in method</div>
              <div className="signin-method-list signin-gate-methods" role="radiogroup" aria-label="Sign-in method">
                {loginMethodOptions.map((option) => (
                  <label key={option.value} className={`signin-method ${method === option.value ? "active" : ""}`}>
                    <input
                      type="radio"
                      name="gate-signin-method"
                      value={option.value}
                      checked={method === option.value}
                      disabled={busy}
                      onChange={() => {
                        setMethod(option.value);
                        setApiKey("");
                        if (option.value !== "opencode") setOpenCodePlan("zen");
                      }}
                    />
                    <span className="signin-method-indicator" aria-hidden="true" />
                    <span className="signin-method-copy">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                    {option.needsKey ? <span className="signin-method-badge">API key</span> : <span className="signin-method-badge browser">Browser</span>}
                  </label>
                ))}
              </div>
              <div className="signin-nav signin-gate-nav">
                <button type="button" className="secondary-button" onClick={onRefresh} disabled={busy} title="Refresh account status">
                  <RefreshCw size={13} className={busy ? "spin" : ""} /> Check again
                </button>
                <button
                  type="button"
                  className="primary-button compact"
                  disabled={busy}
                  onClick={() => setStep("details")}
                >
                  Continue <ArrowRight size={13} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="signin-method-chip">
                <strong>{selected.label}</strong>
                <small>{selected.description}</small>
              </div>
              {selected.needsKey ? (
                <div className="signin-key-panel">
                  {selected.value === "opencode" && <OpenCodePlanPicker plan={openCodePlan} onChange={setOpenCodePlan} disabled={busy} />}
                  <label htmlFor="gate-signin-api-key">API key</label>
                  <input
                    id="gate-signin-api-key"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    value={apiKey}
                    disabled={busy}
                    placeholder={selected.placeholder}
                    onChange={(event) => setApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canSubmit) {
                        event.preventDefault();
                        void submitLogin();
                      }
                    }}
                  />
                  {selected.helpUrl && (
                    <a
                      className="signin-help-link"
                      href={selected.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        void window.maximoDesktop.openPath(selected.helpUrl!);
                      }}
                    >
                      {selected.helpLabel}
                    </a>
                  )}
                </div>
              ) : (
                <div className="signin-browser-panel">
                  <div className="signin-browser-icon" aria-hidden="true"><Globe2 size={18} /></div>
                  <p className="signin-browser-hint">
                    {busy
                      ? "Waiting for browser sign-in… finish authorization in your browser, then return here."
                      : selected.browserHint}
                  </p>
                </div>
              )}
              <div className="signin-nav signin-gate-nav">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (busy) onCancelLogin();
                    else {
                      setApiKey("");
                      setStep("methods");
                    }
                  }}
                >
                  {busy ? "Cancel" : "Back"}
                </button>
                <button type="button" className="primary-button compact" disabled={!canSubmit} onClick={() => void submitLogin()}>
                  {busy ? <RefreshCw size={13} className="spin" /> : selected.needsKey ? <UserRound size={13} /> : <Globe2 size={13} />}
                  {busy
                    ? (selected.needsKey ? "Signing in…" : "Waiting for browser…")
                    : selected.needsKey
                      ? "Sign in with API key"
                      : "Continue in browser"}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="signin-gate-capabilities" aria-hidden="true">
          <span><Code2 size={13} /> Code and software</span>
          <span><FileText size={13} /> Documents and files</span>
          <span><WandSparkles size={13} /> Research and automation</span>
          <span><ShieldCheck size={13} /> Permission controls</span>
        </div>
        <p className="signin-gate-footnote">Credentials stay on this computer for Maximo Syntax CLI and Desktop (shared ~/.maximo.json).</p>
      </section>
    </main>
  );
}

function AccountLoadingGate({ theme }: { theme: ThemeMode }) {
  return (
    <main className={`setup-shell theme-${theme}`}>
      <section className="setup-card glass-panel account-loading-card">
        <Logo />
        <div className="eyebrow">MAXIMO SYNTAX</div>
        <h1>Checking your account</h1>
         <p>Looking for a signed-in Maximo AI, MyTabulon, Cencori, OpenRouter, or OpenCode session…</p>
        <div className="engine-progress checking">
          <span className="engine-progress-icon"><RefreshCw size={16} className="spin" /></span>
          <span><strong>Reading local credentials</strong><small>This only takes a moment.</small></span>
        </div>
      </section>
    </main>
  );
}



function Sidebar({ state, currentThread, account, timestampFormat, activeSurface, onNavigateSurface, onOpenProject, onCreateProject, onNewThread, onSelectProject, onSelectThread, onOpenSearch, onToggleSidebar, onBack, onForward, canGoBack, canGoForward, onSettings, onAccount, onUsage, onLogout, onMarkThreadRead, onMarkAllNotificationsRead, onDeleteThread, onRenameThread, onToggleThreadPinned, onArchiveThread, onRenameProject, onToggleProjectPinned, onArchiveProjectThreads, onRemoveProject, onReorderProject, onSelectSpace, onCreateSpace, onResize, open, onClose, updateState, onUpdateAction }: {
  state: AppState; currentThread?: Thread; onOpenProject: () => void; onCreateProject: () => void;
  account: AccountStatus | null;
  timestampFormat: TimestampFormat;
  activeSurface: WorkspaceSurface; onNavigateSurface: (surface: WorkspaceSurface) => void;
  onNewThread: (projectId?: string) => void; onSelectProject: (id: string) => void; onSelectThread: (id: string, surface?: WorkspaceSurface) => void; onOpenSearch: () => void; onToggleSidebar: () => void; onBack: () => void; onForward: () => void; canGoBack: boolean; canGoForward: boolean; onSettings: () => void; onAccount: () => void; onUsage: () => void; onLogout: () => void;
  onMarkThreadRead: (id: string) => void; onMarkAllNotificationsRead: () => void;
  onDeleteThread: (id: string) => void; onRenameThread: (id: string) => void; onToggleThreadPinned: (id: string) => void; onArchiveThread: (id: string) => void;
  onRenameProject: (id: string) => void; onToggleProjectPinned: (id: string) => void; onArchiveProjectThreads: (id: string) => void; onRemoveProject: (id: string) => void;
  onReorderProject?: (sourceId: string, targetId: string) => void;
  onSelectSpace: (spaceId: string | null) => void;
  onCreateSpace: (name: string, icon: SpaceIconName) => Promise<Space>;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  open: boolean; onClose: () => void;
  updateState: AppUpdateState | null;
  onUpdateAction: () => void;
}) {
  const selectedProjectId = currentThread?.projectId ?? state.selectedProjectId;
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(selectedProjectId ? [selectedProjectId] : []));
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set(["pinned", "recent", "projects"]));
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [projectMenu, setProjectMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [threadMenu, setThreadMenu] = useState<{ id: string; top: number; left: number } | null>(null);
  const [hoverCard, setHoverCard] = useState<{ kind: "project" | "thread"; id: string; top: number; left: number } | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | null>(null);
  const [spaceEditorOpen, setSpaceEditorOpen] = useState(false);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const suppressProjectClickRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selectedProjectId) return;
    setExpandedProjects((current) => current.has(selectedProjectId) ? current : new Set([...current, selectedProjectId]));
  }, [selectedProjectId]);
  useEffect(() => {
    if (activeSurface !== "activity") setNotificationsOpen(false);
  }, [activeSurface]);
  useEffect(() => {
    if (!projectMenu && !threadMenu && !accountMenuOpen && !notificationsOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Element | null;
       if (target?.closest(".notifications-view, .notifications-bell-btn, .project-more, .thread-actions, .sidebar-footer, .project-context-popover, .thread-context-popover, .sidebar-hover-card")) return;
      setProjectMenu(null);
      setThreadMenu(null);
      setAccountMenuOpen(false);
      setNotificationsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [accountMenuOpen, notificationsOpen, projectMenu, threadMenu]);
  const cancelHoverCardClose = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };
  const closeHoverCard = () => {
    cancelHoverCardClose();
    setHoverCard(null);
  };
  const scheduleHoverCardClose = () => {
    cancelHoverCardClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      setHoverCard(null);
    }, 90);
  };
  const showHoverCard = (kind: "project" | "thread", id: string, element: HTMLElement) => {
    cancelHoverCardClose();
    const rect = element.getBoundingClientRect();
    const cardWidth = 256;
    const cardHeight = kind === "project" ? 172 : 154;
    const sidebarRight = sidebarRef.current?.getBoundingClientRect().right ?? rect.right;
    const rightSideLeft = sidebarRight - 2;
    const left = rightSideLeft + cardWidth <= window.innerWidth - 8
      ? rightSideLeft
      : Math.max(8, sidebarRight - cardWidth + 2);
    const top = Math.max(8, Math.min(rect.top, Math.max(8, window.innerHeight - cardHeight - 8)));
    setHoverCard({ kind, id, top, left });
  };
  useEffect(() => () => cancelHoverCardClose(), []);
  const toggleProject = (projectId: string) => setExpandedProjects((current) => {
    const next = new Set(current);
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
    return next;
  });
  const toggleSection = (section: string) => setExpandedSections((current) => {
    const next = new Set(current);
    if (next.has(section)) next.delete(section); else next.add(section);
    return next;
  });
  const openProjectMenu = (event: ReactMouseEvent<HTMLButtonElement>, projectId: string) => {
    event.stopPropagation();
    closeHoverCard();
    const rect = event.currentTarget.getBoundingClientRect();
    setThreadMenu(null);
    const menuHeight = 302;
    const topBelow = rect.bottom + 5;
    const top = topBelow + menuHeight <= window.innerHeight - 8 ? topBelow : Math.max(8, rect.top - menuHeight - 5);
    const left = Math.max(8, Math.min(rect.right - 72, window.innerWidth - 270));
    setProjectMenu({ id: projectId, top, left });
  };
  const openThreadMenu = (event: ReactMouseEvent<HTMLButtonElement>, threadId: string) => {
    event.stopPropagation();
    closeHoverCard();
    const rect = event.currentTarget.getBoundingClientRect();
    setProjectMenu(null);
     const menuHeight = 190;
    const topBelow = rect.bottom + 4;
    const top = topBelow + menuHeight <= window.innerHeight - 8 ? topBelow : Math.max(8, rect.top - menuHeight - 4);
    const left = Math.max(8, Math.min(rect.right - 72, window.innerWidth - 228));
    setThreadMenu({ id: threadId, top, left });
  };
  const activeSpaceId = state.selectedSpaceId ?? null;
  const projects = [...state.projects]
    .filter((project) => (project.spaceId ?? null) === activeSpaceId)
    .sort((left, right) => {
      const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      if (pinned !== 0) return pinned;
      if (state.settings.sidebarProjectSortOrder === "updated_at") return right.lastOpenedAt - left.lastOpenedAt;
      if (state.settings.sidebarProjectSortOrder === "created_at") return right.createdAt - left.createdAt;
      return 0;
    });
  const visibleProjectIds = new Set(projects.map((project) => project.id));
  const sentThreads = state.threads
    .filter((thread) => thread.messages.length > 0 && !thread.archived && visibleProjectIds.has(thread.projectId))
    .sort((left, right) => {
      const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      if (pinned !== 0) return pinned;
      return state.settings.sidebarThreadSortOrder === "created_at" ? right.createdAt - left.createdAt : right.updatedAt - left.updatedAt;
    });
  const pinnedThreads = sentThreads.filter((thread) => thread.pinned).slice(0, 6);
  const recentThreads = sentThreads.filter((thread) => !thread.pinned);
  const visibleRecentThreads = showAllRecent ? recentThreads : recentThreads.slice(0, 8);
  const activeProjectMenu = projectMenu ? state.projects.find((project) => project.id === projectMenu.id) : undefined;
  const activeThreadMenu = threadMenu ? state.threads.find((thread) => thread.id === threadMenu.id) : undefined;

  const activeRunningThreads = state.threads.filter((t) => !t.archived && t.messages.length > 0 && t.status === "running");
  const unreadThreads = state.threads.filter((t) => !t.archived && t.messages.length > 0 && t.unread && t.status !== "running");
  const totalAttentionCount = activeRunningThreads.length + unreadThreads.length;
  const priorityThreads = [...activeRunningThreads, ...unreadThreads.filter((thread) => thread.status === "error" || thread.status === "cancelled")]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const unreadCompletedThreads = unreadThreads
    .filter((thread) => !priorityThreads.some((priorityThread) => priorityThread.id === thread.id))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const todayUnreadThreads = unreadCompletedThreads.filter((thread) => isNotificationDay(thread.updatedAt, 0));
  const yesterdayUnreadThreads = unreadCompletedThreads.filter((thread) => isNotificationDay(thread.updatedAt, 1));
  const earlierUnreadThreads = unreadCompletedThreads.filter((thread) => !isNotificationDay(thread.updatedAt, 0) && !isNotificationDay(thread.updatedAt, 1));

  const handleProjectDragStart = (event: ReactDragEvent<HTMLButtonElement>, projectId: string) => {
    cancelHoverCardClose();
    closeHoverCard();
    setProjectMenu(null);
    setThreadMenu(null);
    setDraggingProjectId(projectId);
    setDropTargetProjectId(null);
    suppressProjectClickRef.current = true;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-maximo-project", projectId);
  };
  const handleProjectDragOver = (event: ReactDragEvent<HTMLDivElement>, projectId: string) => {
    if (!draggingProjectId || draggingProjectId === projectId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dropTargetProjectId !== projectId) setDropTargetProjectId(projectId);
  };
  const handleProjectDrop = (event: ReactDragEvent<HTMLDivElement>, projectId: string) => {
    if (!draggingProjectId) return;
    event.preventDefault();
    const sourceId = draggingProjectId;
    setDraggingProjectId(null);
    setDropTargetProjectId(null);
    if (sourceId !== projectId) onReorderProject?.(sourceId, projectId);
  };
  const handleProjectDragEnd = () => {
    setDraggingProjectId(null);
    setDropTargetProjectId(null);
    window.setTimeout(() => { suppressProjectClickRef.current = false; }, 0);
  };
  const renderThread = (thread: Thread) => <div className={`thread-row ${currentThread?.id === thread.id ? "active" : ""} ${thread.status === "running" ? "running" : ""} ${thread.unread ? "unread" : ""}`} key={thread.id}
    onMouseEnter={(event) => showHoverCard("thread", thread.id, event.currentTarget)}
    onMouseLeave={scheduleHoverCardClose}
    onFocus={(event) => showHoverCard("thread", thread.id, event.currentTarget)}
    onBlur={scheduleHoverCardClose}>
    <button className="thread-select" onClick={() => { onSelectThread(thread.id); onClose(); }}>
      <span>{thread.title}</span>
      {thread.pinned && <Pin size={10} />}
      {thread.status === "running" && <span className="status-dot running" title="Chat is running" aria-label="Chat is running" />}
      {thread.status !== "running" && thread.unread && <span className="status-dot unread" title="Chat is done (unread)" aria-label="Chat is done (unread)" />}
      {thread.status === "error" && !thread.unread && <span className="status-dot error" title="Chat has an error" aria-label="Chat has an error" />}
    </button>
    <button className="thread-actions" title="Chat options" onClick={(event) => openThreadMenu(event, thread.id)}><MoreHorizontal size={14} /></button>
  </div>;
  const renderNotification = (thread: Thread) => {
    const project = state.projects.find((project) => project.id === thread.projectId);
    const isRunning = thread.status === "running";
    const isError = thread.status === "error" || thread.status === "cancelled";
    const statusLabel = isRunning ? "Working now" : isError ? (thread.status === "cancelled" ? "Stopped" : "Needs attention") : "Done · Unread";
    return (
      <button
        key={thread.id}
        type="button"
        className={`notification-item ${isRunning ? "running" : isError ? "error" : "unread"}`}
        onClick={() => {
          onSelectThread(thread.id);
          setNotificationsOpen(false);
        }}
      >
        <span className={`status-dot ${isRunning ? "running" : isError ? "error" : "unread"}`} title={statusLabel} aria-label={statusLabel} />
        <span className="notification-item-content">
          <strong className="notification-item-title">{thread.title}</strong>
          <small className="notification-item-sub">{project ? project.name : "Workspace"} · {statusLabel}</small>
        </span>
        <time className="notification-item-time">{isRunning || isNotificationDay(thread.updatedAt, 0) ? notificationTime(thread.updatedAt, timestampFormat) : notificationDate(thread.updatedAt)}</time>
        <ChevronRight size={13} className="notification-item-arrow" />
      </button>
    );
  };
  const primaryNav = (
    <nav className="sidebar-primary-nav" aria-label="Workspace views">
      <button type="button" className={activeSurface === "activity" ? "active" : ""} aria-label={activeSurface === "activity" ? "Switch to classic view" : "Switch to activity view"} aria-pressed={activeSurface === "activity"} title={activeSurface === "activity" ? "Switch to classic view" : "Switch to activity view"} onClick={() => { setNotificationsOpen(false); onNavigateSurface(activeSurface === "activity" ? "chat" : "activity"); }}><ActivityIcon size={15} /><span>Activity</span></button>
      <button type="button" className={activeSurface === "kanban" ? "active" : ""} onClick={() => { setNotificationsOpen(false); onNavigateSurface("kanban"); }}><Columns3 size={15} /><span>Kanban</span></button>
      <button type="button" className={activeSurface === "pull-requests" ? "active" : ""} onClick={() => { setNotificationsOpen(false); onNavigateSurface("pull-requests"); }}><GitPullRequest size={15} /><span>Pull requests</span></button>
    </nav>
  );
  const spaceStrip = state.spaces.length > 0 ? (
    <section className="sidebar-space-section" aria-label="Spaces">
      <div className="sidebar-space-heading"><span>Spaces</span><button type="button" onClick={() => setSpaceEditorOpen(true)} title="Create space" aria-label="Create space"><Plus size={13} /></button></div>
      <div className="sidebar-space-list">
        <button type="button" className={activeSpaceId === null ? "active" : ""} onClick={() => onSelectSpace(null)}><SpaceIcon icon="cloud" size={14} /><span>Void</span></button>
        {state.spaces.map((space) => <button type="button" className={activeSpaceId === space.id ? "active" : ""} key={space.id} onClick={() => onSelectSpace(space.id)} title={space.name}><SpaceIcon icon={space.icon} size={14} /><span>{space.name}</span></button>)}
      </div>
    </section>
  ) : null;
  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`} ref={sidebarRef}>
        <div className="sidebar-nav drag-region">
          <button className="sidebar-nav-button no-drag" onClick={onToggleSidebar} title="Toggle sidebar"><PanelLeft size={15} /></button>
          <button className="sidebar-nav-button no-drag" onClick={onBack} disabled={!canGoBack} title="Back"><ArrowLeft size={15} /></button>
          <button className="sidebar-nav-button no-drag" onClick={onForward} disabled={!canGoForward} title="Forward"><ArrowRight size={15} /></button>
          <span />
        </div>
        <div className="sidebar-identity-row">
          <button className="sidebar-brand drag-region no-drag" onClick={() => { setNotificationsOpen(false); onAccount(); }} title="Account and workspace"><span className="sidebar-brand-logo"><Logo compact /></span><span><strong>Maximo</strong><small>Syntax</small></span></button>
          <div className="sidebar-identity-actions">
            <button className="sidebar-nav-button no-drag" onClick={() => { setNotificationsOpen(false); onOpenSearch(); }} title="Search chats"><Search size={16} /></button>
            <button
              className={`sidebar-nav-button notifications-bell-btn no-drag ${notificationsOpen ? "active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setProjectMenu(null);
                setThreadMenu(null);
                setAccountMenuOpen(false);
                setNotificationsOpen((val) => !val);
              }}
              title="Notifications"
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
            >
              <Bell size={15} />
              {totalAttentionCount > 0 && <span className={`nav-bell-badge ${unreadThreads.length > 0 ? "has-unread" : "has-active"}`} />}
            </button>
          </div>
        </div>
        <div className="sidebar-actions">
          <button className="new-task" onClick={() => { setNotificationsOpen(false); onNavigateSurface("chat"); onNewThread(state.selectedProjectId); }}><SquarePen size={16} /> New chat <kbd>⌘N</kbd></button>
        </div>
        {notificationsOpen ? (
          <div className="sidebar-scroll sidebar-notifications-scroll">
            {primaryNav}
            {spaceStrip}
            <div className="notifications-view" aria-label="Notifications">
              <div className="notifications-view-scroll">
              <section className="notifications-section">
                <div className="notifications-section-header">
                  <span>Priority</span>
                  {unreadThreads.length > 0 && <button type="button" className="notifications-clear-all" onClick={(event) => { event.stopPropagation(); onMarkAllNotificationsRead(); }}>Mark all read</button>}
                </div>
                {priorityThreads.length > 0 ? <div className="notifications-list">{priorityThreads.map(renderNotification)}</div> : <div className="notifications-empty"><CheckCircle2 size={17} className="notifications-empty-icon" /><span>Nothing needs attention</span></div>}
              </section>
              {todayUnreadThreads.length > 0 && <section className="notifications-section"><div className="notifications-section-label">Today</div><div className="notifications-list">{todayUnreadThreads.map(renderNotification)}</div></section>}
              {yesterdayUnreadThreads.length > 0 && <section className="notifications-section"><div className="notifications-section-label">Yesterday</div><div className="notifications-list">{yesterdayUnreadThreads.map(renderNotification)}</div></section>}
              {earlierUnreadThreads.length > 0 && <section className="notifications-section"><div className="notifications-section-label">Earlier</div><div className="notifications-list">{earlierUnreadThreads.map(renderNotification)}</div></section>}
              </div>
            </div>
          </div>
        ) : activeSurface === "activity" ? (
          <div className="sidebar-scroll activity-sidebar-scroll">{primaryNav}{spaceStrip}<ActivitySidebar state={state} activeThreadId={currentThread?.id} onOpenThread={(id) => onSelectThread(id, "activity")} onMarkThreadRead={onMarkThreadRead} onToggleThreadPinned={onToggleThreadPinned} onNewThread={() => { onNavigateSurface("chat"); onNewThread(state.selectedProjectId); }} onAddProject={onCreateProject} /></div>
        ) : (
          <div className="sidebar-scroll">
            {primaryNav}
            {spaceStrip}
            {pinnedThreads.length > 0 && <div className="sidebar-chat-section"><div className="section-label"><button type="button" className="section-toggle" onClick={() => toggleSection("pinned")} aria-expanded={expandedSections.has("pinned")} aria-controls="sidebar-pinned"><span>Pinned</span><ChevronDown size={12} /></button></div>{expandedSections.has("pinned") && <div className="thread-list global-thread-list" id="sidebar-pinned">{pinnedThreads.map(renderThread)}</div>}</div>}
            {visibleRecentThreads.length > 0 && <div className="sidebar-chat-section"><div className="section-label"><button type="button" className="section-toggle" onClick={() => toggleSection("recent")} aria-expanded={expandedSections.has("recent")} aria-controls="sidebar-recent"><span>Recent</span><ChevronDown size={12} /></button></div>{expandedSections.has("recent") && <div id="sidebar-recent"><div className="thread-list global-thread-list">{visibleRecentThreads.map(renderThread)}</div>{recentThreads.length > 8 && <button type="button" className="sidebar-show-more" onClick={() => setShowAllRecent((value) => !value)}>{showAllRecent ? "Show less" : "Show more"}</button>}</div>}</div>}
            <div className="section-label"><button type="button" className="section-toggle" onClick={() => toggleSection("projects")} aria-expanded={expandedSections.has("projects")} aria-controls="sidebar-projects"><span>Projects</span><ChevronDown size={12} /></button><button title="Create project" onClick={onCreateProject}><Plus size={14} /></button></div>
            {expandedSections.has("projects") && <div id="sidebar-projects">
            {projects.length === 0 && <button className="empty-project" onClick={onCreateProject}><FolderOpen size={16} /><span>Create your first project</span></button>}
            {projects.map((project) => {
              const isSelected = project.id === selectedProjectId;
              const isExpanded = expandedProjects.has(project.id);
              const projectThreads = state.threads
                .filter((thread) => thread.projectId === project.id && thread.messages.length > 0 && !thread.archived)
                 .sort((left, right) => {
                   const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
                   if (pinned !== 0) return pinned;
                   return state.settings.sidebarThreadSortOrder === "created_at" ? right.createdAt - left.createdAt : right.updatedAt - left.updatedAt;
                 });
              return (
                   <div className={`project-group ${isSelected ? "selected" : ""} ${draggingProjectId === project.id ? "dragging" : ""} ${dropTargetProjectId === project.id ? "drop-target" : ""}`} key={project.id}
                     onDragOver={(event) => handleProjectDragOver(event, project.id)}
                     onDrop={(event) => handleProjectDrop(event, project.id)}>
                   <div className="project-heading" onMouseEnter={(event) => showHoverCard("project", project.id, event.currentTarget)} onMouseLeave={scheduleHoverCardClose} onFocus={(event) => showHoverCard("project", project.id, event.currentTarget)} onBlur={scheduleHoverCardClose}>
                     <button className="project-toggle" draggable onDragStart={(event) => handleProjectDragStart(event, project.id)} onDragEnd={handleProjectDragEnd} onClick={() => { if (suppressProjectClickRef.current) return; if (project.id !== selectedProjectId) onSelectProject(project.id); toggleProject(project.id); }} title={`${isExpanded ? "Collapse" : "Open"} ${project.name}`} aria-expanded={isExpanded}>{isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{project.name}</span>{project.pinned && <Pin size={11} />}</button>
                    <button className="project-more" onClick={(event) => openProjectMenu(event, project.id)} title={`Project options for ${project.name}`}><MoreHorizontal size={15} /></button>
                    <button className="project-plus" onClick={() => onNewThread(project.id)} title={`New chat in ${project.name}`}><SquarePen size={13} /></button>
                  </div>
                  {isExpanded && <div className="thread-list">
                    {projectThreads.slice(0, 20).map(renderThread)}
                  </div>}
                </div>
              );
            })}
            </div>}
          </div>
        )}
        <div className="sidebar-footer">
          {accountMenuOpen && <div className="account-quick-menu glass-panel">
            <button className="account-menu-identity" type="button" onClick={() => { setAccountMenuOpen(false); onAccount(); }}><UserRound size={15} /><span><strong>{account?.displayName || account?.email || (account?.loggedIn ? "Connected account" : "Account")}</strong><small>{account?.email && account.displayName ? account.email : providerLabel(account)}</small></span><ChevronRight size={13} /></button>
            <div className="account-menu-divider" />
            <button type="button" onClick={() => { setAccountMenuOpen(false); onUsage(); }}><Gauge size={14} /><span>Usage remaining</span><ChevronRight size={13} /></button>
            <button type="button" onClick={() => { setAccountMenuOpen(false); onAccount(); }}><UserRound size={14} /><span>Manage account</span></button>
            <button type="button" onClick={() => { setAccountMenuOpen(false); onSettings(); }}><Settings size={14} /><span>Settings</span></button>
            {account?.loggedIn && <button type="button" className="account-menu-logout" onClick={() => { setAccountMenuOpen(false); onLogout(); }}><LogOut size={14} /><span>Log out</span></button>}
          </div>}
          {shouldShowAppUpdateButton(updateState) && (
            <button
              type="button"
              className="sidebar-update-button"
              title={getAppUpdateButtonTooltip(updateState)}
              aria-label={getAppUpdateButtonTooltip(updateState)}
              onClick={() => { setAccountMenuOpen(false); setProjectMenu(null); setThreadMenu(null); setNotificationsOpen(false); onUpdateAction(); }}
            >
              <Download size={13} />
              <span>{getAppUpdateButtonLabel(updateState)}</span>
              {updateState?.availableVersion && <small>v{updateState.availableVersion}</small>}
            </button>
          )}
          <button className="account-button" onClick={() => { setProjectMenu(null); setThreadMenu(null); setNotificationsOpen(false); setAccountMenuOpen((value) => !value); }} aria-expanded={accountMenuOpen}><UserRound size={15} /><span><strong>{account?.displayName || account?.email || (account?.loggedIn ? "Connected account" : "Account")}</strong>{account?.loggedIn && <small>{providerLabel(account)}</small>}</span><ChevronDown size={12} /></button>
          <button className="footer-icon-button" onClick={onSettings} title="Settings"><Settings size={15} /></button>
        </div>
       <div className="resize-handle resize-handle-sidebar" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={onResize} />
       </aside>
        {spaceEditorOpen && <SpaceEditorModal existingNames={["Void", ...state.spaces.map((space) => space.name)]} onClose={() => setSpaceEditorOpen(false)} onCreate={async (name, icon) => { const created = await onCreateSpace(name, icon); setSpaceEditorOpen(false); onSelectSpace(created.id); }} />}
        {hoverCard && createPortal(
         <SidebarHoverCard
           kind={hoverCard.kind}
           project={hoverCard.kind === "project" ? state.projects.find((project) => project.id === hoverCard.id) : state.projects.find((project) => project.id === state.threads.find((thread) => thread.id === hoverCard.id)?.projectId)}
           thread={hoverCard.kind === "thread" ? state.threads.find((thread) => thread.id === hoverCard.id) : undefined}
           chatCount={hoverCard.kind === "project" ? state.threads.filter((thread) => thread.projectId === hoverCard.id && thread.messages.length > 0 && !thread.archived).length : undefined}
           top={hoverCard.top}
           left={hoverCard.left}
           theme={state.settings.theme}
           onToggleProjectPin={hoverCard.kind === "project" ? () => { onToggleProjectPinned(hoverCard.id); closeHoverCard(); } : undefined}
           onEditProject={hoverCard.kind === "project" ? () => { onRenameProject(hoverCard.id); closeHoverCard(); } : undefined}
           onMouseEnter={cancelHoverCardClose}
           onMouseLeave={scheduleHoverCardClose}
           onFocus={cancelHoverCardClose}
           onBlur={scheduleHoverCardClose}
         />,
         document.body,
       )}
       {activeProjectMenu && projectMenu && createPortal(<div className={`project-context-popover glass-panel theme-${state.settings.theme}`} style={{ top: projectMenu.top, left: projectMenu.left }}>
        <strong className="popover-heading">{activeProjectMenu.name}</strong><small className="popover-path">{activeProjectMenu.path}</small>
        <button type="button" onClick={() => { onToggleProjectPinned(activeProjectMenu.id); setProjectMenu(null); }}>{activeProjectMenu.pinned ? <PinOff size={14} /> : <Pin size={14} />}{activeProjectMenu.pinned ? "Unpin project" : "Pin project"}</button>
        <button type="button" onClick={() => { toggleProject(activeProjectMenu.id); setProjectMenu(null); }}>{expandedProjects.has(activeProjectMenu.id) ? <Folder size={14} /> : <FolderOpen size={14} />}{expandedProjects.has(activeProjectMenu.id) ? "Collapse chats" : "Expand chats"}</button>
        <button type="button" onClick={() => { onRenameProject(activeProjectMenu.id); setProjectMenu(null); }}><Settings size={14} />Edit project</button>
        <button type="button" onClick={() => { onArchiveProjectThreads(activeProjectMenu.id); setProjectMenu(null); }}><Folder size={14} />Archive chats</button>
        <button type="button" onClick={() => { setProjectMenu(null); void window.maximoDesktop.openInEditor(activeProjectMenu.path); }}><Code2 size={14} />Open in editor</button>
        <button type="button" onClick={() => { setProjectMenu(null); void window.maximoDesktop.revealPath(activeProjectMenu.path); }}><FolderOpen size={14} />Show in Files</button>
        <button type="button" className="danger" onClick={() => { onRemoveProject(activeProjectMenu.id); setProjectMenu(null); }}><Trash2 size={14} />Remove project</button>
      </div>, document.body)}
      {activeThreadMenu && threadMenu && createPortal(<div className={`thread-context-popover glass-panel theme-${state.settings.theme}`} style={{ top: threadMenu.top, left: threadMenu.left }}>
        <button type="button" onClick={() => { onSelectThread(activeThreadMenu.id); setThreadMenu(null); onClose(); }}><SquarePen size={14} />Open chat</button>
         <button type="button" onClick={() => { onToggleThreadPinned(activeThreadMenu.id); setThreadMenu(null); }}>{activeThreadMenu.pinned ? <PinOff size={14} /> : <Pin size={14} />}{activeThreadMenu.pinned ? "Unpin chat" : "Pin chat"}</button>
         <button type="button" onClick={() => { onRenameThread(activeThreadMenu.id); setThreadMenu(null); }}><Settings size={14} />Rename chat</button>
         <button type="button" onClick={() => { onArchiveThread(activeThreadMenu.id); setThreadMenu(null); }}><Archive size={14} />Archive chat</button>
         <button type="button" className="danger" onClick={() => { onDeleteThread(activeThreadMenu.id); setThreadMenu(null); }}><Trash2 size={14} />Delete chat</button>
      </div>, document.body)}
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="Close sidebar" />}
    </>
  );
}

function EmptyWorkspace({ project, onOpenProject, onNewThread }: { project?: Project; onOpenProject: () => void; onNewThread: () => void }) {
  return (
    <div className="empty-workspace">
      <div className="empty-logo"><Logo compact /><span className="spark"><Sparkles size={13} /></span></div>
      <h2>{project ? `Ready in ${project.name}` : "Your AI workspace for work"}</h2>
      <p>{project ? "Start a focused chat. Maximo can inspect, edit, run, and verify your project through the Syntax CLI — or take on any task in your folder." : "Open a local folder to start a chat with the Maximo Syntax CLI."}</p>
      <button className="primary-button compact" onClick={project ? onNewThread : onOpenProject}>{project ? <SquarePen size={15} /> : <FolderOpen size={15} />}{project ? "New chat" : "Open folder"}</button>
      <div className="capability-row"><span><Code2 size={14} /> Code and software</span><span><FileText size={14} /> Documents and files</span><span><WandSparkles size={14} /> Research and automation</span><span><ShieldCheck size={14} /> Permission controls</span></div>
    </div>
  );
}

function questionInteractionAnswers(questions: Question[], answers: Record<string, string>, fallback: string): AskUserAnswer[] {
  return questions.map((question) => ({
    question: question.question,
    answer: answers[question.question]?.trim() || fallback,
    ...(question.header ? { header: question.header } : {}),
    ...(question.multiSelect ? { multiSelect: true } : {}),
  }));
}

/**
 * Renders user-message text with recognized /command tokens (skills) wrapped
 * in an accent-colored span — the same set of names the composer highlights,
 * so a sent skill keeps its highlight in the chat bubble.
 */
function SkillTokenize({ text, skillNames }: { text: string; skillNames: Set<string> }) {
  const parts: ReactNode[] = [];
  const regex = /(^|[\s\n])(\/[a-zA-Z][a-zA-Z0-9:\-_]*)/g;
  let last = 0;
  let match: RegExpExecArray | null = null;
  let index = 0;
  while ((match = regex.exec(text)) !== null) {
    const precedingChar = match[1] ?? "";
    const token = match[2] ?? "";
    const name = token.slice(1).toLowerCase();
    if (skillNames.has(name)) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(precedingChar);
      parts.push(<span className="chat-command-token skill-token" key={index++} title={`Skill ${skillDisplayLabel(name)}`}><Boxes size={11} aria-hidden="true" /><span>{skillDisplayLabel(name)}</span></span>);
      last = match.index + precedingChar.length + token.length;
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  if (parts.length === 0) return text;
  return <>{parts}</>;
}

function skillDisplayLabel(value: string): string {
  return value.replace(/^\/+/, "").split(/[-_]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ");
}

function messageModelId(message: ChatMessage, thread: Thread): string | undefined {
  return message.model ?? thread.model;
}

function messageModelLabel(message: ChatMessage, thread: Thread, models: EngineModel[]): string | undefined {
  const requestedModel = messageModelId(message, thread);
  const selected = requestedModel !== undefined
    ? models.find((model) => (model.value === "default" ? "" : model.value) === requestedModel)
    : undefined;
  if (selected) return selected.displayName;
  if (requestedModel?.trim()) return requestedModel.trim();
  return models.find((model) => model.isCurrent)?.displayName ?? models.find((model) => model.value === "default")?.displayName;
}

function AnswerModelLabel({ message, thread, models }: { message: ChatMessage; thread: Thread; models: EngineModel[] }) {
  const label = messageModelLabel(message, thread, models);
  const modelId = messageModelId(message, thread) ?? label;
  if (!label) return null;
  return <span className="message-model-label" title={`Answered by ${label}`} aria-label={`Answered by ${label}`}><ModelLogo model={modelId} className="model-logo-sm" /><span>{label}</span></span>;
}

function MessageEnvironmentActions({ message, pinned, onTogglePin }: { message: ChatMessage; pinned: boolean; onTogglePin: () => void }) {
  if (message.role !== "assistant") return null;
  return <button type="button" className={pinned ? "active" : ""} onClick={onTogglePin} data-tooltip={pinned ? "Unpin message" : "Pin message"} aria-label={pinned ? "Unpin message" : "Pin message"}><Pin size={13} /></button>;
}

function UserMessageEditForm({ initialValue, onCancel, onSubmit, disabled = false }: { initialValue: string; onCancel: () => void; onSubmit: (text: string) => void; disabled?: boolean }) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Auto-grow the textarea so the edit form feels like the bubble, not a fixed box.
  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  };
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    resizeTextarea();
  }, []);
  useEffect(() => { resizeTextarea(); }, [value]);
  const trimmed = value.replace(/\s+/g, " ").trim();
  const canSubmit = Boolean(trimmed) && trimmed !== initialValue.trim() && !disabled;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };
  return (
    <form className="message-edit-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea
        ref={textareaRef}
        value={value}
        disabled={disabled}
        rows={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
        }}
        aria-label="Edit message"
      />
      <div className="message-edit-form-actions">
        <button type="button" className="message-edit-cancel" onClick={onCancel} disabled={disabled}>Cancel</button>
        <button type="submit" className="message-edit-save" disabled={!canSubmit}>Send</button>
      </div>
    </form>
  );
}

// Show more/less for long user messages — copied from Synara's chat UI. A long
// user message is clamped to a visual max-height (with a fade mask) instead of a
// character slice; the real overflow is measured so the clamp only applies when
// the message actually exceeds the limit. The character threshold is only a
// first-paint hint; rendered height is governed by the line limit.
const COLLAPSED_USER_MESSAGE_MAX_CHARS = 600;
const USER_MESSAGE_COLLAPSED_MAX_LINES = 12;
const USER_MESSAGE_COLLAPSED_FADE_LINES = 2;

function userMessageLikelyOverflows(text: string): boolean {
  if (text.length > COLLAPSED_USER_MESSAGE_MAX_CHARS) {
    return true;
  }

  let newlineCount = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    newlineCount += 1;
    if (newlineCount >= USER_MESSAGE_COLLAPSED_MAX_LINES) {
      return true;
    }
  }
  return false;
}

// Measures the clamped message against its content so the fade mask never
// flickers. Mirrors Synara's userMessageOverflowObserver: batch resize events
// into a single rAF pass instead of re-measuring on every observer callback.
function observeUserMessageOverflow(element: HTMLElement, measure: () => void): () => void {
  if (typeof ResizeObserver === "undefined") {
    return () => undefined;
  }
  const observer = new ResizeObserver(() => {
    measure();
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
  };
}

// --- Collapsed "big paste" feature, copied from Synara's composerPastedText. A
// large paste is held as an attachment-style card above the composer (not inline
// text); its full content rides to the provider in a trailing <pasted_text> block
// and is parsed back out to render the same card in the transcript.

interface PastedTextDraft {
  id: string;
  createdAt: number;
  text: string;
  lineCount: number;
  charCount: number;
}

// A paste only collapses once it is large enough that inlining it would flood the
// composer. Either dimension trips the threshold.
const PASTED_TEXT_MIN_LINES = 25;
const PASTED_TEXT_MIN_CHARS = 4000;

const TRAILING_PASTED_TEXT_BLOCK_PATTERN = /\n*<pasted_text>\n([\s\S]*?)\n<\/pasted_text>\s*$/;

function normalizePastedTextContent(text: string): string {
  // Normalize line endings only; leading/trailing whitespace can be meaningful in
  // pasted content, so we never trim it.
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countPastedTextLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function shouldCollapsePastedText(text: string): boolean {
  const normalized = normalizePastedTextContent(text);
  if (normalized.length === 0) {
    return false;
  }
  return (
    normalized.length >= PASTED_TEXT_MIN_CHARS ||
    countPastedTextLines(normalized) >= PASTED_TEXT_MIN_LINES
  );
}

function createPastedTextDraft(text: string): PastedTextDraft {
  const normalized = normalizePastedTextContent(text);
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `pasted-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    text: normalized,
    lineCount: countPastedTextLines(normalized),
    charCount: normalized.length,
  };
}

function formatPastedTextCountLabel(metrics: { lineCount: number; charCount: number }): string {
  if (metrics.lineCount > 1) {
    return `${metrics.lineCount.toLocaleString()} lines`;
  }
  return `${metrics.charCount.toLocaleString()} chars`;
}

// First non-empty line, trimmed; used as the card's title preview.
function pastedTextTitle(text: string): string {
  const normalized = normalizePastedTextContent(text);
  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
    }
  }
  return "Pasted text";
}

function buildPastedTextBlock(pastedTexts: ReadonlyArray<{ text: string }>): string {
  const usable = pastedTexts.filter((pasted) => pasted.text.length > 0);
  if (usable.length === 0) {
    return "";
  }
  const payload = usable.map((pasted) => ({ text: normalizePastedTextContent(pasted.text) }));
  return ["<pasted_text>", JSON.stringify(payload), "</pasted_text>"].join("\n");
}

function appendPastedTextsToPrompt(
  prompt: string,
  pastedTexts: ReadonlyArray<{ text: string }>,
): string {
  const block = buildPastedTextBlock(pastedTexts);
  const trimmed = prompt.trim();
  if (block.length === 0) {
    return trimmed;
  }
  return trimmed.length > 0 ? `${trimmed}\n\n${block}` : block;
}

function extractTrailingPastedTexts(prompt: string): { promptText: string; pastedTexts: Array<{ index: number; text: string; lineCount: number; charCount: number }> } {
  const match = TRAILING_PASTED_TEXT_BLOCK_PATTERN.exec(prompt);
  if (!match) {
    return { promptText: prompt, pastedTexts: [] };
  }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, "");
  let pastedTexts: Array<{ index: number; text: string; lineCount: number; charCount: number }> = [];
  try {
    const parsed: unknown = JSON.parse(match[1] ?? "[]");
    if (Array.isArray(parsed)) {
      pastedTexts = parsed.flatMap((entry, index) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const text = (entry as { readonly text?: unknown }).text;
        return typeof text === "string"
          ? [{ index: index + 1, text, lineCount: countPastedTextLines(text), charCount: text.length }]
          : [];
      });
    }
  } catch {
    pastedTexts = [];
  }
  return { promptText, pastedTexts };
}

// Transcript echo of a collapsed big paste: the same card the composer showed,
// but its action expands the full pasted content in place (read-only) instead of
// editing — mirrors Synara's UserMessagePastedTextCard.
function UserMessagePastedTextCard({ text, metrics }: { text: string; metrics: { lineCount: number; charCount: number } }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="pasted-text-card pasted-text-card-transcript">
      <span className="pasted-text-card-icon"><File size={13} /></span>
      <span className="pasted-text-card-copy">
        <strong title={pastedTextTitle(text)}>{pastedTextTitle(text)}</strong>
        <small>{formatPastedTextCountLabel(metrics)}</small>
      </span>
      <button
        type="button"
        className="pasted-text-card-action"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Hide text" : "Show text"}<span className="pasted-text-card-count">· {formatPastedTextCountLabel(metrics)}</span>
      </button>
      {expanded && (
        <pre className="pasted-text-card-expanded">{text}</pre>
      )}
    </div>
  );
}

function UserMessageCollapsibleText({ text, expanded, chatFontSizePx, onToggle, children }: { text: string; expanded: boolean; chatFontSizePx: number; onToggle: () => void; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useRef<string>(`user-message-${Math.random().toString(36).slice(2, 9)}`).current;
  const [overflowing, setOverflowing] = useState(() => userMessageLikelyOverflows(text));
  const collapsed = !expanded;

  useLayoutEffect(() => {
    if (!collapsed) return undefined;
    const element = contentRef.current;
    if (!element) return undefined;
    const measure = () => {
      setOverflowing(element.scrollHeight - element.clientHeight > 1);
    };
    measure();
    return observeUserMessageOverflow(element, measure);
  }, [collapsed, text]);

  const lineHeightPx = Math.round(chatFontSizePx * 1.68);
  const clampHeightPx = USER_MESSAGE_COLLAPSED_MAX_LINES * lineHeightPx;
  const fadeStartPx = clampHeightPx - USER_MESSAGE_COLLAPSED_FADE_LINES * lineHeightPx;
  const clamped = collapsed && overflowing;

  // Smooth expand/collapse: when expanding, animate max-height from the clamp up
  // to the measured full height so the reveal is buttery instead of a snap; when
  // collapsing, animate back to the clamp. The full height is measured in a
  // layout effect right after `expanded` flips — the first paint is still clamped
  // (so no flash), then the transition glides to the measured value. Measuring
  // with scrollHeight is read-only and cheap, so the click never hangs.
  const [measuredHeightPx, setMeasuredHeightPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!expanded) return;
    const element = contentRef.current;
    if (!element) return;
    setMeasuredHeightPx(element.scrollHeight);
  }, [expanded, text]);

  const maxHeightPx = expanded
    ? (measuredHeightPx ?? clampHeightPx)
    : clampHeightPx;

  return (
    <div className="user-message-bubble">
      <div
        id={contentId}
        ref={contentRef}
        data-user-message-clamp={clamped ? "true" : "false"}
        className="user-message-content"
        style={{
          maxHeight: `${maxHeightPx}px`,
          ...(collapsed && clamped
            ? {
                maskImage: `linear-gradient(to bottom, black ${fadeStartPx}px, transparent 100%)`,
              }
            : {}),
        }}
      >
        {children}
      </div>
      {(clamped || expanded) && (
        <button
          type="button"
          className="user-message-show-more"
          style={{ fontSize: `${chatFontSizePx}px` }}
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={onToggle}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function MessageView({ thread, project, git, models, live, waiting, skillNames, timestampFormat, streamingEnabled, onPreviewAttachment, onOpenFile, onTogglePin, onEditResend, onRevert }: { thread: Thread; project?: Project; git?: GitStatus | null; models: EngineModel[]; live?: LiveRun; waiting?: boolean; skillNames?: Set<string>; timestampFormat: TimestampFormat; streamingEnabled: boolean; onPreviewAttachment: (attachment: Attachment) => void; onOpenFile: (path: string, diff?: GitDiff) => void; onTogglePin: (messageId: string) => void; onEditResend?: (messageId: string, text: string) => void; onRevert?: (messageId: string, revertFiles: boolean) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousThreadIdRef = useRef(thread.id);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [expandedUserMessagesById, setExpandedUserMessagesById] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (previousThreadIdRef.current !== thread.id) {
      previousThreadIdRef.current = thread.id;
      shouldStickToBottomRef.current = true;
    }
    const frame = window.requestAnimationFrame(() => {
      const scroll = scrollRef.current;
       if (scroll && shouldStickToBottomRef.current) scroll.scrollTo({ top: scroll.scrollHeight, behavior: live ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [thread.id, thread.messages.length, live?.text, waiting]);
  const handleScroll = () => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    shouldStickToBottomRef.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 72;
  };
  // The latest non-follow-up user message is the only one that can be edited
  // and resent (matches Synara's resolveLatestTailUserMessageEditTarget).
  const latestEditableUserMessageId = useMemo(() => {
    let latest: string | null = null;
    for (const message of thread.messages) {
      if (message.role === "user" && message.kind !== "follow-up") latest = message.id;
    }
    return latest;
  }, [thread.messages]);
  // A user message is "revertable" when it is followed by at least one
  // assistant turn (there is something to discard by reverting to it).
  const revertableUserMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (let index = 0; index < thread.messages.length; index += 1) {
      const message = thread.messages[index];
      if (message?.role !== "user" || message.kind === "follow-up") continue;
      for (let next = index + 1; next < thread.messages.length; next += 1) {
        const candidate = thread.messages[next];
        if (!candidate) break;
        if (candidate.role === "user") break;
        if (candidate.role === "assistant" && candidate.content.trim()) {
          ids.add(message.id);
          break;
        }
      }
    }
    return ids;
  }, [thread.messages]);
  // Leave edit mode if the target message disappears (e.g. after a revert).
  useEffect(() => {
    if (editingMessageId && !thread.messages.some((message) => message.id === editingMessageId)) {
      setEditingMessageId(null);
    }
  }, [editingMessageId, thread.messages]);
  const { renderedMessages, streamingInteractions, streamingFollowUps } = useMemo(() => {
    const renderedMessages: ReactNode[] = [];
    const followUpsByAssistant = new Map<string, ChatMessage[]>();
    const standaloneFollowUps = new Set<string>();
    let pendingFollowUps: ChatMessage[] = [];
    let lastAssistantId: string | undefined;
    const attachFollowUps = (assistantId: string, followUps: ChatMessage[]) => {
      followUpsByAssistant.set(assistantId, [...(followUpsByAssistant.get(assistantId) ?? []), ...followUps]);
    };
    // Follow-ups are persisted as messages for recovery/search, but are context
    // for the active agent task rather than standalone conversation turns.
    for (const message of thread.messages) {
      if (message.role === "user" && message.kind === "follow-up") {
        pendingFollowUps.push(message);
        continue;
      }
      if (message.role === "assistant") {
        if (pendingFollowUps.length > 0 && thread.status !== "running") {
          attachFollowUps(message.id, pendingFollowUps);
          pendingFollowUps = [];
        }
        lastAssistantId = message.id;
        continue;
      }
      if (message.role === "user" && pendingFollowUps.length > 0 && lastAssistantId) {
        attachFollowUps(lastAssistantId, pendingFollowUps);
        pendingFollowUps = [];
      }
    }
    if (pendingFollowUps.length > 0 && thread.status !== "running" && lastAssistantId) {
      attachFollowUps(lastAssistantId, pendingFollowUps);
      pendingFollowUps = [];
    }
    if (pendingFollowUps.length > 0 && thread.status !== "running" && !lastAssistantId) {
      pendingFollowUps.forEach((message) => standaloneFollowUps.add(message.id));
      pendingFollowUps = [];
    }
    const streamingFollowUps = pendingFollowUps;
    let pendingInteractions: TimedInteraction[] = [];
    const flushStandaloneInteractions = (key: string) => {
      if (pendingInteractions.length === 0) return;
      const interactions = pendingInteractions;
      pendingInteractions = [];
      renderedMessages.push(
        <article className="message assistant question-process-message" key={key}>
          <div className="message-meta"><span className="message-avatar"><Logo compact /></span><span>Maximo Syntax</span></div>
          <WorkTimeline entries={interactions.map((item) => ({ type: "interaction", interaction: item.interaction, timestamp: item.createdAt }))} onOpenFile={onOpenFile} />
        </article>,
      );
    };
    for (const message of thread.messages) {
      if (message.interaction) {
        pendingInteractions.push({ interaction: message.interaction, createdAt: message.createdAt });
        continue;
      }
      if (message.role === "user") {
        if (message.kind === "follow-up") {
          if (!standaloneFollowUps.has(message.id)) continue;
          flushStandaloneInteractions(`question-process-before-${message.id}`);
          renderedMessages.push(
            <article className="message user follow-up" id={`message-${message.id}`} data-message-id={message.id} key={message.id}>
              <div className="user-turn follow-up-turn">
                <span className="follow-up-label">Added context</span>
                {message.attachments?.length ? <AttachmentList attachments={message.attachments} onPreview={onPreviewAttachment} className="message-attachments" /> : null}
                <MarkdownContent>{extractTrailingPastedTexts(message.content).promptText}</MarkdownContent>
                <div className="message-actions user-actions"><time>{formatTimestamp(message.createdAt, timestampFormat)}</time><MessageEnvironmentActions message={message} pinned={Boolean(thread.pinnedMessages?.some((pin) => pin.messageId === message.id))} onTogglePin={() => onTogglePin(message.id)} /><CopyMessageButton content={message.content} /></div>
              </div>
            </article>,
          );
          continue;
        }
        flushStandaloneInteractions(`question-process-before-${message.id}`);
        const isEditingThisMessage = editingMessageId === message.id;
        const isLatestEditable = latestEditableUserMessageId === message.id;
        const isRevertable = revertableUserMessageIds.has(message.id);
        const threadBusy = thread.status === "running" || Boolean(waiting);
        const { promptText: extractedPromptText, pastedTexts: extractedPastedTexts } = extractTrailingPastedTexts(message.content);
        renderedMessages.push(
          <article className={`message user${isEditingThisMessage ? " editing" : ""}`} id={`message-${message.id}`} data-message-id={message.id} key={message.id}>
            <div className={`user-turn${isEditingThisMessage ? " user-turn-editing" : ""}`}>
              {message.attachments?.length ? <AttachmentList attachments={message.attachments} onPreview={onPreviewAttachment} className="message-attachments" /> : null}
              {isEditingThisMessage ? (
                <UserMessageEditForm
                  initialValue={extractTrailingPastedTexts(message.content).promptText}
                  onCancel={() => setEditingMessageId(null)}
                  onSubmit={(text) => { setEditingMessageId(null); onEditResend?.(message.id, text); }}
                />
              ) : (
                <>
                  {extractedPastedTexts.length > 0 && (
                    <div className="pasted-text-strip pasted-text-strip-transcript">
                      {extractedPastedTexts.map((pasted) => (
                        <UserMessagePastedTextCard
                          key={pasted.index}
                          text={pasted.text}
                          metrics={{ lineCount: pasted.lineCount, charCount: pasted.charCount }}
                        />
                      ))}
                    </div>
                  )}
                  {extractedPromptText.trim().length > 0 && (
                    <UserMessageCollapsibleText
                      text={extractedPromptText}
                      expanded={Boolean(expandedUserMessagesById[message.id])}
                      chatFontSizePx={13}
                      onToggle={() => {
                        setExpandedUserMessagesById((previous) => ({
                          ...previous,
                          [message.id]: !(previous[message.id] ?? false),
                        }));
                      }}
                    >
                      {skillNames && skillNames.size > 0 ? <div className="markdown"><SkillTokenize text={extractedPromptText} skillNames={skillNames} /></div> : <MarkdownContent>{extractedPromptText}</MarkdownContent>}
                    </UserMessageCollapsibleText>
                  )}
                </>
              )}
              {!isEditingThisMessage && (
                <div className="message-actions user-actions">
                  <time>{formatTimestamp(message.createdAt, timestampFormat)}</time>
                  <MessageEnvironmentActions message={message} pinned={Boolean(thread.pinnedMessages?.some((pin) => pin.messageId === message.id))} onTogglePin={() => onTogglePin(message.id)} />
                  {isLatestEditable && !threadBusy && onEditResend && (
                    <button type="button" className="message-action-edit" onClick={() => setEditingMessageId(message.id)} data-tooltip="Edit and resend" data-tooltip-side="bottom" aria-label="Edit and resend"><SquarePen size={13} /></button>
                  )}
                  {isRevertable && !threadBusy && onRevert && (
                    <button type="button" className="message-action-revert" onClick={() => onRevert(message.id, true)} data-tooltip="Revert to this message" data-tooltip-side="bottom" aria-label="Revert to this message"><Undo2 size={13} /></button>
                  )}
                  <CopyMessageButton content={message.content} />
                </div>
              )}
            </div>
          </article>,
        );
        continue;
      }
      const interactions = pendingInteractions;
      pendingInteractions = [];
      const baseTimeline: RunTimelineItem[] = message.timeline?.length ? message.timeline : message.activity?.map((item) => ({ type: "activity" as const, ...item })) ?? [];
      const contextTimeline = (followUpsByAssistant.get(message.id) ?? []).map(followUpContextItem);
      const turnTimeline = [...baseTimeline, ...contextTimeline].sort((left, right) => left.timestamp - right.timestamp);
      renderedMessages.push(
        <article className={`message ${message.role} ${message.isError ? "error" : ""}`} id={`message-${message.id}`} data-message-id={message.id} key={message.id}>
          <div className="message-meta">
            <span className="message-avatar"><Logo compact /></span>
            <span>Maximo Syntax</span>
            <time>{formatTimestamp(message.createdAt, timestampFormat)}</time>
          </div>
          <MemoizedWorkDisclosure timeline={turnTimeline} interactions={interactions} durationMs={message.durationMs} finalContent={message.content} onOpenFile={onOpenFile} fileChanges={message.fileChanges} project={project} onPreviewAttachment={onPreviewAttachment} />
          {/* Error color applies only to this final body — not work-timeline partial answers. */}
          <MarkdownContent className={message.isError ? "message-error-body" : undefined}>{message.content}</MarkdownContent>
          <TurnFileChanges timeline={turnTimeline} fileChanges={message.fileChanges} project={project} git={git} onOpenFile={onOpenFile} />
          <div className="message-actions assistant-actions">{message.role === "assistant" && <AnswerModelLabel message={message} thread={thread} models={models} />}<MessageEnvironmentActions message={message} pinned={Boolean(thread.pinnedMessages?.some((pin) => pin.messageId === message.id))} onTogglePin={() => onTogglePin(message.id)} /><CopyMessageButton content={message.content} /></div>
        </article>,
      );
    }
    if (thread.status !== "running") flushStandaloneInteractions("question-process-trailing");
    return {
      renderedMessages,
      streamingInteractions: pendingInteractions,
      streamingFollowUps,
    };
  }, [editingMessageId, expandedUserMessagesById, git, latestEditableUserMessageId, models, onEditResend, onOpenFile, onPreviewAttachment, onRevert, onTogglePin, project, revertableUserMessageIds, skillNames, thread, timestampFormat, waiting]);
  const liveTimeline = streamingEnabled ? [
    ...(live?.timeline ?? (live?.text ? [{ type: "text" as const, text: live.text, timestamp: Date.now() }] : [])),
    ...streamingFollowUps.map(followUpContextItem),
  ].sort((left, right) => left.timestamp - right.timestamp) : [];
  return (
    <div className={`conversation-scroll ${waiting ? "waiting" : ""}`} ref={scrollRef} onScroll={handleScroll}>
      <div className={`conversation ${waiting ? "waiting" : ""}`}>
        {thread.messages.length === 0 && thread.status !== "running" && (
          <div className="thread-empty">
            <Logo compact />
            <h3>What should we build in {project?.name ?? "this project"}?</h3>
            <p>Describe the outcome, attach useful files, and Maximo Syntax will work directly in this project.</p>
          </div>
        )}
        {renderedMessages}
        {thread.status === "running" && (
          <article className="message assistant streaming">
            <div className="message-meta"><span className="message-avatar"><Logo compact /></span><span>Maximo Syntax</span></div>
            <MemoizedWorkDisclosure timeline={liveTimeline} interactions={streamingInteractions} live onOpenFile={onOpenFile} onPreviewAttachment={onPreviewAttachment} />
            <LiveWorkStatus running={thread.status === "running"} waiting={Boolean(waiting)} live={live} inline />
             {streamingEnabled && live?.text && <div className="message-actions assistant-actions"><CopyMessageButton content={live.text} /></div>}
          </article>
        )}
      </div>
    </div>
  );
}

function FullAccessConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return createPortal(
    <div className="permission-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="permission-confirm glass-panel" role="alertdialog" aria-modal="true" aria-labelledby="full-access-title">
        <span className="permission-confirm-icon"><ShieldAlert size={18} /></span>
        <div><strong id="full-access-title">Turn on Full Access?</strong><p>Maximo can act without asking for permission. Only enable this for a project you trust.</p></div>
        <div className="permission-scope-list">
          <span><FolderOpen size={15} /><div><strong>Files and folders</strong><small>Read, create, modify, or delete files on this computer</small></div></span>
          <span><TerminalSquare size={15} /><div><strong>Terminal commands</strong><small>Run commands, install software, and change local settings</small></div></span>
          <span><Gauge size={15} /><div><strong>Internet access</strong><small>Connect to websites and send data through enabled tools</small></div></span>
        </div>
        <div className="permission-confirm-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onConfirm}>Enable Full access</button></div>
      </section>
    </div>,
    document.body,
  );
}

function Composer({ thread, project, git, live, settings, models, modelOptions, slashCommands, skillCommands = [], discoveredSkills = [], contextUsage, contextLoading = false, onRefreshContext, onSend, onStop, onOpenProject, onAccountUsage, onSettingsChanged, onGitChanged, onPreviewAttachment, pendingQuestion, pendingPermission, onSubmitAnswers, onSkipQuestion, onApprovePermission, onDenyPermission, queuedFollowUps = [], onRemoveQueuedFollowUp, onEditQueuedFollowUp }: {
  thread: Thread; project?: Project; git: GitStatus | null; live?: LiveRun; settings: AppState["settings"]; models: EngineModel[]; modelOptions: SelectOption<string>[]; slashCommands: SlashCommand[]; skillCommands?: SlashCommand[]; discoveredSkills?: SlashCommand[];
  contextUsage: ContextUsage | null; contextLoading?: boolean; onRefreshContext: () => Promise<void>;
  onSend: (prompt: string, attachments: Attachment[], model: string, effort: string, permission: PermissionMode, contextWindow?: number) => Promise<void>;
  onStop: () => void; onOpenProject: () => void; onAccountUsage: () => void; onSettingsChanged: (patch: Partial<AppState["settings"]>) => Promise<void>; onGitChanged: (status: GitStatus) => void; onPreviewAttachment: (attachment: Attachment) => void;
  pendingQuestion?: { questions: Question[] };
  pendingPermission?: { payload: PermissionRequestPayload };
  onSubmitAnswers: (answers: Record<string, string>) => void;
  onSkipQuestion: () => void;
  onApprovePermission: (remember: boolean) => void;
  onDenyPermission: () => void;
  queuedFollowUps?: QueuedFollowUp[];
  onRemoveQueuedFollowUp?: (id: string) => void;
  onEditQueuedFollowUp?: (item: QueuedFollowUp) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pastedTexts, setPastedTexts] = useState<PastedTextDraft[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [model, setModel] = useState(thread.model ?? settings.defaultModel);
  const [effort, setEffort] = useState(thread.effort ?? settings.defaultEffort);
  const [permission, setPermission] = useState<PermissionMode>(thread.permission ?? settings.defaultPermission);
  const [confirmFullAccess, setConfirmFullAccess] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [contextOpen, setContextOpen] = useState<"project" | "location" | "branch" | null>(null);
  const [branchInfo, setBranchInfo] = useState<{ current: string; branches: string[]; dirty: boolean } | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandPaletteDismissed, setCommandPaletteDismissed] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const submitInFlightRef = useRef(false);
  const insertionOffsetRef = useRef<number | null>(null);
  const composerNoticeTimerRef = useRef<number | null>(null);
  const [cursorOffsetState, setCursorOffsetState] = useState<number | null>(null);
  const getCaretOffset = useCallback((editor: HTMLDivElement): number => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.anchorNode || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    return range.toString().length;
  }, []);
  const setCaretOffset = useCallback((editor: HTMLDivElement, offset: number) => {
    let node: Node = editor;
    let remaining = offset;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null);
    let textNode = walker.nextNode() as Text | null;
    while (textNode) {
      const length = textNode.data.length;
      if (remaining <= length) {
        node = textNode;
        break;
      }
      remaining -= length;
      textNode = walker.nextNode() as Text | null;
    }
    const range = document.createRange();
    range.setStart(node, remaining);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
    editor.focus();
  }, []);
  const running = thread.status === "running";
  const waitingForResponse = Boolean(pendingQuestion || pendingPermission);
  const activeCursorOffset = cursorOffsetState ?? prompt.length;
  const showComposerNotice = useCallback((message: string) => {
    setComposerNotice(message);
    if (composerNoticeTimerRef.current !== null) window.clearTimeout(composerNoticeTimerRef.current);
    composerNoticeTimerRef.current = window.setTimeout(() => {
      composerNoticeTimerRef.current = null;
      setComposerNotice(null);
    }, 2_800);
  }, []);
  useEffect(() => () => {
    if (composerNoticeTimerRef.current !== null) window.clearTimeout(composerNoticeTimerRef.current);
  }, []);
  // CLI-parity mid-input detection (findMidInputSlashCommand):
  //   - "/" at the start of the prompt is always a trigger (query = text after it)
  //   - mid-input, the LAST "/" preceded by whitespace or a line break before
  //     the cursor is a trigger (query = text between the "/" and the cursor),
  //     and only while the cursor is at or before the end of the token. This
  //     keeps "/" working after an inserted skill (e.g. "/deploy /" ) so more
  //     commands can be added right where the cursor is.
  const slashTriggerAt = (() => {
    if (!prompt) return null;
    const text = activeCursorOffset > prompt.length ? prompt : prompt.slice(0, activeCursorOffset);
    // Mid-input: the LAST "/" preceded by whitespace or a line break before the
    // cursor is a trigger, while the cursor is at or before the token end. This
    // keeps "/" working after an inserted skill (e.g. "/deploy /" ) so more
    // commands can be added right where the cursor is — even when the prompt
    // already starts with "/".
    const match = /[\s\n]\/([a-zA-Z0-9_:-]*)$/.exec(text);
    if (match) {
      const slashPos = match.index + 1;
      const tokenEnd = slashPos + 1 + match[1]!.length;
      if (activeCursorOffset <= tokenEnd) return slashPos;
    }
    // "/" at the very start of the prompt triggers when it is a bare token
    // (nothing typed after it yet) — e.g. the first skill of a fresh message.
    if (text.startsWith("/")) {
      return /^\/[a-zA-Z0-9_:-]*$/.test(text) ? 0 : null;
    }
    return null;
  })();
  const menuItems = useMemo(() => {
    const merged = new Map<string, SlashMenuItem>();
    const add = (list: SlashCommand[], kind: SlashMenuKind) => {
      for (const command of list) {
        const name = command.name.trim().replace(/^\/+/, "");
        const key = slashCommandKey(name);
        if (!key || (kind === "command" && desktopIncompatibleCommands.has(key))) continue;
        const item: SlashMenuItem = { ...command, name, kind };
        const existing = merged.get(key);
        // A live skill entry has the richer skill metadata when the CLI also
        // reports the same name in its general slash-command list.
        if (!existing || (existing.kind === "command" && kind === "skill")) merged.set(key, item);
      }
    };

    // Live CLI catalog first, then skills. Always layer fallback desktop-known
    // commands (e.g. /goal) afterward so they still appear when an older or
    // partial engine catalog omits them — `add` only fills missing keys, so
    // richer live entries are never overwritten.
    add(slashCommands, "command");
    add(skillCommands, "skill");
    add(discoveredSkills, "skill");
    add(fallbackSlashCommands, "command");
    return [...merged.values()];
  }, [discoveredSkills, slashCommands, skillCommands]);
  const commandQuery = slashTriggerAt === null ? null : (activeCursorOffset > prompt.length ? prompt : prompt.slice(slashTriggerAt + 1, activeCursorOffset)).toLowerCase();
  const visibleMenuItems = commandQuery === null ? [] : menuItems.filter((command) => slashCommandKey(command.name).startsWith(commandQuery));
  const visibleSkills = visibleMenuItems.filter((command) => command.kind === "skill");
  const visibleSlashCommands = visibleMenuItems.filter((command) => command.kind === "command");
  const commandPaletteOpen = slashTriggerAt !== null && !commandPaletteDismissed;
  useEffect(() => {
    setCommandIndex((index) => Math.min(index, Math.max(0, visibleMenuItems.length - 1)));
  }, [visibleMenuItems.length]);
  const knownCommandNames = useMemo(() => {
    const names = new Set<string>();
    for (const command of menuItems) names.add(slashCommandKey(command.name));
    return names;
  }, [menuItems]);
  const knownSkillNames = useMemo(() => new Set(menuItems.filter((command) => command.kind === "skill").map((command) => slashCommandKey(command.name))), [menuItems]);
  // The composer input is a contentEditable that holds ONLY the plain text the
  // user typed (one element, zero duplication — no overlay, no stacked text).
  // After every edit we rebuild the DOM with accent-colored spans around each
  // recognized /command token, and restore the caret to its exact position.
  // Because the edited text IS the only text, the highlight can never drift or
  // double — and the caret stays exactly where the user put it.
  const renderHighlighted = useCallback((textToRender?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const text = textToRender ?? prompt;
    // Fast path: when the DOM is already a single text node (no token spans)
    // with the same text, there is nothing to rebuild — returning early keeps
    // the caret from jumping on every keystroke. If there are spans, ALWAYS
    // rebuild so typing inside/after a stale highlight stops being green.
    if (textToRender === undefined && editor.childNodes.length === 1 && editor.childNodes[0]?.nodeType === Node.TEXT_NODE && editor.textContent === text) return;
    const caret = textToRender === undefined ? getCaretOffset(editor) : (insertionOffsetRef.current ?? text.length);
    // Build the DOM from scratch every time: clear ALL children first, then add
    // ONE copy of the text with accent-colored spans around recognized
    // /command tokens. Never append on top of an existing copy.
    const tokens: Array<[number, number]> = [];
    const regex = /(^|[\s\n])(\/[a-zA-Z][a-zA-Z0-9:\-_]*)/g;
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(text)) !== null) {
      const precedingChar = match[1] ?? "";
      const commandToken = match[2] ?? "";
      const name = commandToken.slice(1).toLowerCase();
      if (knownCommandNames.has(name)) {
        const start = match.index + precedingChar.length;
        tokens.push([start, start + commandToken.length]);
      }
    }
    editor.replaceChildren();
    if (tokens.length > 0) {
      let cursor = 0;
      for (const [start, end] of tokens) {
        if (start > cursor) editor.appendChild(document.createTextNode(text.slice(cursor, start)));
        const span = document.createElement("span");
        const isSkill = knownSkillNames.has(slashCommandKey(text.slice(start, end)));
        span.className = isSkill ? "command-token skill-token" : "command-token";
        if (isSkill) span.dataset.label = skillDisplayLabel(text.slice(start, end));
        span.textContent = text.slice(start, end);
        editor.appendChild(span);
        cursor = end;
      }
      if (cursor < text.length) editor.appendChild(document.createTextNode(text.slice(cursor)));
    } else {
      editor.textContent = text;
    }
    setCaretOffset(editor, Math.min(caret, text.length));
  }, [knownCommandNames, knownSkillNames, prompt]);
  useEffect(() => {
    renderHighlighted();
  }, [prompt, knownCommandNames, renderHighlighted]);
  const sendShortcutLabel = composerSendShortcutLabel();
  useEffect(() => {
    setModel(thread.model ?? settings.defaultModel);
    setEffort(thread.effort ?? settings.defaultEffort);
    setPermission(thread.permission ?? settings.defaultPermission);
  }, [thread.model, thread.effort, thread.permission, settings.defaultModel, settings.defaultEffort, settings.defaultPermission]);
  useEffect(() => {
    setWarningDismissed(false);
  }, [thread.id]);
  useEffect(() => { editorRef.current?.focus(); }, [thread.id]);
  useEffect(() => {
    if (!addOpen && !contextOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest(".add-control, .composer-context, .add-menu, .context-menu")) return;
      setAddOpen(false);
      setContextOpen(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [addOpen, contextOpen]);
  const applyQueuedEdit = (item: QueuedFollowUp) => {
    setComposerNotice(null);
    setPrompt(item.prompt);
    setAttachments(item.attachments);
    setModel(item.model);
    setEffort(item.effort);
    setPermission(item.permission);
    onEditQueuedFollowUp?.(item);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (editor) {
        renderHighlighted(item.prompt);
        setCaretOffset(editor, item.prompt.length);
      }
    });
  };
  const submit = async () => {
    if ((!prompt.trim() && attachments.length === 0 && pastedTexts.length === 0) || waitingForResponse || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const basePrompt = prompt.trim() || (pastedTexts.length > 0 ? "Please inspect the attached text." : "Please inspect the attached files.");
    // Large pastes ride to the provider as a trailing <pasted_text> block (Synara's
    // appendPastedTextsToPrompt) so the composer card survives the round-trip.
    const sentPrompt = appendPastedTextsToPrompt(basePrompt, pastedTexts);
    const sentAttachments = attachments;
    const selectedModel = models.find((item) => (item.value === "default" ? "" : item.value) === model);
    const supportedEfforts = selectedModel?.supportedEffortLevels ?? [];
    const sentEffort = effort && selectedModel?.supportsEffort && supportedEfforts.includes(effort) ? effort : "";
    setPrompt(""); setAttachments([]); setPastedTexts([]);
    try {
      await onSend(sentPrompt, sentAttachments, model, sentEffort, permission, selectedModel?.contextWindow);
    } finally {
      submitInFlightRef.current = false;
    }
  };
  const addAttachments = (selected: Attachment[]) => {
    setComposerNotice(null);
    setAttachments((current) => [...current, ...selected].filter((file, index, all) => Boolean(file) && all.findIndex((item) => item.path === file.path) === index).slice(0, MAX_ATTACHMENT_COUNT));
  };
  const addFiles = async (files: File[]) => {
    const selected = await Promise.all(files.slice(0, MAX_ATTACHMENT_COUNT).map(async (file) => {
      let path = "";
      try { path = window.maximoDesktop.filePath(file); } catch { path = ""; }
      if (path) return window.maximoDesktop.attachmentFromPath(path);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fallbackName = file.name || `pasted-file-${Date.now()}${file.type === "image/png" ? ".png" : ""}`;
        return window.maximoDesktop.savePastedAttachment(fallbackName, bytes);
      } catch { return null; }
    }));
    addAttachments(selected.filter((file): file is Attachment => Boolean(file)));
  };
  const addPaths = async (paths: string[]) => {
    const selected = await Promise.all(paths.slice(0, MAX_ATTACHMENT_COUNT).map((path) => window.maximoDesktop.attachmentFromPath(path)));
    addAttachments(selected.filter((file): file is Attachment => Boolean(file)));
  };
  const chooseAttachments = async () => addAttachments(await window.maximoDesktop.chooseAttachments());
  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (waitingForResponse) return;
    const files = Array.from(event.dataTransfer.files);
    const paths = files.map((file) => { try { return window.maximoDesktop.filePath(file); } catch { return ""; } }).filter(Boolean);
    if (paths.length) await addPaths(paths);
    const filesWithoutPaths = files.filter((file) => !paths.includes((() => { try { return window.maximoDesktop.filePath(file); } catch { return ""; } })()));
    if (filesWithoutPaths.length) await addFiles(filesWithoutPaths);
  };
  const handlePaste = async (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (waitingForResponse) return;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) {
      for (const item of Array.from(event.clipboardData.items)) {
        const file = item.kind === "file" ? item.getAsFile() : null;
        if (file) files.push(file);
      }
    }
    // Large text pastes collapse into attachment-style cards above the composer
    // (Synara's composerPastedText): 25+ lines or 4000+ chars. Small pastes drop
    // straight into the input as before.
    const plainText = event.clipboardData.getData("text/plain");
    if (files.length === 0 && plainText && shouldCollapsePastedText(plainText)) {
      event.preventDefault();
      const draft = createPastedTextDraft(plainText);
      setComposerNotice(null);
      setPastedTexts((current) => [...current, draft]);
      return;
    }
    if (!files.length) return;
    event.preventDefault();
    await addFiles(files);
  };
  const removePastedText = (id: string) => {
    setPastedTexts((current) => current.filter((pasted) => pasted.id !== id));
  };
  const showPastedTextInField = (id: string) => {
    const pasted = pastedTexts.find((entry) => entry.id === id);
    if (!pasted) return;
    const separator = prompt.length > 0 && !prompt.endsWith("\n") ? "\n" : "";
    const nextPrompt = `${prompt}${separator}${pasted.text}`;
    setPrompt(nextPrompt);
    removePastedText(id);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (editor) {
        renderHighlighted(nextPrompt);
        setCaretOffset(editor, nextPrompt.length);
      }
    });
  };
  const chooseCommand = (command: SlashCommand) => {
    const offset = slashTriggerAt ?? (cursorOffsetState ?? prompt.length);
    const afterInsert = `${prompt.slice(0, offset)}/${command.name} `;
    setPrompt(afterInsert);
    insertionOffsetRef.current = offset + command.name.length + 2;
    setCommandPaletteDismissed(true);
    setCommandIndex(0);
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      renderHighlighted(afterInsert);
      const target = insertionOffsetRef.current ?? afterInsert.length;
      insertionOffsetRef.current = null;
      setCaretOffset(editor, Math.min(target, afterInsert.length));
      editor.focus();
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && !prompt.trim() && attachments.length === 0 && pastedTexts.length === 0) {
      event.preventDefault();
      showComposerNotice("Type a message or attach a file to get started.");
      return;
    }
    if (visibleMenuItems.length > 0 && !commandPaletteDismissed) {
      if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((value) => (value + 1) % visibleMenuItems.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((value) => (value - 1 + visibleMenuItems.length) % visibleMenuItems.length); return; }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey)) { event.preventDefault(); chooseCommand(visibleMenuItems[commandIndex]!); return; }
      if (event.key === "Escape") { event.preventDefault(); setCommandPaletteDismissed(true); return; }
      if (event.key === "Backspace") { return; }
    }
    if (composerKeyAction(event.nativeEvent, settings.sendWithEnter) === "send") { event.preventDefault(); void submit(); }
  };
  const choosePermission = (next: PermissionMode) => {
    if (next === "full" && permission !== "full") setConfirmFullAccess(true);
    else setPermission(next);
  };
  const chooseModel = (next: string) => {
    setModel(next);
    const nextModel = models.find((item) => (item.value === "default" ? "" : item.value) === next);
    const supported = nextModel?.supportedEffortLevels ?? [];
    setEffort((current) => current && supported.includes(current) ? current : nextModel?.defaultEffort ?? "");
  };
  const refreshBranches = async () => {
    if (!project) return;
    setBranchLoading(true);
    setBranchError(null);
    try {
      setBranchInfo(await window.maximoDesktop.gitBranches(project.id));
    } catch (error) {
      setBranchInfo(null);
      setBranchError(error instanceof Error ? error.message : "Unable to read Git branches.");
    } finally {
      setBranchLoading(false);
    }
  };
  const openContext = async (next: "project" | "location" | "branch") => {
    setAddOpen(false);
    const opening = contextOpen !== next;
    setContextOpen(opening ? next : null);
    if (opening && next === "branch") await refreshBranches();
  };
  const checkoutBranch = async (branch: string) => {
    if (!project || branch === branchInfo?.current) return setContextOpen(null);
    try {
      const status = await window.maximoDesktop.gitCheckout(project.id, branch);
      onGitChanged(status);
      setBranchInfo((current) => current ? { ...current, current: status.branch, dirty: !status.clean } : current);
      setContextOpen(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to switch branches.");
    }
  };
  const createBranch = async () => {
    if (!project || !newBranch.trim()) return;
    try {
      const status = await window.maximoDesktop.gitCreateBranch(project.id, newBranch.trim());
      onGitChanged(status);
      setBranchInfo((current) => current ? { ...current, current: status.branch, dirty: !status.clean, branches: [...new Set([...current.branches, status.branch])] } : current);
      setNewBranch("");
      setContextOpen(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to create a branch.");
    }
  };
  const renderSlashMenuItem = (command: SlashMenuItem) => {
    const index = visibleMenuItems.indexOf(command);
    return <button type="button" role="option" aria-selected={index === commandIndex} className={`slash-command-row ${index === commandIndex ? "active" : ""}`} key={`${command.kind}-${command.name}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setCommandIndex(index)} onClick={() => chooseCommand(command)}>
      <span className={`slash-command-icon ${command.kind}`}><SlashCommandIcon name={command.name} kind={command.kind} /></span>
      <strong className="slash-command-label">{slashCommandLabel(command.name)}</strong>
      {command.description ? <small className="slash-command-description">{command.description}</small> : <span className="slash-command-description" />}
      {command.kind === "skill" ? <span className="slash-command-source">Personal</span> : command.argumentHint ? <kbd>{command.argumentHint}</kbd> : <span />}
    </button>;
  };
  const composerPlaceholder = running
    ? "Add context while Maximo works…"
    : thread.messages.some((message) => message.role === "assistant")
      ? "Ask a follow-up…"
      : "Ask Maximo to build, fix, write, or explore…";
  const goalBanner = thread.goal && thread.goal.phase !== "complete"
    ? thread.goal
    : thread.goal?.phase === "complete"
      ? thread.goal
      : null;
  return (
    <div className="composer-wrap">
      {confirmFullAccess && <FullAccessConfirm onCancel={() => setConfirmFullAccess(false)} onConfirm={() => { setPermission("full"); setConfirmFullAccess(false); }} />}
      {goalBanner && (
        <div
          className={`goal-banner glass-panel goal-banner-${goalBanner.phase}`}
          role="status"
          title={goalBanner.statusText}
        >
          <Target size={13} aria-hidden="true" />
          <div className="goal-banner-body">
            <strong>
              {goalBanner.phase === "complete"
                ? "Goal complete"
                : goalBanner.phase === "paused"
                  ? "Goal paused"
                  : "Goal active"}
            </strong>
            <span>{goalBanner.statusText}</span>
          </div>
          <small className="goal-banner-hint">/goal status · pause · resume · clear</small>
        </div>
      )}
      <LiveWorkStatus running={running} waiting={waitingForResponse} live={live} shimmer={false} />
      {queuedFollowUps.length > 0 && (
        <div className="followup-queue" aria-label="Queued follow-ups">
          {queuedFollowUps.map((item) => (
            <div className="followup-chip" key={item.id}>
              <Clock3 size={11} className="followup-chip-icon" aria-hidden="true" />
              <p className="followup-chip-text" title={item.prompt}>{item.prompt}</p>
              {item.attachments.length > 0 && <span className="followup-chip-meta">{item.attachments.length}</span>}
              <button type="button" className="followup-chip-btn" title="Edit" onClick={() => applyQueuedEdit(item)}><FilePenLine size={12} /></button>
              <button type="button" className="followup-chip-btn" title="Remove" onClick={() => onRemoveQueuedFollowUp?.(item.id)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {permission === "full" && !settings.hideFullAccessWarning && !warningDismissed && <div className="full-access-notice glass-panel">
        <ShieldAlert size={15} /><div><strong>Full access is on</strong><span>Maximo can edit any file and run commands with internet access without approval.</span></div>
        <button type="button" onClick={() => void onSettingsChanged({ hideFullAccessWarning: true })}>Don’t show again</button>
        <button type="button" className="notice-close" onClick={() => setWarningDismissed(true)} aria-label="Dismiss warning"><X size={13} /></button>
      </div>}
      {waitingForResponse && (
        <div className="pending-interaction-card">
          {pendingQuestion ? <QuestionModal questions={pendingQuestion.questions} onSubmit={onSubmitAnswers} onSkip={onSkipQuestion} />
            : pendingPermission ? <PermissionRequestModal request={pendingPermission.payload} onApprove={onApprovePermission} onDeny={onDenyPermission} />
            : null}
        </div>
      )}
      {!waitingForResponse && <div className={`composer glass-panel ${running ? "running" : ""} ${dragActive ? "drop-active" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target || !event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }} onDrop={(event) => void handleDrop(event)} onPaste={(event) => void handlePaste(event)}>
         {dragActive && <div className="drop-overlay"><Paperclip size={20} /><strong>Drop files to attach</strong><small>Images, documents, and code files up to 25 MB</small></div>}
         {thread.messages.length === 0 && project && <div className="composer-context">
          <button type="button" onClick={() => void openContext("project")}><FolderOpen size={13} />{project.name}<ChevronDown size={10} /></button>
          <button type="button" onClick={() => void openContext("location")}><HardDrive size={13} />Local<ChevronDown size={10} /></button>
          {git?.isRepository && <button type="button" onClick={() => void openContext("branch")}><GitBranch size={13} />{git.branch}<ChevronDown size={10} /></button>}
          {contextOpen === "project" && <div className="context-menu project-context-menu glass-panel"><strong>{project.name}</strong><small>{project.path}</small><button onClick={() => void window.maximoDesktop.openInEditor(project.path)}><Code2 size={13} />Open in editor</button><button onClick={() => void window.maximoDesktop.revealPath(project.path)}><FolderOpen size={13} />Show in Files</button><button onClick={onOpenProject}><Folder size={13} />Open another project…</button></div>}
          {contextOpen === "location" && <div className="context-menu location-context-menu glass-panel"><span className="menu-label">Start in</span><button className="selected"><HardDrive size={13} /><span><strong>Work locally</strong><small>Use this computer and project folder</small></span><Check size={13} /></button><button onClick={onAccountUsage}><Gauge size={13} /><span><strong>Usage remaining</strong><small>View live plan limits</small></span><ChevronRight size={13} /></button></div>}
          {contextOpen === "branch" && <div className="context-menu branch-context-menu glass-panel"><span className="menu-label">Branches</span>{branchLoading ? <div className="branch-state"><RefreshCw size={12} className="spin" />Reading local branches</div> : branchError ? <div className="branch-state error">{branchError}<button type="button" onClick={() => void refreshBranches()}>Retry</button></div> : branchInfo?.dirty ? <small className="branch-dirty">Uncommitted changes are preserved when Git allows the switch.</small> : null}{!branchLoading && !branchError && branchInfo?.branches.length === 0 && <div className="branch-state">No local branches found</div>}{!branchLoading && !branchError && branchInfo?.branches.map((branch) => <button type="button" className={branch === branchInfo.current ? "selected" : ""} onClick={() => void checkoutBranch(branch)} key={branch}><GitBranch size={13} /><span>{branch}</span>{branch === branchInfo.current && <Check size={13} />}</button>)}<div className="branch-create"><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createBranch(); }} placeholder="New branch name" /><button type="button" onClick={() => void createBranch()} disabled={!newBranch.trim() || branchLoading}><Plus size={13} /></button></div></div>}
        </div>}
        {attachments.length > 0 && <AttachmentList attachments={attachments} onPreview={onPreviewAttachment} onRemove={(file) => setAttachments((items) => items.filter((item) => item.path !== file.path))} className="attachment-strip" />}
        {pastedTexts.length > 0 && <div className="pasted-text-strip">{pastedTexts.map((pasted) => (
          <div className="pasted-text-card" key={pasted.id}>
            <span className="pasted-text-card-icon"><File size={13} /></span>
            <span className="pasted-text-card-copy">
              <strong title={pastedTextTitle(pasted.text)}>{pastedTextTitle(pasted.text)}</strong>
              <small>{formatPastedTextCountLabel(pasted)}</small>
            </span>
            <button type="button" className="pasted-text-card-action" onMouseDown={(event) => event.preventDefault()} onClick={() => showPastedTextInField(pasted.id)}>Show in text field<ChevronRight size={11} /></button>
            <button type="button" className="pasted-text-card-remove" onClick={() => removePastedText(pasted.id)} aria-label={`Remove pasted text (${formatPastedTextCountLabel(pasted)})`} title={`Remove pasted text (${formatPastedTextCountLabel(pasted)})`}><X size={12} /></button>
          </div>
        ))}</div>}
        {commandPaletteOpen && <div className="slash-command-menu glass-panel" role="listbox" aria-label="Slash commands">
          {visibleSkills.length > 0 && <section className="slash-command-section"><div className="slash-command-heading">Skills</div>{visibleSkills.map(renderSlashMenuItem)}</section>}
          {visibleSlashCommands.length > 0 && <section className="slash-command-section"><div className={`slash-command-heading ${visibleSkills.length > 0 ? "visible" : "hidden"}`}>Commands</div>{visibleSlashCommands.map(renderSlashMenuItem)}</section>}
          {visibleMenuItems.length === 0 && <div className="slash-command-empty" role="status"><span className="slash-command-icon"><Command size={15} aria-hidden="true" /></span><span><strong>No matches</strong><small>Try another command or skill name.</small></span></div>}
         </div>}
         <div className="composer-input-wrap">
           {!prompt && <span className="composer-placeholder" aria-hidden="true">{composerPlaceholder}</span>}
           <div ref={editorRef} className="composer-input" contentEditable={!waitingForResponse} spellCheck={false} suppressContentEditableWarning role="textbox" aria-multiline="true" data-empty={prompt.length === 0 ? "true" : "false"} data-placeholder={composerPlaceholder}
             onInput={(event) => {
               const text = event.currentTarget.textContent ?? "";
               const meaningfulText = /[^\s\u200B\uFEFF]/.test(text) ? text : "";
               setPrompt(meaningfulText);
               setComposerNotice(null);
               setCursorOffsetState(null);
               setCommandPaletteDismissed(false);
               setCommandIndex(0);
             }}
            onKeyDown={onKeyDown}
            onPaste={(event) => { if (event.clipboardData.files.length > 0) return; const text = event.clipboardData.getData("text/plain"); if (shouldCollapsePastedText(text)) { event.preventDefault(); event.stopPropagation(); void handlePaste(event); } }}
            onSelect={() => { if (!commandPaletteDismissed) setCommandPaletteDismissed(false); }}
             onBlur={() => { setCursorOffsetState(null); }} />
         </div>
         {composerNotice && <div className="composer-input-warning" role="status">{composerNotice}</div>}
         <div className="composer-controls">
          <div className="composer-left">
            <div className="add-control"><button className="icon-button add-button" onClick={() => { setContextOpen(null); setAddOpen((value) => !value); }} title="Add" disabled={waitingForResponse}><Plus size={17} /></button>{addOpen && <div className="add-menu glass-panel"><span className="menu-label">Add</span><button onClick={() => { setAddOpen(false); void chooseAttachments(); }}><Paperclip size={14} /><span><strong>Files and folders</strong><small>Add useful local context</small></span></button><button onClick={() => { setAddOpen(false); onOpenProject(); }}><FolderOpen size={14} /><span><strong>Work in a project</strong><small>Open another local folder</small></span></button><button onClick={() => { setPermission("plan"); setAddOpen(false); }}><Sparkles size={14} /><span><strong>Plan mode</strong><small>Inspect and plan before editing</small></span></button></div>}</div>
            <CustomSelect value={permission} options={permissionOptions} onChange={choosePermission} icon={permission === "full" ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />} disabled={waitingForResponse} placement="top" ariaLabel="Permission mode" className={`select-pill permission-select permission-${permission}`} />
          </div>
          <div className="composer-right">
            <ContextUsageControl usage={contextUsage} loading={contextLoading} onRefresh={onRefreshContext} />
            <ModelControl model={model} effort={effort} models={models} modelOptions={modelOptions} disabled={waitingForResponse} onModel={chooseModel} onEffort={setEffort} />
            {running && !prompt.trim() && pastedTexts.length === 0 ? <button className="send-button stop" onClick={onStop} title="Stop run"><CircleStop size={16} /></button> : <button className="send-button" onClick={() => void submit()} disabled={!prompt.trim() && attachments.length === 0 && pastedTexts.length === 0} title={running ? "Add context to current task" : "Send"}><ArrowUp size={17} /></button>}
           </div>
         </div>
       </div>
      }
      {!waitingForResponse && <div className="composer-hint">{running ? "Added context is sent before the next tool or turn" : settings.sendWithEnter ? "Press Enter to send · press Shift+Enter for a new line" : `Press Enter for a new line · press ${sendShortcutLabel} to send`}</div>}
    </div>
  );
}

function Inspector({ project, thread, live, git, reviewFile, reviewDiff, onRefresh, onReveal, onEditor, onFileClick, onCloseReview, onResize }: {
  project?: Project; thread?: Thread; live?: LiveRun; git: GitStatus | null; reviewFile?: string | null; reviewDiff: GitDiff | null;
  onRefresh: () => void; onReveal: () => void; onEditor: () => void; onFileClick: (path: string) => void; onCloseReview: () => void; onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const [changesOpen, setChangesOpen] = useState(true);
  const [localOpen, setLocalOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const changedFiles = git?.files ?? [];
  const latestAssistant = [...(thread?.messages ?? [])].reverse().find((message) => message.role === "assistant");
  const agentTimeline: WorkTimelineEntry[] = live
    ? live.timeline
    : latestAssistant?.timeline ?? latestAssistant?.activity?.map((item) => ({ type: "activity" as const, ...item })) ?? [];
  const agents = agentRunsFromEntries(agentTimeline);
  const recentActivities = live?.activity.filter((item) => !isAgentActivity(item)).slice(-8).reverse() ?? [];

  if (reviewFile && project) return (
    <aside className="inspector inspector-review glass-panel">
      <DiffReview project={project} diff={reviewDiff} onBack={onCloseReview} onOpenEditor={() => void window.maximoDesktop.openInEditor(resolveProjectFile(project.path, reviewFile))} />
       <div className="resize-handle resize-handle-inspector" role="separator" aria-orientation="vertical" aria-label="Resize inspector" onPointerDown={onResize} />
    </aside>
  );

  return (
    <aside className="inspector glass-panel">
      <div className="inspector-scroll">
        <div className="inspector-project-header">
          <strong title={project?.name}>{project?.name ?? "Project"}</strong>
          <button type="button" onClick={onRefresh} title="Refresh project status"><RefreshCw size={13} /></button>
        </div>
        <button type="button" className="path-button" onClick={onReveal}><Folder size={13} /><span>{project?.path ?? "No project selected"}</span></button>
        <div className="quick-actions"><button type="button" onClick={onEditor}><Code2 size={14} />Editor</button><button type="button" onClick={onReveal}><FolderOpen size={14} />Files</button></div>

        <div className="inspector-codex-section">
          <button type="button" className="inspector-codex-row" onClick={() => setChangesOpen((value) => !value)} aria-expanded={changesOpen}>
            <FileCode2 size={15} /><span>Changes</span>{git?.isRepository && <span className="row-count"><b>+{git.additions}</b> <i>-{git.deletions}</i></span>}<ChevronDown size={13} className={changesOpen ? "row-chevron open" : "row-chevron"} />
          </button>
          {changesOpen && <div className="inspector-changes">
            {!git ? <div className="subtle-line"><RefreshCw size={13} className="spin" />Reading Git status</div> : !git.isRepository ? <div className="subtle-line">Not a Git repository</div> : <>
              <div className="branch-line"><GitBranch size={14} /><span>{git.branch || "detached"}</span><small>{git.clean ? "Clean" : `${changedFiles.length} changed`}</small></div>
              <div className="changed-files">{changedFiles.slice(0, 16).map((file) => <button type="button" key={file.path} onClick={() => onFileClick(file.path)} title={`Review ${file.path}`}><span className={`file-status status-${file.status[0]}`}>{file.status}</span><span>{file.path}</span>{file.additions + file.deletions > 0 && <small><b>+{file.additions}</b> <i>-{file.deletions}</i></small>}<ChevronRight size={11} /></button>)}{changedFiles.length > 16 && <div className="more-files">+ {changedFiles.length - 16} more files</div>}{git.clean && <div className="subtle-line">Working tree is clean</div>}</div>
            </>}
          </div>}
          <button type="button" className="inspector-codex-row" onClick={() => setLocalOpen((value) => !value)} aria-expanded={localOpen}><HardDrive size={15} /><span>Local</span><ChevronDown size={13} className={localOpen ? "row-chevron open" : "row-chevron"} /></button>
          {localOpen && <button type="button" className="inspector-subrow" onClick={onReveal}><FolderOpen size={13} /><span>{project?.path ?? "No project folder"}</span></button>}
          <button type="button" className="inspector-codex-row" onClick={() => setBranchOpen((value) => !value)} aria-expanded={branchOpen}><GitBranch size={15} /><span>{git?.branch || "main"}</span><ChevronDown size={13} className={branchOpen ? "row-chevron open" : "row-chevron"} /></button>
          {branchOpen && <div className="inspector-subrow inspector-subrow-copy"><GitBranch size={13} /><span>{git?.isRepository ? "Current local branch" : "Git branch unavailable"}</span></div>}
          <div className="inspector-codex-row inspector-row-static"><Wrench size={15} /><span>Commit or push</span><small>{git?.clean ? "No changes" : "Local changes"}</small></div>
          <div className="inspector-codex-row inspector-row-static"><GitBranch size={15} /><span>Pull request status</span><small>Unavailable</small></div>
          <button type="button" className="inspector-codex-row" onClick={onRefresh}><GitBranch size={15} /><span>Compare branch</span><ChevronRight size={13} /></button>
        </div>

        <div className="inspector-section activity-panel">
          <div className="inspector-title"><span>Activity</span><span className={`run-badge ${thread?.status === "running" ? "running" : thread?.unread ? "unread" : (thread?.status ?? "idle")}`}>{thread?.status === "running" ? "running" : thread?.unread ? "done (unread)" : (thread?.status ?? "idle")}</span></div>
          <AgentStatusList agents={agents} />
          <div className="activity-list">
            {recentActivities.length ? recentActivities.map((item, index) => <div className="activity-item" key={`${item.timestamp}-${index}`}><span><ToolIcon toolName={item.toolName} label={item.label} /></span><div><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</div></div>) : agents.length === 0 ? <div className="subtle-line">Run details will appear here.</div> : null}
            {live?.logs.slice(-3).map((item, index) => <div className={`log-item ${item.level}`} key={`${item.timestamp}-${index}`}>{item.text}</div>)}
          </div>
        </div>
      </div>
       <div className="resize-handle resize-handle-inspector" role="separator" aria-orientation="vertical" aria-label="Resize inspector" onPointerDown={onResize} />
    </aside>
  );
}

function SettingsModal({ state, engine, models, modelOptions, account, usage, appVersion, onClose, onSave, onRepair, onAccount, onUsage }: { state: AppState; engine: EngineStatus | null; models: EngineModel[]; modelOptions: SelectOption<string>[]; account: AccountStatus | null; usage: UsageSnapshot | null; appVersion: string; onClose: () => void; onSave: (patch: Partial<AppState["settings"]>) => Promise<void>; onRepair: () => Promise<void>; onAccount: () => void; onUsage: () => void }) {
  const [values, setValues] = useState(state.settings);
  const [section, setSection] = useState<"general" | "appearance" | "defaults" | "account" | "engine">("general");
  const [search, setSearch] = useState("");
  useEffect(() => {
    setValues((current) => ({ ...current, defaultModel: state.settings.defaultModel, defaultEffort: state.settings.defaultEffort }));
  }, [state.settings.defaultEffort, state.settings.defaultModel]);
  const selectedModel = models.find((item) => (item.value === "default" ? "" : item.value) === values.defaultModel);
  const sendShortcutLabel = composerSendShortcutLabel();
  const sections = [
    { id: "general" as const, group: "Personal", label: "General", description: "Workspace defaults and safety reminders.", icon: <Settings size={14} /> },
    { id: "appearance" as const, group: "Personal", label: "Appearance", description: "Theme and interface visual language.", icon: <Sun size={14} /> },
    { id: "defaults" as const, group: "Coding", label: "Chat defaults", description: "Model, reasoning effort, and permissions.", icon: <SlidersHorizontal size={14} /> },
    { id: "account" as const, group: "Integrations", label: "Account & usage", description: "Signed-in provider and usage limits.", icon: <Gauge size={14} /> },
    { id: "engine" as const, group: "System", label: "Syntax CLI", description: "Engine health and local CLI configuration.", icon: <TerminalSquare size={14} /> },
  ].filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (values.defaultPermission === "full" && state.settings.defaultPermission !== "full" && !window.confirm("Make Full access the default for every new chat? Commands and edits can run without approval prompts.")) return;
    await onSave(values); onClose();
  };
  return (
    <form className="settings-page" onSubmit={submit}>
      <div className="settings-page-topbar drag-region" aria-hidden="true" />
      <aside className="settings-page-sidebar">
        <button type="button" className="settings-back" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Back to chats"><ArrowLeft size={14} />Back to chats</button>
        <label className="settings-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings…" /></label>
         <nav className="settings-section-nav">{["Personal", "Integrations", "Coding", "System"].map((group) => { const items = sections.filter((item) => item.group === group); return items.length ? <div className="settings-nav-group" key={group}><span className="settings-group-label">{group}</span>{items.map((item) => <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}>{item.icon}<span>{item.label}</span></button>)}</div> : null; })}</nav>
        <div className="settings-sidebar-foot"><Logo compact /><span><strong>Maximo Syntax</strong><small>Desktop {appVersion || "—"}{engine?.version ? ` · CLI ${engine.version}` : ""}</small></span></div>
      </aside>
      <main className="settings-page-main">
        <div className="settings-page-content">
           <header><span className="eyebrow">MAXIMO SYNTAX</span><h1>{sections.find((item) => item.id === section)?.label ?? "Settings"}</h1><p className="settings-page-description">{sections.find((item) => item.id === section)?.description ?? "Configure your desktop workspace."}</p></header>
          {section === "general" && <div className="settings-panel-stack">
            <section className="settings-card"><h2>Workspace</h2><label className="settings-row"><span><strong>Open workspace dock by default</strong><small>Keep files, Git, terminal, browser, and review tools visible on the right.</small></span><input type="checkbox" checked={values.showInspector} onChange={(event) => setValues({ ...values, showInspector: event.target.checked })} /></label></section>
            <section className="settings-card composer-settings-card"><h2>Message composer</h2><p>Choose what the Enter key does while you write a message.</p><div className="settings-choice-list" role="radiogroup" aria-label="Message send behavior">
              <label className={`settings-choice ${values.sendWithEnter ? "active" : ""}`}><input type="radio" name="send-behavior" checked={values.sendWithEnter} onChange={() => setValues({ ...values, sendWithEnter: true })} /><span className="settings-choice-indicator" aria-hidden="true" /><span className="settings-choice-copy"><strong>Enter sends</strong><small>Press Enter to send · press Shift+Enter for a new line</small></span><kbd>Enter</kbd></label>
              <label className={`settings-choice ${!values.sendWithEnter ? "active" : ""}`}><input type="radio" name="send-behavior" checked={!values.sendWithEnter} onChange={() => setValues({ ...values, sendWithEnter: false })} /><span className="settings-choice-indicator" aria-hidden="true" /><span className="settings-choice-copy"><strong>Enter makes a new line</strong><small>Press Enter for a new line · press {sendShortcutLabel} to send</small></span><kbd>{sendShortcutLabel}</kbd></label>
            </div></section>
             <section className="settings-card"><h2>Safety</h2><label className="settings-row"><span><strong>Show Full Access warning</strong><small>Keep the elevated-access reminder above the composer.</small></span><input type="checkbox" checked={!values.hideFullAccessWarning} onChange={(event) => setValues({ ...values, hideFullAccessWarning: !event.target.checked })} /></label></section>
             <section className="settings-card"><h2>About</h2><div className="settings-row"><span><strong>Maximo Syntax Desktop</strong><small>Installed desktop application version.</small></span><span className="setting-value">{appVersion || "Unknown"}</span></div></section>
           </div>}
          {section === "appearance" && <div className="settings-panel-stack"><section className="settings-card"><h2>Theme</h2><p>Use your system appearance or keep Maximo Syntax in one mode.</p><div className="theme-choice-grid">{(["system", "light", "dark"] as ThemeMode[]).map((theme) => <button type="button" className={values.theme === theme ? "active" : ""} onClick={() => setValues({ ...values, theme })} key={theme}><span className={`theme-mini-preview ${theme}`}><i /><i /><i /></span><strong>{theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}</strong>{values.theme === theme && <Check size={13} />}</button>)}</div></section><section className="settings-card"><h2>Interface</h2><div className="settings-row"><span><strong>Typography</strong><small>Space Grotesk headings with Manrope throughout the interface.</small></span><span className="setting-value">Maximo default</span></div><div className="settings-row"><span><strong>Motion</strong><small>Automatically follows the operating system’s reduced-motion preference.</small></span><span className="setting-value">System</span></div></section></div>}
           {section === "defaults" && <div className="settings-panel-stack"><section className="settings-card"><h2>New chats</h2><div className="settings-row"><span><strong>Model</strong><small>Loaded from your active provider account.</small></span><CustomSelect value={values.defaultModel} options={modelOptions} onChange={(defaultModel) => setValues({ ...values, defaultModel, defaultEffort: "" })} ariaLabel="Default model" className="settings-select" /></div>{selectedModel?.supportsEffort && <div className="settings-row"><span><strong>Reasoning effort</strong><small>Used for new chats with the selected model.</small></span><CustomSelect value={values.defaultEffort} options={effortOptionsFor(selectedModel)} onChange={(defaultEffort) => setValues({ ...values, defaultEffort })} ariaLabel="Default reasoning effort" className="settings-select" /></div>}<div className="settings-row"><span><strong>Permissions</strong><small>Choose the default approval behavior for new chats.</small></span><CustomSelect value={values.defaultPermission} options={permissionOptions} onChange={(defaultPermission) => setValues({ ...values, defaultPermission })} ariaLabel="Default permissions" className="settings-select" /></div></section></div>}
          {section === "account" && <div className="settings-panel-stack"><section className="settings-card"><h2>Signed in account</h2><div className="settings-account-row"><span className={`account-state ${account?.loggedIn ? "online" : ""}`}><UserRound size={16} /></span><span><strong>{account?.email || account?.displayName || "Not signed in"}</strong><small>{accountDetailText(account)}</small></span><button type="button" onClick={onAccount}>Manage account</button></div></section><section className="settings-card"><h2>Usage & billing</h2><div className="settings-row"><span><strong>{usage?.planName || "Current plan usage"}</strong><small>{usage ? usage.message || `${usage.limits.length} live usage limit${usage.limits.length === 1 ? "" : "s"}` : "View limits and reset times without leaving the app."}</small></span><button type="button" className="settings-action" onClick={onUsage}>{usage ? "Refresh usage" : "View usage"}</button></div>{usage?.limits.map((limit) => <div className="settings-usage-row" key={limit.id}><span>{limit.label}</span><div><i style={{ width: `${limit.utilization ?? 0}%` }} /></div><strong>{limit.utilization === null ? "—" : `${Math.round(limit.utilization)}%`}</strong></div>)}</section></div>}
           {section === "engine" && <div className="settings-panel-stack"><section className="settings-card"><h2>Maximo Syntax CLI</h2><div className="engine-settings"><div><span className={`engine-dot ${engine?.phase ?? "checking"}`} /><p><strong>{engine?.available ? `Ready · ${engine.version}` : "Needs attention"}</strong><small>{engine?.message}{engine?.available && engine?.latestVersion ? (engine?.version === engine?.latestVersion ? " Up to date with the latest CLI." : ` Latest available: ${engine.latestVersion}.`) : ""}</small></p></div><button type="button" onClick={() => void onRepair()}><RefreshCw size={13} />Repair / update</button></div><label className="settings-engine-path"><span><strong>Custom CLI path</strong><small>Optional. The securely bundled CLI is used automatically.</small></span><input value={values.cliPath} onChange={(event) => setValues({ ...values, cliPath: event.target.value })} placeholder="/path/to/maximo-syntax-cli" /></label></section></div>}
        </div>
        <footer className="settings-page-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button compact" type="submit">Save changes</button></footer>
      </main>
    </form>
  );
}

type ProfileMeta = { name: string; handle: string; avatarColor: string };

const DEFAULT_PROFILE_AVATAR = "#5dc86b";

function profileDateKey(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function profileCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return Math.round(value).toLocaleString();
}

function profileProviderForModel(model: string, account: AccountStatus | null): string {
  const normalized = model.toLowerCase();
  if (normalized.includes("kilo")) return "Kilo";
  if (normalized.includes("claude") || normalized.includes("anthropic")) return "Claude";
  if (normalized.includes("codex") || normalized.includes("gpt") || normalized.includes("openai")) return "Codex";
  if (normalized.includes("cursor")) return "Cursor";
  if (normalized.includes("grok") || normalized.includes("xai")) return "Grok";
  if (normalized.includes("opencode")) return "OpenCode";
  return account?.loggedIn ? providerLabel(account) : "Maximo AI";
}

function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? "M"}${words.at(-1)?.[0] ?? "X"}`.toUpperCase();
  return (words[0]?.slice(0, 2) || "MX").toUpperCase();
}

function profileStreaks(activityDates: ReadonlySet<string>): { current: number; longest: number } {
  const dates = [...activityDates].sort();
  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const value of dates) {
    const date = new Date(`${value}T00:00:00`);
    if (previous && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cursor = new Date(today);
  if (!activityDates.has(profileDateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let current = 0;
  while (activityDates.has(profileDateKey(cursor.getTime()))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current, longest };
}

function ProfileStatsPanel({ state, account, models, skills }: { state: AppState; account: AccountStatus | null; models: EngineModel[]; skills: SlashCommand[] }) {
  const accountName = account?.displayName || account?.email?.split("@")[0] || "Maximo user";
  const defaultHandle = account?.email ? `@${account.email.split("@")[0]}` : "@maximo-user";
  const [meta, setMeta] = useState<ProfileMeta>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("maximo-syntax:profile:v1") ?? "null") as Partial<ProfileMeta> | null;
      return {
        name: typeof saved?.name === "string" && saved.name.trim() ? saved.name : accountName,
        handle: typeof saved?.handle === "string" && saved.handle.trim() ? saved.handle : defaultHandle,
        avatarColor: typeof saved?.avatarColor === "string" ? saved.avatarColor : DEFAULT_PROFILE_AVATAR,
      };
    } catch {
      return { name: accountName, handle: defaultHandle, avatarColor: DEFAULT_PROFILE_AVATAR };
    }
  });
  const [draft, setDraft] = useState(meta);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<{ date: Date; tokens: number; activities: number; rect: DOMRect } | null>(null);
  const messages = state.threads.flatMap((thread) => thread.messages.map((message) => ({ thread, message })));
  const userMessages = messages.filter(({ message }) => message.role === "user");
  const promptCount = userMessages.length;
  const activityByDay = new Map<string, number>();
  const promptCountByDay = new Map<string, number>();
  const promptDays = new Set<string>();
  const hourCounts = new Map<number, number>();
  const projectCounts = new Map<string, number>();
  const effortCounts = new Map<string, number>();
  const modelPromptCounts = new Map<string, number>();
  const skillCounts = new Map<string, number>();
  const knownSkills = new Set(skills.map((skill) => skill.name.toLowerCase()));
  for (const { thread, message } of userMessages) {
    const day = profileDateKey(message.createdAt);
    promptDays.add(day);
    promptCountByDay.set(day, (promptCountByDay.get(day) ?? 0) + 1);
    activityByDay.set(day, (activityByDay.get(day) ?? 0) + 1);
    hourCounts.set(new Date(message.createdAt).getHours(), (hourCounts.get(new Date(message.createdAt).getHours()) ?? 0) + 1);
    projectCounts.set(thread.projectId, (projectCounts.get(thread.projectId) ?? 0) + 1);
    if (thread.effort) effortCounts.set(thread.effort, (effortCounts.get(thread.effort) ?? 0) + 1);
    const model = message.model || thread.model || "CLI default";
    modelPromptCounts.set(model, (modelPromptCounts.get(model) ?? 0) + 1);
    for (const match of message.content.matchAll(/(^|\s)\/([a-zA-Z][a-zA-Z0-9:_-]*)/g)) {
      const skill = match[2]?.toLowerCase();
      if (skill && (knownSkills.size === 0 || knownSkills.has(skill))) skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
    }
  }
  const profile = state.profile ?? ({ totalTokens: 0, dailyTokens: {}, modelTokens: {}, threadTokenTotals: {} } satisfies ProfileUsage);
  const fallbackTokens = state.threads.reduce((sum, thread) => sum + (thread.contextUsage?.totalProcessedTokens ?? 0), 0);
  const derivedDailyTokens: Record<string, number> = { ...profile.dailyTokens };
  if (Object.keys(derivedDailyTokens).length === 0) {
    for (const thread of state.threads) {
      const tokens = thread.contextUsage?.totalProcessedTokens ?? 0;
      if (tokens > 0) {
        const day = profileDateKey(thread.updatedAt);
        derivedDailyTokens[day] = (derivedDailyTokens[day] ?? 0) + tokens;
      }
    }
  }
  const lifetimeTokens = profile.totalTokens || fallbackTokens;
  if (Object.keys(derivedDailyTokens).length === 0 && lifetimeTokens > 0) {
    const latestActivity = Math.max(...state.threads.map((thread) => thread.updatedAt), Date.now());
    derivedDailyTokens[profileDateKey(latestActivity)] = lifetimeTokens;
  }
  for (const [day, tokens] of Object.entries(derivedDailyTokens)) activityByDay.set(day, (activityByDay.get(day) ?? 0) + Math.max(1, Math.round(tokens / 10_000)));
  const activityDates = new Set(activityByDay.keys());
  const streaks = profileStreaks(activityDates);
  const peakDay = Math.max(0, ...Object.values(derivedDailyTokens));
  const topHour = [...hourCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  const topProject = [...projectCounts.entries()].sort((left, right) => right[1] - left[1])[0];
  const topEffort = [...effortCounts.entries()].sort((left, right) => right[1] - left[1])[0];
  const modelRows = Object.entries(profile.modelTokens).length > 0
    ? Object.entries(profile.modelTokens).sort((left, right) => right[1] - left[1]).map(([model, value]) => ({ model, value }))
    : [...modelPromptCounts.entries()].sort((left, right) => right[1] - left[1]).map(([model, value]) => ({ model, value }));
  const currentModelLabel = state.settings.defaultModel
    || models.find((model) => model.isCurrent)?.displayName
    || models.find((model) => model.value === "default")?.displayName
    || "Current provider model";
  const resolvedModelRows = modelRows.reduce<Array<{ model: string; value: number }>>((rows, row) => {
    const model = row.model.toLowerCase() === "cli default" || row.model.toLowerCase() === "default" ? currentModelLabel : row.model;
    const existing = rows.find((candidate) => candidate.model === model);
    if (existing) existing.value += row.value;
    else rows.push({ model, value: row.value });
    return rows;
  }, []);
  const modelTotal = resolvedModelRows.reduce((sum, row) => sum + row.value, 0);
  const safeModelTotal = Math.max(1, modelTotal);
  const days = Array.from({ length: 365 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (364 - index));
    return date;
  });
  const leadingCells = days[0]?.getDay() ?? 0;
  const heatmapCells: Array<Date | null> = [...Array.from({ length: leadingCells }, () => null), ...days];
  const maxActivity = Math.max(1, ...[...activityByDay.values()]);
  const monthLabels = days.flatMap((date, index) => date.getDate() === 1 || index === 0 ? [{ label: date.toLocaleDateString([], { month: "short" }), column: Math.floor((leadingCells + index) / 7) + 1 }] : []);
  const saveProfile = () => {
    const next = { name: draft.name.trim() || accountName, handle: draft.handle.trim() || defaultHandle, avatarColor: draft.avatarColor };
    setMeta(next);
    setEditing(false);
    try { window.localStorage.setItem("maximo-syntax:profile:v1", JSON.stringify(next)); } catch { /* local profile is best effort */ }
  };
  const shareProfile = async () => {
    const summary = `${meta.name} ${meta.handle}\n${profileCompactNumber(lifetimeTokens)} lifetime tokens · ${promptCount} prompts · ${state.projects.length} projects`;
    try {
      await navigator.clipboard.writeText(summary);
      setNotice("Profile summary copied");
      window.setTimeout(() => setNotice(null), 2_000);
    } catch {
      setNotice("Clipboard access unavailable");
    }
  };
  const topProvider = resolvedModelRows[0] ? profileProviderForModel(resolvedModelRows[0].model, account) : account?.loggedIn ? providerLabel(account) : "-";
  return <div className="profile-settings-panel">
    <div className="profile-settings-actions"><button type="button" className="settings-action" onClick={() => void shareProfile()}><Share2 size={13} />Share</button><button type="button" className="settings-action" onClick={() => { setDraft(meta); setEditing((value) => !value); }}><Pencil size={13} />{editing ? "Close" : "Edit"}</button></div>
    {editing && <section className="profile-edit-card"><label><span>Name</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Handle</span><input value={draft.handle} onChange={(event) => setDraft((current) => ({ ...current, handle: event.target.value }))} /></label><div><span className="profile-edit-label">Avatar color</span><div className="profile-color-options">{["#5dc86b", "#4f8ed8", "#8b5cf6", "#d97706", "#db2777"].map((color) => <button type="button" aria-label={`Use ${color} avatar color`} className={draft.avatarColor === color ? "selected" : ""} style={{ background: color }} onClick={() => setDraft((current) => ({ ...current, avatarColor: color }))} key={color} />)}</div></div><button type="button" className="primary-button compact" onClick={saveProfile}>Save profile</button></section>}
    <header className="profile-settings-identity"><span className="profile-avatar" style={{ background: meta.avatarColor }}>{profileInitials(meta.name)}</span><div><h2>{meta.name}</h2><p>{meta.handle}<span aria-hidden="true"> · </span><span className="profile-badge">Maximo</span></p></div></header>
    {notice && <p className="profile-notice" role="status">{notice}</p>}
    <div className="profile-stat-grid"><div><strong>{profileCompactNumber(lifetimeTokens)}</strong><span>Lifetime tokens</span></div><div><strong>{profileCompactNumber(peakDay)}</strong><span>Peak day</span></div><div><strong>{promptCount.toLocaleString()}</strong><span>Total prompts</span></div><div><strong>{streaks.current} {streaks.current === 1 ? "day" : "days"}</strong><span>Current streak</span></div><div><strong>{streaks.longest} {streaks.longest === 1 ? "day" : "days"}</strong><span>Longest streak</span></div></div>
    <section className="profile-section"><h3>Activity</h3><div className="profile-heatmap-wrap"><div className="profile-heatmap-months">{monthLabels.map((item) => <span style={{ gridColumn: item.column }} key={`${item.label}-${item.column}`}>{item.label}</span>)}</div><div className="profile-heatmap" onMouseLeave={() => setHoveredDay(null)}>{heatmapCells.map((date, index) => { const dayKey = date ? profileDateKey(date.getTime()) : ""; const value = date ? activityByDay.get(dayKey) ?? 0 : 0; const level = value === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((value / maxActivity) * 4))); return <span className={`profile-heatmap-cell level-${level}`} onMouseEnter={(event) => date && setHoveredDay({ date, tokens: derivedDailyTokens[dayKey] ?? 0, activities: promptCountByDay.get(dayKey) ?? 0, rect: event.currentTarget.getBoundingClientRect() })} key={`${date?.toISOString() ?? "empty"}-${index}`} />; })}</div></div>{hoveredDay && createPortal(<div className="profile-heatmap-tooltip profile-heatmap-tooltip-fixed" style={{ left: Math.min(window.innerWidth - 12, Math.max(12, hoveredDay.rect.left + hoveredDay.rect.width / 2)), top: hoveredDay.rect.top < 100 ? hoveredDay.rect.bottom + 9 : hoveredDay.rect.top - 9, transform: hoveredDay.rect.top < 100 ? "translate(-50%, 0)" : "translate(-50%, -100%)" }}><strong>{hoveredDay.date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</strong><span><b>{profileCompactNumber(hoveredDay.tokens)}</b> tokens</span><span><b>{hoveredDay.activities}</b> {hoveredDay.activities === 1 ? "activity" : "activities"}</span></div>, document.body)}</section>
    <div className="profile-insights-grid"><section className="profile-section"><h3>Activity insights</h3><dl><div><dt>Most used provider</dt><dd>{topProvider}{resolvedModelRows.length > 0 ? ` · ${Math.round((resolvedModelRows[0]!.value / safeModelTotal) * 100)}%` : ""}</dd></div><div><dt>Most used reasoning</dt><dd>{topEffort ? effortLabel(topEffort[0]) : "-"}</dd></div><div><dt>Most active hour</dt><dd>{topHour === undefined ? "-" : new Date(2000, 0, 1, topHour).toLocaleTimeString([], { hour: "numeric" })}</dd></div><div><dt>Most worked project</dt><dd title={topProject ? state.projects.find((project) => project.id === topProject[0])?.name : undefined}>{topProject ? `${state.projects.find((project) => project.id === topProject[0])?.name ?? "Project"} · ${topProject[1]} prompts` : "-"}</dd></div><div><dt>Skills explored</dt><dd>{skillCounts.size}</dd></div><div><dt>Total skills used</dt><dd>{[...skillCounts.values()].reduce((sum, value) => sum + value, 0)}</dd></div><div><dt>Total threads</dt><dd>{state.threads.length}</dd></div></dl></section><section className="profile-section"><h3>Most used plugins</h3>{skillCounts.size > 0 ? <ul className="profile-plugin-list">{[...skillCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6).map(([skill, count]) => <li key={skill}><span><Sparkles size={13} />{skill}</span><b>{count} runs</b></li>)}</ul> : <p className="profile-muted">No skills or agents used yet.</p>}</section></div>
    <section className="profile-section"><h3>Model usage</h3>{resolvedModelRows.length > 0 ? <ul className="profile-model-list">{resolvedModelRows.slice(0, 6).map((row) => <li key={row.model}><div><span><Bot size={13} />{row.model}</span><b>{Math.round((row.value / safeModelTotal) * 100)}%</b></div><i style={{ width: `${Math.max(2, Math.min(100, (row.value / safeModelTotal) * 100))}%` }} /></li>)}</ul> : <p className="profile-muted">No model activity yet.</p>}</section>
  </div>;
}

function ThemeColorControl({ label, color, onChange }: { label: string; color: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState(color);
  useEffect(() => setDraft(color), [color]);
  const commit = (value: string) => {
    const normalized = normalizeHexColor(value, "");
    if (!normalized) return;
    setDraft(normalized);
    onChange(normalized);
  };
  return <div className="theme-pack-row"><span><strong>{label}</strong><small>Set the {label.toLowerCase()} used by this theme slot.</small></span><div className="theme-color-control">
    <input type="color" value={color} onChange={(event) => commit(event.target.value)} aria-label={`${label} color`} />
    <input value={draft} maxLength={7} spellCheck={false} aria-label={`${label} hex color`} onChange={(event) => setDraft(event.target.value)} onBlur={() => commit(draft)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(draft); } }} />
  </div></div>;
}

function ThemePackEditor({ variant, active, theme, onChange, onReset }: { variant: ThemeVariant; active: boolean; theme: ThemePack; onChange: (theme: ThemePack) => void; onReset: () => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const defaultTheme = DEFAULT_SETTINGS.themePacks[variant];
  const title = variant === "dark" ? "Dark theme" : "Light theme";
  const update = (patch: Partial<ThemePack>) => onChange({ ...theme, ...patch, preset: "custom" });
  const availablePresets = getAvailableThemePresets(variant);
  // If a dark-only preset is stored on the light pack (or vice versa), keep Custom selected
  // so the dropdown still has a valid value without inventing a missing seed.
  const presetValue: ThemePresetId = theme.preset !== "custom" && availablePresets.some((preset) => preset.id === theme.preset)
    ? theme.preset
    : "custom";
  const presetOptions: SelectOption<ThemePresetId>[] = [
    {
      value: "custom",
      label: "Custom",
      icon: <span className="theme-badge-icon" style={{ backgroundColor: theme.background, color: theme.accent, borderColor: 'rgba(255, 255, 255, 0.18)' }}>Aa</span>,
    },
    ...availablePresets.map((preset) => {
      const presetTheme = getThemePreset(preset.id, variant);
      return {
        value: preset.id,
        label: preset.label,
        icon: <span className="theme-badge-icon" style={{ backgroundColor: presetTheme.background, color: presetTheme.accent, borderColor: 'rgba(255, 255, 255, 0.18)' }}>Aa</span>,
      };
    }),
  ];
  const applyPreset = (preset: ThemePresetId) => {
    if (preset === "custom") {
      onChange({ ...theme, preset });
      return;
    }
    const next = getThemePreset(preset, variant);
    onChange({ ...next, fonts: { ...theme.fonts }, translucentSidebar: theme.translucentSidebar, contrast: theme.contrast });
  };
  const copyTheme = async () => {
    try {
      await navigator.clipboard.writeText(createThemeShareString(variant, theme));
      setNotice("Theme string copied");
    } catch {
      setNotice("Clipboard access unavailable");
    }
    window.setTimeout(() => setNotice(null), 2_000);
  };
  const importTheme = () => {
    const value = window.prompt(`Paste a ${variant} theme string`, "");
    if (!value) return;
    try {
      onChange(parseThemeShareString(value, variant));
      setNotice("Theme imported");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to import that theme.");
    }
    window.setTimeout(() => setNotice(null), 3_000);
  };
  return <section className={`settings-card theme-pack-card ${active ? "active" : ""}`}>
    <div className="theme-pack-header">
      <div><h3>{title}</h3><small>{active ? "Currently active" : variant === "dark" ? "Used when the app is dark" : "Used when the app is light"}</small></div>
      <div className="theme-pack-actions"><button type="button" className="settings-action" onClick={importTheme} title={`Import ${variant} theme`}><Upload size={12} />Import</button><button type="button" className="settings-action" onClick={() => void copyTheme()} title={`Copy ${variant} theme`}><Copy size={12} />Copy</button><button type="button" className="settings-action" onClick={onReset} disabled={JSON.stringify(theme) === JSON.stringify(defaultTheme)} title={`Reset ${variant} theme`}><RotateCcw size={12} />Reset</button></div>
    </div>
    <div className="theme-pack-row theme-pack-preset"><span><strong>Theme preset</strong><small>Start with a coordinated color set from Maximo or the Synara catalog, then customize it.</small></span><CustomSelect value={presetValue} options={presetOptions} onChange={applyPreset} ariaLabel={`${title} preset`} className="theme-preset-select" /></div>
    <ThemeColorControl label="Accent" color={theme.accent} onChange={(accent) => update({ accent })} />
    <ThemeColorControl label="Background" color={theme.background} onChange={(background) => update({ background })} />
    <ThemeColorControl label="Foreground" color={theme.foreground} onChange={(foreground) => update({ foreground })} />
    <label className="theme-pack-row"><span><strong>UI font</strong><small>Used by the app interface when system UI font is off.</small></span><input className="settings-text-control" value={theme.fonts.ui} onChange={(event) => update({ fonts: { ...theme.fonts, ui: normalizeFontFamily(event.target.value) } })} placeholder="System default" aria-label={`${title} UI font`} /></label>
    <label className="theme-pack-row"><span><strong>Code font</strong><small>Used for code blocks, diffs, and source previews.</small></span><input className="settings-text-control" value={theme.fonts.code} onChange={(event) => update({ fonts: { ...theme.fonts, code: normalizeFontFamily(event.target.value) } })} placeholder="Default monospace" aria-label={`${title} code font`} /></label>
    <label className="theme-pack-row"><span><strong>Translucent sidebar</strong><small>Blend the sidebar with the themed surface and keep the soft depth effect.</small></span><input type="checkbox" checked={theme.translucentSidebar} onChange={(event) => update({ translucentSidebar: event.target.checked })} aria-label={`${title} translucent sidebar`} /></label>
    <label className="theme-pack-row theme-contrast-row"><span><strong>Contrast</strong><small>Increase surface, border, and text separation without changing the base colors.</small></span><span className="theme-contrast-control"><input type="range" min={0} max={100} step={1} value={theme.contrast} onChange={(event) => update({ contrast: Number(event.target.value) })} aria-label={`${title} contrast`} /><output>{theme.contrast}</output></span></label>
    {notice && <p className="theme-pack-notice" role="status">{notice}</p>}
  </section>;
}

type EnhancedSettingsSectionId = "general" | "profile" | "appearance" | "behavior" | "shortcuts" | "defaults" | "models" | "skills" | "notifications" | "account" | "integrations" | "engine" | "advanced" | "archived";

function EnhancedSettingsModal({ state, engine, models, modelOptions, account, usage, appVersion, appDataPath, skills, initialSection = "general", onClose, onSave, onRepair, onAccount, onUsage, onRefreshSkills, onResetProvider, onRevealDataPath, onRestoreThread, onDeleteArchivedThread, updateState, onCheckForUpdates, onOpenUpdateDownload, onOpenWhatsNew }: {
  state: AppState;
  engine: EngineStatus | null;
  models: EngineModel[];
  modelOptions: SelectOption<string>[];
  account: AccountStatus | null;
  usage: UsageSnapshot | null;
  appVersion: string;
  appDataPath: string;
  skills: SlashCommand[];
  initialSection?: EnhancedSettingsSectionId;
  onClose: () => void;
  onSave: (patch: Partial<AppState["settings"]>) => Promise<void>;
  onRepair: () => Promise<void>;
  onAccount: () => void;
  onUsage: () => void;
  onRefreshSkills: () => void;
  onResetProvider: () => Promise<void>;
  onRevealDataPath: () => void;
  onRestoreThread: (threadId: string) => Promise<void>;
  onDeleteArchivedThread: (threadId: string) => Promise<void>;
  updateState: AppUpdateState | null;
  onCheckForUpdates: () => Promise<void>;
  onOpenUpdateDownload: () => Promise<void>;
  onOpenWhatsNew: () => void;
}) {
  const [values, setValues] = useState(state.settings);
  const [section, setSection] = useState<EnhancedSettingsSectionId>(initialSection);
  const [search, setSearch] = useState("");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [customModelDraft, setCustomModelDraft] = useState("");
  const [systemDark, setSystemDark] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const sendShortcutLabel = composerSendShortcutLabel();
  const selectedModel = models.find((item) => (item.value === "default" ? "" : item.value) === values.defaultModel);
  const selectableModelOptions = [...modelOptions, ...values.customModelSlugs
    .filter((slug) => !modelOptions.some((option) => option.value === slug))
    .map((slug) => ({ value: slug, label: slug, description: "Saved custom model slug", icon: <Bot size={13} /> }))];
  const navItems = [
    { id: "general" as const, group: "Personal", label: "General", description: "Workspace defaults, navigation, and the Environment panel.", icon: <Settings size={14} /> },
    { id: "profile" as const, group: "Personal", label: "Profile & stats", description: "A local snapshot of your Maximo workspace activity.", icon: <UserCircle size={14} /> },
    { id: "appearance" as const, group: "Personal", label: "Appearance", description: "Theme, typography, density, terminal, and time format.", icon: <Sun size={14} /> },
    { id: "behavior" as const, group: "Personal", label: "Chat behavior", description: "Follow-ups, streaming, review defaults, and safety confirmations.", icon: <SlidersHorizontal size={14} /> },
    { id: "notifications" as const, group: "Personal", label: "Notifications", description: "Choose how Maximo tells you when work finishes or needs attention.", icon: <Bell size={14} /> },
    { id: "shortcuts" as const, group: "Personal", label: "Keyboard shortcuts", description: "Reference the commands available throughout the desktop app.", icon: <Keyboard size={14} /> },
    { id: "defaults" as const, group: "Coding", label: "Chat defaults", description: "Model, reasoning effort, and permissions for new chats.", icon: <Bot size={14} /> },
    { id: "models" as const, group: "Coding", label: "Models & writing", description: "Review the live catalog and save custom model slugs.", icon: <Sparkles size={14} /> },
    { id: "skills" as const, group: "Coding", label: "Agent skills", description: "Review reusable workflows discovered on this computer.", icon: <Box size={14} /> },
    { id: "account" as const, group: "Integrations", label: "Account & usage", description: "Signed-in provider and current usage limits.", icon: <Gauge size={14} /> },
    { id: "integrations" as const, group: "Integrations", label: "Workspace integrations", description: "See which local tools are available to your chats.", icon: <Plug size={14} /> },
    { id: "engine" as const, group: "System", label: "Syntax CLI", description: "Engine health and local CLI configuration.", icon: <TerminalSquare size={14} /> },
    { id: "advanced" as const, group: "System", label: "System tools", description: "App updates, recovery, provider reset, data location, and version details.", icon: <Wrench size={14} /> },
    { id: "archived" as const, group: "Archived", label: "Archived chats", description: "Restore or permanently delete chats you archived.", icon: <Archive size={14} /> },
  ];
  const searchEntries: Array<{ section: EnhancedSettingsSectionId; title: string; keywords: string }> = [
    { section: "advanced", title: "Desktop updates", keywords: "update app download release version github check for updates installer" },
    { section: "advanced", title: "What's new", keywords: "changelog release notes whats new dialog history" },
    { section: "general", title: "Workspace dock", keywords: "inspector environment panel right workspace" },
    { section: "profile", title: "Profile and stats", keywords: "account chats projects prompts activity local" },
    { section: "general", title: "Project order", keywords: "sidebar recently active recently added manual" },
    { section: "general", title: "Thread order", keywords: "sidebar chats newest first recently active" },
    { section: "general", title: "Environment panel", keywords: "usage servers repository editor pinned markers notepad activity" },
    { section: "appearance", title: "Theme", keywords: "light dark system appearance" },
    { section: "appearance", title: "UI density", keywords: "compact comfortable spacious spacing" },
    { section: "appearance", title: "Base font size", keywords: "chat typography pixels font" },
    { section: "appearance", title: "Terminal font", keywords: "terminal typeface size monospace" },
    { section: "appearance", title: "Time format", keywords: "timestamp locale 12-hour 24-hour" },
    { section: "behavior", title: "Follow-up behavior", keywords: "queue steer active turn context" },
    { section: "behavior", title: "Assistant output", keywords: "streaming response" },
    { section: "behavior", title: "Diff line wrapping", keywords: "review wrap" },
    { section: "behavior", title: "Safety confirmations", keywords: "delete archive terminal close" },
    { section: "notifications", title: "Activity toasts", keywords: "alerts in-app" },
    { section: "notifications", title: "Desktop notifications", keywords: "operating system background" },
    { section: "shortcuts", title: "Keyboard shortcuts", keywords: "hotkeys keybindings command" },
    { section: "defaults", title: "New chat defaults", keywords: "model effort permissions" },
    { section: "models", title: "Saved model slugs", keywords: "custom model catalog provider" },
    { section: "skills", title: "Discovered skills", keywords: "SKILL.md workflows commands" },
    { section: "account", title: "Account and usage", keywords: "sign in provider billing limits" },
    { section: "integrations", title: "Workspace integrations", keywords: "browser terminal git editor local tools" },
    { section: "engine", title: "Syntax CLI", keywords: "repair update runtime path" },
    { section: "advanced", title: "System tools", keywords: "data path reset diagnostics" },
    { section: "archived", title: "Archived chats", keywords: "restore delete history" },
  ];
  const query = search.trim().toLowerCase();
  const matchingEntries = query
    ? searchEntries.filter((entry) => `${entry.title} ${entry.keywords}`.toLowerCase().includes(query)).slice(0, 8)
    : [];
  const visibleSections = navItems.filter((item) => !query || `${item.label} ${item.description}`.toLowerCase().includes(query) || searchEntries.some((entry) => entry.section === item.id && `${entry.title} ${entry.keywords}`.toLowerCase().includes(query)));
  const activeSection = visibleSections.some((item) => item.id === section) ? section : (visibleSections[0]?.id ?? "general");
  const activeNav = navItems.find((item) => item.id === activeSection) ?? navItems[0]!;
  const update = <Key extends keyof AppState["settings"]>(key: Key, value: AppState["settings"][Key]) => setValues((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);
  const resolvedThemeVariant = resolveThemeVariant(values.theme, systemDark);
  const updateThemePack = (variant: ThemeVariant, theme: ThemePack) => update("themePacks", { ...values.themePacks, [variant]: theme });
  const resetToDefaults = () => {
    if (!window.confirm("Restore all Maximo Syntax settings to their defaults?")) return;
    setValues({ ...DEFAULT_SETTINGS, customModelSlugs: [...DEFAULT_SETTINGS.customModelSlugs] });
  };
  const addCustomModel = () => {
    const slug = customModelDraft.trim().replace(/\s+/g, " ").slice(0, 200);
    if (!slug || values.customModelSlugs.includes(slug)) return;
    update("customModelSlugs", [...values.customModelSlugs, slug].slice(0, 64));
    setCustomModelDraft("");
  };
  const testNotification = async () => {
    if (values.enableNotificationSound) await playNotificationSound();
    const supported = await window.maximoDesktop.notifications.isSupported().catch(() => false);
    const shown = await window.maximoDesktop.notifications.show({
      title: "Maximo Syntax",
      body: "Activity notifications are working.",
      silent: true,
    }).catch(() => false);
    setNotificationStatus(shown ? "Test notification sent to macOS Notification Center." : supported ? "Notification was not shown. Check macOS System Settings > Notifications for Maximo Syntax." : "Desktop notifications are unavailable in this build.");
  };
  const booleanRow = (key: keyof AppState["settings"], title: string, description: string) => (
    <label className="settings-row">
      <span><strong>{title}</strong><small>{description}</small></span>
      <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => update(key, event.target.checked as AppState["settings"][typeof key])} />
    </label>
  );
  const shortcutRows = MAXIMO_SHORTCUTS.filter((definition) => {
    const needle = shortcutQuery.trim().toLowerCase();
    return !needle || `${definition.label} ${definition.description} ${shortcutLabel(definition.chord)}`.toLowerCase().includes(needle);
  });
  const shortcutGroups = ["Navigation", "Chat", "Projects", "Models", "Workspace"].flatMap((category) => {
    const entries = shortcutRows.filter((definition) => definition.category === category);
    return entries.length > 0 ? [{ category, entries }] : [];
  });
  const allSkills = [...new Map(skills.map((skill) => [skill.name.toLowerCase(), skill])).values()];
  const archivedThreads = state.threads.filter((thread) => thread.archived).sort((left, right) => right.updatedAt - left.updatedAt);
  const projectName = (projectId: string) => state.projects.find((project) => project.id === projectId)?.name ?? "Unknown project";

  const renderPanel = (): ReactNode => {
    if (activeSection === "general") return <div className="settings-panel-stack">
      <section className="settings-card"><h2>Workspace</h2>
        {booleanRow("showInspector", "Open workspace dock by default", "Keep files, Git, terminal, browser, and review tools visible on the right.")}
        {booleanRow("environmentPanelDefaultOpen", "Open Environment by default", "Remember the Environment panel as the starting surface for normal chats.")}
      </section>
      <section className="settings-card"><h2>Sidebar organization</h2>
        <div className="settings-row"><span><strong>Project order</strong><small>Choose how projects are arranged in the main sidebar.</small></span><CustomSelect value={values.sidebarProjectSortOrder} options={[{ value: "manual", label: "Manual order" }, { value: "updated_at", label: "Recently active" }, { value: "created_at", label: "Recently added" }]} onChange={(value) => update("sidebarProjectSortOrder", value)} ariaLabel="Project order" className="settings-select" /></div>
        <div className="settings-row"><span><strong>Chat order</strong><small>Choose how chats are arranged in Recent and each project.</small></span><CustomSelect value={values.sidebarThreadSortOrder} options={[{ value: "updated_at", label: "Recently active" }, { value: "created_at", label: "Newest first" }]} onChange={(value) => update("sidebarThreadSortOrder", value)} ariaLabel="Chat order" className="settings-select" /></div>
      </section>
      <section className="settings-card"><h2>Environment panel</h2><p>Keep the core Git controls visible and choose which supporting sections appear.</p>
        {booleanRow("showEnvironmentUsage", "Usage remaining", "Show the provider usage shortcut in Environment.")}
        {booleanRow("showEnvironmentLocalServers", "Local servers", "Show listening local servers and open them in the built-in browser.")}
        {booleanRow("showEnvironmentRepository", "Repository", "Show the detected Git remote link.")}
        {booleanRow("showEnvironmentEditor", "Editor", "Show the in-app explorer and external editor actions.")}
        {booleanRow("showEnvironmentPinned", "Pinned messages", "Show the pinned-message checklist.")}
        {booleanRow("showEnvironmentMarkers", "Text markers", "Show highlighted transcript markers.")}
        {booleanRow("showEnvironmentNotepad", "Notepad", "Show the per-chat notepad.")}
        {booleanRow("showEnvironmentActivity", "Activity", "Show recent tool activity when available.")}
      </section>
      <section className="settings-card composer-settings-card"><h2>Message composer</h2><p>Choose what the Enter key does while you write a message.</p><div className="settings-choice-list" role="radiogroup" aria-label="Message send behavior">
        <label className={`settings-choice ${values.sendWithEnter ? "active" : ""}`}><input type="radio" name="send-behavior" checked={values.sendWithEnter} onChange={() => update("sendWithEnter", true)} /><span className="settings-choice-indicator" aria-hidden="true" /><span className="settings-choice-copy"><strong>Enter sends</strong><small>Press Enter to send and Shift+Enter for a new line.</small></span><kbd>Enter</kbd></label>
        <label className={`settings-choice ${!values.sendWithEnter ? "active" : ""}`}><input type="radio" name="send-behavior" checked={!values.sendWithEnter} onChange={() => update("sendWithEnter", false)} /><span className="settings-choice-indicator" aria-hidden="true" /><span className="settings-choice-copy"><strong>Enter makes a new line</strong><small>Press Enter for a new line and {sendShortcutLabel} to send.</small></span><kbd>{sendShortcutLabel}</kbd></label>
      </div></section>
      <section className="settings-card"><h2>Safety</h2>{booleanRow("hideFullAccessWarning", "Hide Full Access warning", "Do not show the elevated-access reminder above the composer.")}</section>
    </div>;

    if (activeSection === "profile") return <ProfileStatsPanel state={state} account={account} models={models} skills={skills} />;

    if (activeSection === "appearance") return <div className="settings-panel-stack">
      <section className="settings-card"><h2>Theme</h2><p>Choose how Maximo Syntax looks across the app. Light and dark themes can be customized independently.</p><div className="theme-choice-grid">{(["system", "light", "dark"] as ThemeMode[]).map((theme) => <button type="button" className={values.theme === theme ? "active" : ""} onClick={() => update("theme", theme)} key={theme}><span className={`theme-mini-preview ${theme}`}><i /><i /><i /></span><strong>{theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}</strong>{values.theme === theme && <Check size={13} />}</button>)}</div></section>
      <div className="theme-pack-stack">
        {(resolvedThemeVariant === "dark" ? (["dark", "light"] as ThemeVariant[]) : (["light", "dark"] as ThemeVariant[])).map((variant) => <ThemePackEditor key={variant} variant={variant} active={resolvedThemeVariant === variant} theme={values.themePacks[variant]} onChange={(theme) => updateThemePack(variant, theme)} onReset={() => updateThemePack(variant, { ...DEFAULT_SETTINGS.themePacks[variant], fonts: { ...DEFAULT_SETTINGS.themePacks[variant].fonts } })} />)}
      </div>
      <section className="settings-card"><h2>Typography and spacing</h2>
        {booleanRow("useSystemUiFont", "Use system UI font", "Use the native operating system font instead of Maximo's bundled Manrope family.")}
        <div className="settings-row"><span><strong>UI density</strong><small>Adjust spacing in the sidebar, composer, chat gutters, and settings rows.</small></span><div className="settings-segmented" role="radiogroup" aria-label="UI density">{(["compact", "comfortable", "spacious"] as const).map((density) => <button type="button" key={density} className={values.uiDensity === density ? "active" : ""} onClick={() => update("uiDensity", density)}>{density}</button>)}</div></div>
        <label className="settings-row"><span><strong>Base font size</strong><small>Scale chat and UI typography from this pixel value.</small></span><span className="settings-number-control"><input type="number" min={11} max={18} value={values.chatFontSizePx} onChange={(event) => update("chatFontSizePx", Math.min(18, Math.max(11, Number(event.target.value) || 13)))} /><small>px</small></span></label>
        <label className="settings-row"><span><strong>Terminal font size</strong><small>Adjust terminal text independently.</small></span><span className="settings-number-control"><input type="number" min={10} max={22} value={values.terminalFontSizePx} onChange={(event) => update("terminalFontSizePx", Math.min(22, Math.max(10, Number(event.target.value) || 12)))} /><small>px</small></span></label>
        <label className="settings-row"><span><strong>Terminal font</strong><small>Type any installed monospace family. Leave blank for the default stack.</small></span><input className="settings-text-control" value={values.terminalFontFamily} onChange={(event) => update("terminalFontFamily", event.target.value.replace(/[;{}<>\n\r]/g, "").slice(0, 256))} placeholder="Default monospace" /></label>
      </section>
      <section className="settings-card"><h2>Time and reading</h2><div className="settings-row"><span><strong>Time format</strong><small>System default follows your OS clock preference.</small></span><CustomSelect value={values.timestampFormat} options={[{ value: "locale", label: "System default" }, { value: "12-hour", label: "12-hour" }, { value: "24-hour", label: "24-hour" }]} onChange={(value) => update("timestampFormat", value)} ariaLabel="Time format" className="settings-select" /></div></section>
    </div>;

    if (activeSection === "behavior") return <div className="settings-panel-stack">
      <section className="settings-card"><h2>Conversation</h2><div className="settings-row"><span><strong>Follow-up behavior</strong><small>Choose whether context sent during an active turn steers the current run or waits for the next turn.</small></span><div className="settings-segmented" role="radiogroup" aria-label="Follow-up behavior">{(["steer", "queue"] as FollowUpBehavior[]).map((behavior) => <button type="button" key={behavior} className={values.followUpBehavior === behavior ? "active" : ""} onClick={() => update("followUpBehavior", behavior)}>{behavior === "steer" ? "Steer" : "Queue"}</button>)}</div></div>{booleanRow("enableAssistantStreaming", "Assistant output", "Show token-by-token output while a response is in progress.")}</section>
      <section className="settings-card"><h2>Review</h2>{booleanRow("diffWordWrap", "Diff line wrapping", "Start the diff panel with long lines wrapped.")}</section>
      <section className="settings-card"><h2>Safety confirmations</h2>{booleanRow("confirmThreadDelete", "Delete confirmation", "Ask before deleting a chat and its history.")}{booleanRow("confirmThreadArchive", "Archive confirmation", "Ask before archiving a chat or project chats.")}{booleanRow("confirmTerminalTabClose", "Terminal close confirmation", "Ask before closing a terminal tab and clearing its session output.")}</section>
    </div>;

    if (activeSection === "notifications") return <div className="settings-panel-stack"><section className="settings-card"><h2>Activity alerts</h2>{booleanRow("enableTaskCompletionToasts", "Activity toasts", "Show an in-app toast when a background chat finishes or needs attention.")}
      <div className="settings-row"><span><strong>Desktop notifications</strong><small>Show an operating-system notification when a background chat finishes.</small></span><div className="settings-row-actions"><button type="button" className="settings-action" onClick={() => void testNotification()}>Test</button><input type="checkbox" checked={values.enableSystemTaskCompletionNotifications} onChange={(event) => update("enableSystemTaskCompletionNotifications", event.target.checked)} /></div></div>
      <div className="settings-row"><span><strong>Notification sound</strong><small>Play a short alert tone with desktop activity notifications.</small></span><div className="settings-row-actions"><button type="button" className="settings-action" onClick={() => void playNotificationSound()}>Preview</button><input type="checkbox" checked={values.enableNotificationSound} onChange={(event) => update("enableNotificationSound", event.target.checked)} /></div></div>{notificationStatus && <p className="settings-notification-status" role="status">{notificationStatus}</p>}
    </section></div>;

    if (activeSection === "shortcuts") return <div className="settings-panel-stack"><section className="settings-card"><h2>Keyboard shortcuts</h2><p>These shortcuts are available throughout Maximo Syntax. Search by action, description, or key combination.</p><input className="settings-shortcut-search" value={shortcutQuery} onChange={(event) => setShortcutQuery(event.target.value)} placeholder="Search shortcuts..." aria-label="Search shortcuts" />{shortcutRows.length > 0 ? <div className="settings-shortcut-list">{shortcutGroups.map((group) => <section className="settings-shortcut-group" key={group.category}><h3>{group.category}</h3>{group.entries.map((definition) => <div className="settings-shortcut-row" key={definition.command}><span><strong>{definition.label}</strong><small>{definition.description}</small></span><kbd>{shortcutLabel(definition.chord)}</kbd></div>)}</section>)}</div> : <div className="settings-empty-state">No shortcuts match “{shortcutQuery}”.</div>}</section></div>;

    if (activeSection === "defaults") return <div className="settings-panel-stack"><section className="settings-card"><h2>New chats</h2><div className="settings-row"><span><strong>Model</strong><small>Loaded from the active provider account and saved custom slugs.</small></span><CustomSelect value={values.defaultModel} options={selectableModelOptions} onChange={(defaultModel) => setValues((current) => ({ ...current, defaultModel, defaultEffort: "" }))} ariaLabel="Default model" className="settings-select" /></div>{selectedModel?.supportsEffort && <div className="settings-row"><span><strong>Reasoning effort</strong><small>Used for new chats with the selected model.</small></span><CustomSelect value={values.defaultEffort} options={effortOptionsFor(selectedModel)} onChange={(defaultEffort) => update("defaultEffort", defaultEffort)} ariaLabel="Default reasoning effort" className="settings-select" /></div>}<div className="settings-row"><span><strong>Permissions</strong><small>Choose the default approval behavior for new chats.</small></span><CustomSelect value={values.defaultPermission} options={permissionOptions} onChange={(defaultPermission) => update("defaultPermission", defaultPermission)} ariaLabel="Default permissions" className="settings-select" /></div></section></div>;

    if (activeSection === "models") return <div className="settings-panel-stack"><section className="settings-card"><h2>Model catalog</h2><div className="settings-row"><span><strong>Live models</strong><small>Models reported by your current account and CLI.</small></span><span className="setting-value">{models.length || "CLI default"}</span></div><div className="settings-row"><span><strong>Saved model slug</strong><small>Add a provider model identifier that is not in the live catalog.</small></span><div className="settings-inline-control"><input className="settings-text-control" value={customModelDraft} onChange={(event) => setCustomModelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomModel(); } }} placeholder="provider/model" spellCheck={false} /><button type="button" className="settings-action" onClick={addCustomModel} disabled={!customModelDraft.trim()}>Add</button></div></div>{values.customModelSlugs.length > 0 && <div className="settings-custom-model-list">{values.customModelSlugs.map((slug) => <div className="settings-custom-model-row" key={slug}><code>{slug}</code><button type="button" onClick={() => update("customModelSlugs", values.customModelSlugs.filter((item) => item !== slug))} title={`Remove ${slug}`} aria-label={`Remove ${slug}`}><X size={13} /></button></div>)}</div>}</section><section className="settings-card"><h2>Writing defaults</h2><div className="settings-row"><span><strong>Git writing model</strong><small>Commit and push actions use the selected default model when the CLI needs model text.</small></span><span className="setting-value">{values.defaultModel || "Provider default"}</span></div></section></div>;

    if (activeSection === "skills") return <div className="settings-panel-stack"><section className="settings-card"><h2>Discovered skills</h2><div className="settings-row"><span><strong>Local skill catalog</strong><small>Skills are read from user and project skill folders and remain available in the slash menu.</small></span><div className="settings-row-actions"><span className="setting-value">{allSkills.length} found</span><button type="button" className="settings-action" onClick={onRefreshSkills}><RefreshCw size={12} />Refresh</button></div></div>{allSkills.length > 0 ? <div className="settings-skill-list">{allSkills.map((skill) => <div className="settings-skill-row" key={skill.name}><span className="settings-skill-icon"><Sparkles size={13} /></span><span><strong>{skill.name}</strong><small>{skill.description || "Reusable workflow available from the composer."}</small></span></div>)}</div> : <div className="settings-empty-state">No skills found yet. Add a SKILL.md folder to a supported local skill directory.</div>}</section></div>;

    if (activeSection === "account") return <div className="settings-panel-stack"><section className="settings-card"><h2>Signed in account</h2><div className="settings-account-row"><span className={`account-state ${account?.loggedIn ? "online" : ""}`}><UserRound size={16} /></span><span><strong>{account?.email || account?.displayName || "Not signed in"}</strong><small>{accountDetailText(account)}</small></span><button type="button" onClick={onAccount}>Manage account</button></div></section><section className="settings-card"><h2>Usage and billing</h2><div className="settings-row"><span><strong>{usage?.planName || "Current plan usage"}</strong><small>{usage ? usage.message || `${usage.limits.length} live usage limit${usage.limits.length === 1 ? "" : "s"}` : "View limits and reset times without leaving the app."}</small></span><button type="button" className="settings-action" onClick={onUsage}>{usage ? "Refresh usage" : "View usage"}</button></div>{usage?.limits.map((limit) => <div className="settings-usage-row" key={limit.id}><span>{limit.label}</span><div><i style={{ width: `${limit.utilization ?? 0}%` }} /></div><strong>{limit.utilization === null ? "-" : `${Math.round(limit.utilization)}%`}</strong></div>)}</section></div>;

    if (activeSection === "integrations") return <div className="settings-panel-stack"><section className="settings-card"><h2>Built-in workspace tools</h2><div className="settings-integration-row"><Globe2 size={15} /><span><strong>Browser</strong><small>Open web pages, search, and capture links inside a chat workspace.</small></span><span className="setting-value">Available</span></div><div className="settings-integration-row"><TerminalSquare size={15} /><span><strong>Terminal</strong><small>Run commands in the selected project with a managed PTY session.</small></span><span className="setting-value">Available</span></div><div className="settings-integration-row"><GitBranch size={15} /><span><strong>Git</strong><small>Review changes, stage files, commit, push, and inspect branches.</small></span><span className="setting-value">Available</span></div><div className="settings-integration-row"><Code2 size={15} /><span><strong>External editor</strong><small>Open project files through the system editor integration.</small></span><span className="setting-value">Available</span></div></section><section className="settings-card"><h2>Local-first access</h2><div className="settings-row"><span><strong>Permission model</strong><small>Tool access remains controlled by each chat's approval mode and Full Access confirmation.</small></span><span className="setting-value">Per chat</span></div><div className="settings-row"><span><strong>Credentials</strong><small>Provider credentials stay in the Maximo Syntax CLI's secure local auth storage.</small></span><span className="setting-value">On device</span></div></section></div>;

    if (activeSection === "engine") return <div className="settings-panel-stack"><section className="settings-card"><h2>Maximo Syntax CLI</h2><div className="engine-settings"><div><span className={`engine-dot ${engine?.phase ?? "checking"}`} /><p><strong>{engine?.available ? `Ready · ${engine.version}` : "Needs attention"}</strong><small>{engine?.message}{engine?.available && engine?.latestVersion ? (engine.version === engine.latestVersion ? " Up to date with the latest CLI." : ` Latest available: ${engine.latestVersion}.`) : ""}</small></p></div><button type="button" onClick={() => void onRepair()}><RefreshCw size={13} />Repair / update</button></div><label className="settings-engine-path"><span><strong>Custom CLI path</strong><small>Optional. The bundled CLI is used automatically when this is blank.</small></span><input value={values.cliPath} onChange={(event) => update("cliPath", event.target.value)} placeholder="/path/to/maximo-syntax-cli" /></label></section><section className="settings-card"><h2>Runtime details</h2><div className="settings-row"><span><strong>Desktop version</strong><small>Installed Maximo Syntax application.</small></span><span className="setting-value">{appVersion || "Unknown"}</span></div><div className="settings-row"><span><strong>CLI version</strong><small>Currently selected runtime engine.</small></span><span className="setting-value">{engine?.version || "Unknown"}</span></div></section></div>;

    if (activeSection === "advanced") return <div className="settings-panel-stack"><section className="settings-card"><h2>Desktop updates</h2><div className="settings-row"><span><strong>Installed version</strong><small>Current Maximo Syntax desktop application.</small></span><span className="setting-value">{appVersion || updateState?.currentVersion || "Unknown"}</span></div><div className="settings-row"><span><strong>Update status</strong><small>{updateState?.message || (updateState?.status === "available" ? `Version ${updateState.availableVersion} is available from GitHub Releases.` : updateState?.status === "up-to-date" ? "You are on the latest published release." : updateState?.status === "checking" ? "Checking GitHub Releases…" : updateState?.status === "error" ? "The last update check failed." : "Checks GitHub Releases for a newer desktop build.")}</small></span><div className="settings-row-actions">{shouldShowAppUpdateButton(updateState) ? <button type="button" className="settings-action" disabled={updateBusy} onClick={() => { setUpdateBusy(true); void onOpenUpdateDownload().finally(() => setUpdateBusy(false)); }}><Download size={12} />Download update</button> : null}<button type="button" className="settings-action" disabled={updateBusy || updateState?.status === "checking"} onClick={() => { setUpdateBusy(true); void onCheckForUpdates().finally(() => setUpdateBusy(false)); }}><RefreshCw size={12} className={updateState?.status === "checking" || updateBusy ? "spin" : undefined} />{updateState?.status === "checking" || updateBusy ? "Checking…" : "Check for updates"}</button></div></div>{updateState?.availableVersion && <div className="settings-row"><span><strong>Latest release</strong><small>{updateState.releaseName || `v${updateState.availableVersion}`}</small></span><span className="setting-value">v{updateState.availableVersion}</span></div>}<div className="settings-row"><span><strong>What&rsquo;s new</strong><small>Review the installed version&rsquo;s release notes from GitHub and the local changelog.</small></span><button type="button" className="settings-action" onClick={onOpenWhatsNew}><Sparkles size={12} />Open release notes</button></div></section><section className="settings-card"><h2>System tools</h2><div className="settings-row"><span><strong>Provider selection reset</strong><small>Clear the current model, effort, and CLI session selections from chats before switching accounts.</small></span><button type="button" className="settings-action" onClick={() => void onResetProvider()}><RotateCcw size={12} />Reset</button></div><div className="settings-row"><span><strong>Application data</strong><small>{appDataPath || "Local Maximo Syntax state directory."}</small></span><button type="button" className="settings-action" onClick={onRevealDataPath} disabled={!appDataPath}><Monitor size={12} />Reveal</button></div></section><section className="settings-card"><h2>Safety and privacy</h2><div className="settings-row"><span><strong>Local-first storage</strong><small>Chats, projects, preferences, and cached activity stay in the desktop data directory on this computer.</small></span><span className="setting-value">Enabled</span></div><div className="settings-row"><span><strong>Native bridge</strong><small>Filesystem, process, Git, and shell actions run through the isolated Electron main process.</small></span><span className="setting-value">Sandboxed</span></div></section></div>;

    return <div className="settings-panel-stack"><section className="settings-card"><h2>Archived chats</h2>{archivedThreads.length > 0 ? <div className="settings-archive-list">{archivedThreads.map((thread) => <div className="settings-archive-row" key={thread.id}><span><strong>{thread.title}</strong><small>{projectName(thread.projectId)} · {new Date(thread.updatedAt).toLocaleDateString()}</small></span><div className="settings-row-actions"><button type="button" className="settings-action" onClick={() => void onRestoreThread(thread.id)}>Restore</button><button type="button" className="settings-action danger" onClick={() => void onDeleteArchivedThread(thread.id)}>Delete</button></div></div>)}</div> : <div className="settings-empty-state"><Archive size={18} />No archived chats. Archived conversations will appear here and can be restored.</div>}</section></div>;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (values.defaultPermission === "full" && state.settings.defaultPermission !== "full" && !window.confirm("Make Full access the default for every new chat? Commands and edits can run without approval prompts.")) return;
    await onSave(values);
    onClose();
  };

  return <form className="settings-page" onSubmit={(event) => void submit(event)}>
    <div className="settings-page-topbar drag-region" aria-hidden="true" />
    <aside className="settings-page-sidebar">
      <button type="button" className="settings-back" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Back to chats"><ArrowLeft size={14} />Back to chats</button>
      <label className="settings-search"><Search size={13} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings..." aria-label="Search settings" /></label>
      {matchingEntries.length > 0 && <div className="settings-search-results" aria-label="Matching settings">{matchingEntries.map((entry) => <button type="button" key={`${entry.section}:${entry.title}`} onClick={() => { setSection(entry.section); setSearch(""); }}>{navItems.find((item) => item.id === entry.section)?.icon}<span><strong>{entry.title}</strong><small>{navItems.find((item) => item.id === entry.section)?.label}</small></span></button>)}</div>}
      <nav className="settings-section-nav">{["Personal", "Integrations", "Coding", "System", "Archived"].map((group) => { const items = visibleSections.filter((item) => item.group === group); return items.length ? <div className="settings-nav-group" key={group}><span className="settings-group-label">{group}</span>{items.map((item) => <button type="button" key={item.id} className={activeSection === item.id ? "active" : ""} onClick={() => setSection(item.id)}>{item.icon}<span>{item.label}</span></button>)}</div> : null; })}</nav>
      <div className="settings-sidebar-foot"><Logo compact /><span><strong>Maximo Syntax</strong><small>Desktop {appVersion || "-"}{engine?.version ? ` · CLI ${engine.version}` : ""}</small></span></div>
    </aside>
    <main className="settings-page-main"><div className="settings-page-content"><header><span className="eyebrow">MAXIMO SYNTAX</span><div className="settings-heading-row"><div><h1>{activeNav.label}</h1><p className="settings-page-description">{activeNav.description}</p></div><button type="button" className="settings-reset-all" onClick={resetToDefaults}><RotateCcw size={12} />Restore defaults</button></div></header>{renderPanel()}</div><footer className="settings-page-footer"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button compact" type="submit">Save changes</button></footer></main>
  </form>;
}

function AccountModal({ account, usage, usageBusy, busy, onClose, onRefresh, onLogin, onCancelLogin, onLogout, onUsage }: {
  account: AccountStatus | null;
  usage: UsageSnapshot | null;
  usageBusy: boolean;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onLogin: (method: LoginMethod, apiKey?: string, openCodePlan?: OpenCodePlan) => Promise<boolean>;
  onCancelLogin: () => void;
  onLogout: () => void;
  onUsage: () => void;
}) {
  const [step, setStep] = useState<AccountSignInStep>("hub");
  const [method, setMethod] = useState<LoginMethod>("maximoai");
  const [apiKey, setApiKey] = useState("");
  const [openCodePlan, setOpenCodePlan] = useState<OpenCodePlan>("zen");
  const selected = loginMethodOptions.find((option) => option.value === method) ?? loginMethodOptions[0];
  const canSubmit = !busy && (!selected.needsKey || apiKey.trim().length > 0);
  const usageProviderLabel = usage?.provider === "mytabulon" ? "MyTabulon" : usage?.provider === "maximoai" ? "Maximo AI" : providerLabel(account);
  const stepIndex = step === "hub" ? 0 : step === "method" ? 1 : 2;
  const stepTitle = step === "hub" ? "Account" : step === "method" ? "Sign in" : selected.label;
  const stepEyebrow = step === "hub" ? "MAXIMO SYNTAX" : step === "method" ? "STEP 1 OF 2" : "STEP 2 OF 2";

  const resetFlow = () => {
    setStep("hub");
    setApiKey("");
    setMethod("maximoai");
    setOpenCodePlan("zen");
  };

  const requestClose = () => {
    if (busy) onCancelLogin();
    else {
      resetFlow();
      onClose();
    }
  };

  const goBack = () => {
    if (busy) {
      onCancelLogin();
      return;
    }
    if (step === "details") {
      setApiKey("");
      setStep("method");
      return;
    }
    if (step === "method") {
      setStep("hub");
      return;
    }
    requestClose();
  };

  const startSignIn = () => {
    setApiKey("");
    setMethod("maximoai");
    setOpenCodePlan("zen");
    setStep("method");
  };

  const continueToDetails = () => setStep("details");

  const submitLogin = async () => {
    if (!canSubmit) return;
    const ok = await onLogin(method, selected.needsKey ? apiKey.trim() : undefined, method === "opencode" ? openCodePlan : undefined);
    if (ok) {
      setApiKey("");
      setStep("hub");
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className={`account-modal glass-panel account-modal-${step}`}>
      <div className="modal-header account-modal-header">
        <div className="account-modal-heading">
          {step !== "hub" && (
            <button type="button" className="account-back" onClick={goBack} disabled={busy && step === "method"} title="Back">
              <ArrowLeft size={15} />
              <span>Back</span>
            </button>
          )}
          <div>
            <span className="eyebrow">{stepEyebrow}</span>
            <h2>{stepTitle}</h2>
          </div>
        </div>
        <button type="button" onClick={requestClose} title={busy ? "Cancel sign-in" : "Close"}><X size={17} /></button>
      </div>

      {step !== "hub" && (
        <div className="signin-stepper" aria-hidden="true">
          <span className={stepIndex >= 1 ? "active" : ""} /><span className={stepIndex >= 2 ? "active" : ""} />
        </div>
      )}

      {step === "hub" && (
        <div className="account-step account-step-hub">
          <div className="account-identity">
            <span className={`account-state ${account?.loggedIn ? "online" : ""}`}><UserRound size={17} /></span>
            <div>
              <strong>{account?.email || account?.displayName || (account?.loggedIn ? "Connected account" : "Not signed in")}</strong>
              <small>{accountDetailText(account)}</small>
            </div>
            <button type="button" onClick={onRefresh} disabled={busy} title="Refresh account"><RefreshCw size={13} className={busy ? "spin" : ""} /></button>
          </div>

          <div className="usage-card">
            <div><strong>Usage & billing</strong><small>View current limits, resets, and percentage usage for this account.</small></div>
            <button type="button" onClick={onUsage} disabled={usageBusy || !account?.loggedIn}>{usageBusy ? <RefreshCw size={12} className="spin" /> : usage ? "Refresh" : "View usage"}</button>
          </div>
          {usage && <div className="usage-details">
            <div className="usage-heading">
              <div>
                <strong>{usage.planName || (usage.provider === "mytabulon" ? "MyTabulon Coding Plan" : "Current plan")}</strong>
                <small>{usage.concurrency !== undefined && usage.concurrency !== null ? `${usage.concurrency} concurrent runs` : "Usage shown as percentages of plan limits"}</small>
              </div>
              <span>{usageProviderLabel}</span>
            </div>
            {usage.limits.map((item) => <div className="usage-limit" key={item.id}>
              <div><span>{item.label}</span><strong>{formatUsagePercentage(item.utilization)}</strong></div>
              <div className="usage-meter"><i style={{ width: `${item.utilization ?? 0}%` }} /></div>
              {item.resetsAt && <small>Resets {new Date(item.resetsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>}
            </div>)}
            {usage.message && <p className={usage.available ? "" : "error"}>{usage.message}</p>}
          </div>}

          <div className="account-hub-actions">
            <button className="primary-button compact signin-submit" type="button" disabled={busy} onClick={startSignIn}>
              <UserRound size={13} />
              {account?.loggedIn ? "Sign in another way" : "Sign in"}
            </button>
            {account?.loggedIn && (
              <button type="button" className="logout-button hub-logout" disabled={busy} onClick={onLogout}>
                <LogOut size={13} />Sign out
              </button>
            )}
          </div>
          <p className="account-hub-footnote">Credentials stay on this computer for Maximo Syntax CLI and Desktop (shared ~/.maximo.json).</p>
        </div>
      )}

      {step === "method" && (
        <div className="account-step account-step-method">
          <p className="account-signin-lead">Choose how you want to connect — same options as Maximo Syntax CLI.</p>
          <div className="signin-method-list" role="radiogroup" aria-label="Sign-in method">
            {loginMethodOptions.map((option) => (
              <label key={option.value} className={`signin-method ${method === option.value ? "active" : ""}`}>
                <input
                  type="radio"
                  name="signin-method"
                  value={option.value}
                  checked={method === option.value}
                  disabled={busy}
                  onChange={() => {
                    setMethod(option.value);
                    setApiKey("");
                    if (option.value !== "opencode") setOpenCodePlan("zen");
                  }}
                />
                <span className="signin-method-indicator" aria-hidden="true" />
                <span className="signin-method-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="signin-nav">
            <button type="button" className="secondary-button" onClick={goBack} disabled={busy}>Back</button>
            <button type="button" className="primary-button compact" onClick={continueToDetails} disabled={busy}>
              Continue <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {step === "details" && (
        <div className="account-step account-step-details">
          <div className="signin-method-chip">
            <strong>{selected.label}</strong>
            <small>{selected.description}</small>
          </div>

          {selected.needsKey ? (
            <div className="signin-key-panel">
              {selected.value === "opencode" && <OpenCodePlanPicker plan={openCodePlan} onChange={setOpenCodePlan} disabled={busy} />}
              <label htmlFor="signin-api-key">API key</label>
              <input
                id="signin-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={apiKey}
                disabled={busy}
                placeholder={selected.placeholder}
                onChange={(event) => setApiKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canSubmit) {
                    event.preventDefault();
                    void submitLogin();
                  }
                }}
              />
              {selected.helpUrl && (
                <a className="signin-help-link" href={selected.helpUrl} target="_blank" rel="noreferrer" onClick={(event) => { event.preventDefault(); void window.maximoDesktop.openPath(selected.helpUrl!); }}>
                  {selected.helpLabel}
                </a>
              )}
            </div>
          ) : (
            <div className="signin-browser-panel">
              <div className="signin-browser-icon" aria-hidden="true"><Globe2 size={18} /></div>
              <p className="signin-browser-hint">
                {busy
                  ? "Waiting for browser sign-in… finish authorization in your browser, then return here."
                  : selected.browserHint}
              </p>
            </div>
          )}

          <div className="signin-nav">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (busy) onCancelLogin();
                else goBack();
              }}
            >
              {busy ? "Cancel" : "Back"}
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={!canSubmit}
              onClick={() => void submitLogin()}
            >
              {busy ? <RefreshCw size={13} className="spin" /> : selected.needsKey ? <UserRound size={13} /> : <Globe2 size={13} />}
              {busy
                ? (selected.needsKey ? "Signing in…" : "Waiting for browser…")
                : selected.needsKey
                  ? (account?.loggedIn ? "Switch with API key" : "Sign in with API key")
                  : "Continue in browser"}
            </button>
          </div>
        </div>
      )}
    </section>
  </div>;
}

export default function App() {
  type NavigationState = { ids: string[]; index: number };
  const [state, setState] = useState<AppState | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [updateState, setUpdateState] = useState<AppUpdateState | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNewSnapshot | null>(null);
  const [whatsNewPopoutVisible, setWhatsNewPopoutVisible] = useState(false);
  const [whatsNewDialogOpen, setWhatsNewDialogOpen] = useState(false);
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineModels, setEngineModels] = useState<EngineModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [skillCommands, setSkillCommands] = useState<SlashCommand[]>([]);
  const [discoveredSkills, setDiscoveredSkills] = useState<SlashCommand[]>([]);
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRun>>({});
  const [contextUsageByThread, setContextUsageByThread] = useState<Record<string, ContextUsage>>({});
  const [contextLoadingByThread, setContextLoadingByThread] = useState<Record<string, boolean>>({});
  const [liveSessions, setLiveSessions] = useState<Set<string>>(() => new Set());
  const [followUpQueues, setFollowUpQueues] = useState<Record<string, QueuedFollowUp[]>>({});
  const followUpQueuesRef = useRef(followUpQueues);
  followUpQueuesRef.current = followUpQueues;
  const followUpDispatchesRef = useRef<Record<string, Promise<void>>>({});
  const flushQueuedFollowUpRef = useRef<(threadId: string, item?: QueuedFollowUp) => Promise<void>>(async () => {});
  const [git, setGit] = useState<GitStatus | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [reviewFile, setReviewFile] = useState<string | null>(null);
  const [reviewDiff, setReviewDiff] = useState<GitDiff | null>(null);
  const [activeSurface, setActiveSurface] = useState<WorkspaceSurface>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [dockRequest, setDockRequest] = useState<WorkspaceDockRequest | null>(null);
  const [sideChatThreadId, setSideChatThreadId] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.min(340, Math.max(270, Math.round(window.innerWidth * 0.18))));
  const [inspectorWidth, setInspectorWidth] = useState(() => Math.min(365, Math.max(290, Math.round(window.innerWidth * 0.2))));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSectionRequest, setSettingsSectionRequest] = useState<EnhancedSettingsSectionId>("general");
  const [systemDark, setSystemDark] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [accountOpen, setAccountOpen] = useState(false);
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [appDataPath, setAppDataPath] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewState | null>(null);
  const attachmentPreviewRequestRef = useRef(0);
  const [pendingQuestion, setPendingQuestion] = useState<{ threadId: string; requestId: string; toolUseId?: string; data: string; questions: Question[] } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{ threadId: string; requestId: string; toolUseId?: string; data: string; payload: PermissionRequestPayload } | null>(null);
  const [navigation, setNavigation] = useState<NavigationState>({ ids: [], index: -1 });
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const resolvedThemeVariant = state ? resolveThemeVariant(state.settings.theme, systemDark) : "light";
  const appearanceVariables = useMemo(() => {
    if (!state) return {};
    return buildThemeCssVariables(state.settings.themePacks[resolvedThemeVariant], resolvedThemeVariant, {
      systemUiFont: state.settings.useSystemUiFont,
      uiDensity: state.settings.uiDensity,
      chatFontSizePx: state.settings.chatFontSizePx,
      terminalFontSizePx: state.settings.terminalFontSizePx,
      terminalFontFamily: state.settings.terminalFontFamily,
    });
  }, [resolvedThemeVariant, state]);

  useEffect(() => {
    if (!state) return;
    const rootStyle = document.documentElement.style;
    for (const [name, value] of Object.entries(appearanceVariables)) rootStyle.setProperty(name, value);
    document.documentElement.dataset.themeVariant = resolvedThemeVariant;
  }, [appearanceVariables, resolvedThemeVariant, state]);

  const refreshState = useCallback(async () => setState(await window.maximoDesktop.loadState()), []);
  const engineModelsRefreshAtRef = useRef(0);
  const engineModelsRequestRef = useRef(0);
  const refreshEngineModels = useCallback(async (force = false) => {
    if (!force && Date.now() - engineModelsRefreshAtRef.current < 60_000) return null;
    const requestId = ++engineModelsRequestRef.current;
    engineModelsRefreshAtRef.current = Date.now();
    setModelsLoading(true);
    try {
      const models = await window.maximoDesktop.engineModels();
      if (requestId !== engineModelsRequestRef.current) return null;
      setEngineModels(models);
      return models;
    } catch {
      // Keep the last known active selection visible during a transient catalog failure.
      return null;
    } finally {
      if (requestId === engineModelsRequestRef.current) setModelsLoading(false);
    }
  }, []);
  const invalidateProviderState = useCallback(() => {
    engineModelsRequestRef.current += 1;
    engineModelsRefreshAtRef.current = 0;
    setModelsLoading(false);
    setEngineModels([]);
    setUsage(null);
    setContextUsageByThread({});
    setContextLoadingByThread({});
    setFollowUpQueues({});
  }, []);
  const currentThread = useMemo(() => state?.threads.find((thread) => thread.id === state.selectedThreadId), [state]);
  const currentProject = useMemo(() => state?.projects.find((project) => project.id === (currentThread?.projectId ?? state.selectedProjectId)), [state, currentThread]);
  const currentContextUsage = useMemo(() => {
    if (!currentThread) return null;
    return contextUsageByThread[currentThread.id]
      ?? currentThread.contextUsage
      ?? estimateThreadContextUsage(currentThread, engineModels, state?.settings.defaultModel ?? "");
  }, [contextUsageByThread, currentThread, engineModels, state?.settings.defaultModel]);
  const sideChatThread = useMemo(() => sideChatThreadId ? state?.threads.find((thread) => thread.id === sideChatThreadId) : undefined, [sideChatThreadId, state]);
  const modelOptions = useMemo(() => {
    const base = modelsLoading && engineModels.length === 0
      ? [{ value: "", label: "Loading models…", description: "Refreshing for the active account" }]
      : toModelOptions(engineModels);
    const known = new Set(base.map((option) => option.value));
    const custom = (state?.settings.customModelSlugs ?? [])
      .filter((value) => value && !known.has(value))
      .map((value) => ({ value, label: value, description: "Saved custom model slug", icon: <Bot size={13} /> }));
    return [...base, ...custom];
  }, [engineModels, modelsLoading, state?.settings.customModelSlugs]);
  const skillNames = useMemo(() => {
    const names = new Set<string>();
    for (const command of [...skillCommands, ...discoveredSkills]) names.add(command.name.toLowerCase());
    return names;
  }, [skillCommands, discoveredSkills]);
  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(null), 3_500); }, []);
  const toggleEnvironment = useCallback(() => {
    setEnvironmentOpen((current) => {
      const next = !current;
      void window.maximoDesktop.updateSettings({ environmentPanelDefaultOpen: next }).then(setState).catch(() => undefined);
      return next;
    });
  }, []);
  const refreshDiscoveredSkills = useCallback((projectPath?: string) => {
    void window.maximoDesktop.listSkills(projectPath).then(setDiscoveredSkills).catch(() => setDiscoveredSkills([]));
  }, []);
  const openAttachmentPreview = useCallback((attachment: Attachment) => {
    const requestId = ++attachmentPreviewRequestRef.current;
    setAttachmentPreview({ attachment, preview: null, loading: true });
    void window.maximoDesktop.previewAttachment(attachment.path).then((preview) => {
      if (requestId !== attachmentPreviewRequestRef.current) return;
      setAttachmentPreview({ attachment, preview, loading: false });
    }).catch((error) => {
      if (requestId !== attachmentPreviewRequestRef.current) return;
      setAttachmentPreview({ attachment, preview: null, loading: false, error: error instanceof Error ? error.message : "Unable to prepare this file preview." });
    });
  }, []);
  const rememberThread = useCallback((threadId: string | undefined) => {
    if (!threadId) return;
    setNavigation((current) => {
      if (current.ids[current.index] === threadId) return current;
      const next = [...current.ids.slice(0, current.index + 1), threadId].slice(-50);
      return { ids: next, index: next.length - 1 };
    });
  }, []);
  const refreshContextUsage = useCallback(async (threadId: string) => {
    setContextLoadingByThread((current) => ({ ...current, [threadId]: true }));
    try {
      const next = await window.maximoDesktop.contextUsage(threadId);
      if (next) setContextUsageByThread((current) => ({ ...current, [threadId]: next }));
    } catch {
      // Context telemetry is supplemental; keep the last successful reading.
    } finally {
      setContextLoadingByThread((current) => ({ ...current, [threadId]: false }));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const loaded = await window.maximoDesktop.loadState();
      if (!active) return;
       setState(loaded); setInspectorVisible(loaded.settings.showInspector); setEnvironmentOpen(loaded.settings.environmentPanelDefaultOpen);
       void window.maximoDesktop.appInfo().then((info) => { if (active) { setAppVersion(info.version); setAppDataPath(info.dataPath); } }).catch(() => { if (active) { setAppVersion(""); setAppDataPath(""); } });
      void window.maximoDesktop.getUpdateState().then((next) => { if (active) setUpdateState(next); }).catch(() => { if (active) setUpdateState(null); });
      void window.maximoDesktop.accountStatus().then((status) => {
        if (!active) return;
        setAccount(status);
        setAccountLoaded(true);
      }).catch(() => {
        if (!active) return;
        setAccount(null);
        setAccountLoaded(true);
      });
      try {
        const nextEngine = await window.maximoDesktop.ensureEngine();
        if (!active) return;
        setEngine(nextEngine);
        if (nextEngine.available) void refreshEngineModels();
      } catch {
        if (active) setEngine({ phase: "error", available: false, message: "Unable to check the Maximo Syntax engine.", checkedAt: Date.now() });
      }
    };
    void initialize();
    return () => { active = false; };
  }, [refreshEngineModels]);

  useEffect(() => {
    if (!engine?.available) return;
    const refresh = () => void refreshEngineModels();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [engine?.available, refreshEngineModels]);

  useEffect(() => {
    if (state?.selectedThreadId && navigation.ids.length === 0) rememberThread(state.selectedThreadId);
  }, [navigation.ids.length, rememberThread, state?.selectedThreadId]);

  useEffect(() => {
    refreshDiscoveredSkills(currentProject?.path);
  }, [refreshDiscoveredSkills, currentProject?.path]);

  useEffect(() => {
    let frame: number | null = null;
    const pendingEvents: RunEvent[] = [];
    const processRunEvent = (event: RunEvent) => {
    const notifyBackground = (title: string, body: string, threadId: string) => {
      const latestState = stateRef.current;
      if (!latestState || latestState.selectedThreadId === threadId) return;
      if (latestState.settings.enableTaskCompletionToasts) showToast(`${title}: ${body}`);
      if (latestState.settings.enableSystemTaskCompletionNotifications) {
        if (latestState.settings.enableNotificationSound) void playNotificationSound();
        void window.maximoDesktop.notifications.show({
          title,
          body,
          threadId,
          silent: true,
        }).catch(() => false);
      }
    };
    if (event.type === "commands") {
      setSlashCommands(event.commands);
      setSkillCommands(event.skills?.length ? event.skills : []);
    }
    if (event.type === "finished") {
      setFollowUpQueues((current) => {
        if (!current[event.threadId]?.length) return current;
        const next = { ...current };
        delete next[event.threadId];
        return next;
      });
    }
    if (event.type === "context") {
      setContextUsageByThread((current) => ({ ...current, [event.threadId]: event.context }));
    }
    // Goal mode status lines surface as activity labels from the CLI
    // (e.g. "Goal continuing — …", "Goal complete.", "Goal paused — …").
    if (event.type === "activity" && /^goal\b/i.test(event.label.trim())) {
      const goal = goalStateFromText(event.label.trim(), event.timestamp);
      setState((current) => {
        if (!current) return current;
        return {
          ...current,
          threads: current.threads.map((thread) =>
            thread.id === event.threadId ? { ...thread, goal } : thread,
          ),
        };
      });
    }
    if (event.type === "question") {
      try {
        const parsed = JSON.parse(event.data) as { questions?: Question[] };
        if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          setPendingQuestion({ threadId: event.threadId, requestId: event.requestId, toolUseId: event.toolUseId, data: event.data, questions: parsed.questions });
          notifyBackground("Input needed", "Maximo is waiting for your answer.", event.threadId);
        }
      } catch { /* ignore malformed payloads */ }
    }
    if (event.type === "permission") {
      const detail = (() => {
        try { return JSON.parse(event.data) as Record<string, unknown>; } catch { return {}; }
      })();
      const payload: PermissionRequestPayload = {
        toolName: event.toolName,
        detail: typeof detail.command === "string" ? detail.command
          : typeof detail.file_path === "string" ? detail.file_path
          : typeof detail.path === "string" ? detail.path
          : typeof detail.url === "string" ? detail.url
          : typeof detail.query === "string" ? detail.query
          : undefined,
      };
      setPendingPermission({ threadId: event.threadId, requestId: event.requestId, toolUseId: event.toolUseId, data: event.data, payload });
      notifyBackground("Approval needed", `${event.toolName} is waiting for permission.`, event.threadId);
    }
    if (event.type === "turn-complete") {
      setPendingQuestion((current) => current?.threadId === event.threadId ? null : current);
      setPendingPermission((current) => current?.threadId === event.threadId ? null : current);
      void refreshContextUsage(event.threadId);
      void refreshState().then(() => { void flushQueuedFollowUpRef.current(event.threadId); });
      if (currentProject) void window.maximoDesktop.gitStatus(currentProject.id).then(setGit);
    }
    if (event.type === "finished") {
      const latestState = stateRef.current;
      const finishedThread = latestState?.threads.find((thread) => thread.id === event.threadId);
      const inBackground = event.threadId !== latestState?.selectedThreadId;
      if (inBackground) {
        notifyBackground(finishedThread?.title ?? "Chat", event.status === "complete" ? "Finished successfully." : `Ended with status ${event.status}.`, event.threadId);
      }
      setState((current) => current ? { ...current, threads: current.threads.map((thread) => thread.id === event.threadId ? { ...thread, status: event.status } : thread) } : current);
      void refreshState();
    }
    };
    const unsubscribe = window.maximoDesktop.onRunEvent((event: RunEvent) => {
      pendingEvents.push(event);
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const events = pendingEvents.splice(0);
        if (events.some((event) => event.type === "started" || event.type === "finished")) {
          setLiveSessions((current) => {
            const next = new Set(current);
            for (const event of events) {
              if (event.type === "started") next.add(event.threadId);
              if (event.type === "finished") next.delete(event.threadId);
            }
            return next;
          });
        }
        if (events.some((event) => event.type !== "finished")) {
          setLiveRuns((current) => reduceLiveRunEvents(current, events));
        }
        for (const next of events) processRunEvent(next);
      });
    });
    return () => {
      unsubscribe();
      pendingEvents.length = 0;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [refreshContextUsage, refreshState, currentProject, showToast]);

  const openProject = useCallback(async () => {
    const project = await window.maximoDesktop.chooseProject();
    if (!project) return;
     const loaded = await window.maximoDesktop.loadState(); setState(loaded);
     const next = await window.maximoDesktop.createThread(project.id); setState(next); rememberThread(next.selectedThreadId); setActiveSurface("chat"); setSidebarOpen(false);
  }, [rememberThread]);
  const createSpace = useCallback(async (name: string, icon: SpaceIconName): Promise<Space> => {
    const next = await window.maximoDesktop.createSpace(name, icon);
    setState(next);
    const normalizedName = name.trim().replace(/\s+/g, " ").slice(0, 32).toLowerCase();
    const created = next.spaces.find((space) => space.name.toLowerCase() === normalizedName);
    if (!created) throw new Error("The new space could not be selected.");
    return created;
  }, []);
  const createProject = useCallback(async (name: string, sourcePaths: string[], spaceId: string | null) => {
    const next = await window.maximoDesktop.createProject(name, sourcePaths, spaceId);
    setState(next);
    const project = next.projects.find((candidate) => candidate.id === next.selectedProjectId);
    if (project) {
      const withThread = await window.maximoDesktop.createThread(project.id);
      setState(withThread);
      rememberThread(withThread.selectedThreadId);
      setActiveSurface("chat");
    }
    setSidebarOpen(false);
  }, [rememberThread]);
  const newThread = useCallback(async (projectId?: string) => {
    let id = projectId;
    if (!id) { await openProject(); return; }
    const next = await window.maximoDesktop.createThread(id);
     setState(next); rememberThread(next.selectedThreadId); setActiveSurface("chat"); setSidebarOpen(false);
  }, [openProject, rememberThread]);

  const selectThread = useCallback(async (threadId: string, surface: WorkspaceSurface = "chat") => {
    const next = await window.maximoDesktop.selectThread(threadId);
    setState(next); rememberThread(next.selectedThreadId ?? threadId); setActiveSurface(surface); setSidebarOpen(false);
  }, [rememberThread]);

  const markAllNotificationsRead = useCallback(async () => {
    setState(await window.maximoDesktop.markAllNotificationsRead());
  }, []);

  const selectProject = useCallback(async (projectId: string) => {
    setState(await window.maximoDesktop.selectProject(projectId));
    setActiveSurface("chat");
    setSidebarOpen(false);
  }, []);
  const navigateSurface = useCallback((surface: WorkspaceSurface) => {
    setActiveSurface(surface);
    setSidebarOpen(false);
    if (surface !== "chat") {
      setEnvironmentOpen(false);
      setInspectorVisible(false);
    }
  }, []);
  const markThreadRead = useCallback(async (threadId: string) => {
    setState(await window.maximoDesktop.markThreadRead(threadId));
  }, []);

  const requestDockPane = useCallback((kind: WorkspacePaneKind, filePath?: string, url?: string) => {
    setInspectorVisible(true);
    setDockRequest({ id: Date.now(), kind, ...(filePath ? { filePath } : {}), ...(url ? { url } : {}) });
  }, []);

  useEffect(() => {
    const unsubscribe = window.maximoDesktop.browser.onOpenPanelRequest(({ threadId }) => {
      void (async () => {
        try {
          if (currentThread?.id !== threadId) await selectThread(threadId);
          requestDockPane("browser");
        } catch {
          showToast("The browser could not open for that chat.");
        }
      })();
    });
    return unsubscribe;
  }, [currentThread?.id, requestDockPane, selectThread]);

  const ensureSideChat = useCallback(async (): Promise<string | null> => {
    if (!currentProject) return null;
    if (sideChatThreadId && state?.threads.some((thread) => thread.id === sideChatThreadId)) return sideChatThreadId;
    const hostThreadId = currentThread?.id;
    const created = await window.maximoDesktop.createThread(currentProject.id);
    const createdId = created.selectedThreadId;
    if (!createdId) return null;
    const restored = hostThreadId ? await window.maximoDesktop.selectThread(hostThreadId) : created;
    setState(restored);
    setSideChatThreadId(createdId);
    return createdId;
  }, [currentProject, currentThread?.id, sideChatThreadId, state?.threads]);

  const createSideChat = useCallback(() => { void ensureSideChat(); }, [ensureSideChat]);

  const sendSideChat = useCallback(async (prompt: string) => {
    const threadId = await ensureSideChat();
    if (!threadId || !state) return;
    const sideThread = state.threads.find((thread) => thread.id === threadId);
    if (sideThread?.status === "running") return;
    const result = await window.maximoDesktop.startRun({
      threadId,
      prompt,
      attachments: [],
      model: sideThread?.model ?? state.settings.defaultModel,
      effort: sideThread?.effort ?? state.settings.defaultEffort,
      permission: sideThread?.permission ?? state.settings.defaultPermission,
    });
    if (result.state) setState(result.state);
    if (!result.accepted) showToast(result.error ?? "Unable to start the side chat.");
  }, [ensureSideChat, state]);

  const goBack = useCallback(async () => {
    const nextIndex = navigation.index - 1;
    const threadId = navigation.ids[nextIndex];
    if (!threadId) return;
    setNavigation((current) => current.index === navigation.index ? { ...current, index: nextIndex } : current);
    try { setState(await window.maximoDesktop.selectThread(threadId)); setSidebarOpen(false); } catch { showToast("That chat is no longer available."); }
  }, [navigation]);

  const goForward = useCallback(async () => {
    const nextIndex = navigation.index + 1;
    const threadId = navigation.ids[nextIndex];
    if (!threadId) return;
    setNavigation((current) => current.index === navigation.index ? { ...current, index: nextIndex } : current);
    try { setState(await window.maximoDesktop.selectThread(threadId)); setSidebarOpen(false); } catch { showToast("That chat is no longer available."); }
  }, [navigation]);

  const openDiff = useCallback(async (path: string, knownDiff?: GitDiff) => {
    if (!currentProject) return;
    const projectPath = currentProject.path.replace(/\\/g, "/").replace(/\/+$/, "");
    const candidatePath = path.replace(/\\/g, "/");
    const reviewPath = candidatePath.startsWith(`${projectPath}/`) ? candidatePath.slice(projectPath.length + 1) : candidatePath.replace(/^\.\//, "");
    setInspectorVisible(true);
    setReviewFile(reviewPath);
    if (knownDiff) {
      setReviewDiff({ path: reviewPath, patch: knownDiff.patch });
      return;
    }
    setReviewDiff(null);
    try {
      setReviewDiff(await window.maximoDesktop.gitDiff(currentProject.id, reviewPath));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to read the Git diff.");
      setReviewFile(null);
    }
  }, [currentProject]);

  const jumpToMessage = useCallback((messageId: string) => {
    const element = document.getElementById(`message-${messageId}`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.remove("message-jump-target");
    window.requestAnimationFrame(() => {
      element.classList.add("message-jump-target");
      window.setTimeout(() => element.classList.remove("message-jump-target"), 1_500);
    });
  }, []);

  const updateThreadEnvironment = useCallback((operation: Promise<AppState>) => {
    void operation.then(setState).catch((error) => showToast(error instanceof Error ? error.message : "Unable to update chat environment."));
  }, [showToast]);
  const toggleMessagePin = useCallback((messageId: string) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.toggleMessagePinned(currentThread.id, messageId));
  }, [currentThread, updateThreadEnvironment]);
  const setMessagePinDone = (messageId: string, done: boolean) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.setMessagePinDone(currentThread.id, messageId, done));
  };
  const removeMessagePin = (messageId: string) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.removeMessagePin(currentThread.id, messageId));
  };
  const renameMessagePin = (messageId: string, label: string | null) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.setMessagePinLabel(currentThread.id, messageId, label));
  };
  const setThreadMarkerDone = (markerId: string, done: boolean) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.setThreadMarkerDone(currentThread.id, markerId, done));
  };
  const removeThreadMarker = (markerId: string) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.removeThreadMarker(currentThread.id, markerId));
  };
  const renameThreadMarker = (markerId: string, label: string | null) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.setThreadMarkerLabel(currentThread.id, markerId, label));
  };
  const updateThreadNotes = useCallback((notes: string) => {
    if (currentThread) updateThreadEnvironment(window.maximoDesktop.updateThreadNotes(currentThread.id, notes));
  }, [currentThread]);

  const resizeSidebar = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const maxWidth = Math.max(260, Math.min(500, window.innerWidth - (inspectorVisible ? inspectorWidth : 0) - 420));
      setSidebarWidth(Math.max(260, Math.min(maxWidth, startWidth + moveEvent.clientX - startX)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, [inspectorWidth, inspectorVisible, sidebarWidth]);

  const resizeInspector = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const maxWidth = Math.max(310, Math.min(680, window.innerWidth - (sidebarVisible ? sidebarWidth : 0) - 420));
      setInspectorWidth(Math.max(310, Math.min(maxWidth, startWidth - (moveEvent.clientX - startX))));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, [inspectorWidth, sidebarVisible, sidebarWidth]);

  useEffect(() => {
    if (!currentProject) { setGit(null); return; }
    setGit(null); void window.maximoDesktop.gitStatus(currentProject.id).then(setGit);
  }, [currentProject?.id]);

  useEffect(() => {
    setReviewFile(null);
    setReviewDiff(null);
    setSideChatThreadId(null);
  }, [currentProject?.id]);

  useEffect(() => window.maximoDesktop.onMenuAction((action) => {
    if (action === "new-thread") void newThread(state?.selectedProjectId);
    if (action === "open-project") void openProject();
    if (action === "open-folder") void openProject();
    if (action === "toggle-sidebar") setSidebarVisible((value) => !value);
    if (action === "toggle-inspector") setInspectorVisible((value) => !value);
    if (action === "update-available") {
      void window.maximoDesktop.getUpdateState().then((next) => {
        setUpdateState(next);
        if (next.status === "available") {
          showToast(`Version ${next.availableVersion ?? "update"} is available. Use the Update button to download it.`);
        }
      }).catch(() => undefined);
    }
  }), [newThread, openProject, showToast, state?.selectedProjectId]);

  useEffect(() => window.maximoDesktop.onUpdateState((next) => {
    setUpdateState(next);
  }), []);

  useEffect(() => window.maximoDesktop.notifications.onOpenThread((threadId) => {
    void selectThread(threadId).catch(() => showToast("That notification chat is no longer available."));
  }), [selectThread, showToast]);

  const checkForAppUpdates = useCallback(async () => {
    try {
      const next = await window.maximoDesktop.checkForUpdates();
      setUpdateState(next);
      if (next.status === "available") {
        showToast(`Version ${next.availableVersion ?? "a newer build"} is available.`);
      } else if (next.status === "up-to-date") {
        showToast(`You're up to date on ${next.currentVersion}.`);
      } else if (next.status === "error") {
        showToast(next.message || "Could not check for updates.");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not check for updates.");
    }
  }, [showToast]);

  const openAppUpdateDownload = useCallback(async () => {
    try {
      const result = await window.maximoDesktop.openUpdateDownload();
      setUpdateState(result.state);
      if (result.opened) {
        showToast(result.state.downloadUrl
          ? `Downloading Maximo Syntax ${result.state.availableVersion ?? ""}. Open the installer when it finishes.`.trim()
          : "Opened the GitHub release page so you can download the update.");
        return;
      }
      if (result.state.status === "up-to-date") {
        showToast(`You're up to date on ${result.state.currentVersion}.`);
        return;
      }
      showToast(result.state.message || "No update download is available right now.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the update download.");
    }
  }, [showToast]);

  const refreshWhatsNew = useCallback(async (options?: { forceDialog?: boolean }) => {
    try {
      const snapshot = await window.maximoDesktop.loadWhatsNew();
      setWhatsNew(snapshot);
      if (options?.forceDialog) {
        if (snapshot.currentEntry || snapshot.allEntries[0]) {
          // Manual open from Settings: prefer current entry, else newest notes.
          setWhatsNew((current) => {
            if (current?.currentEntry) return current;
            const entry = snapshot.currentEntry ?? snapshot.allEntries[0] ?? null;
            if (!entry) return snapshot;
            return {
              ...snapshot,
              decision: "show",
              currentEntry: entry,
            };
          });
          setWhatsNewDialogOpen(true);
          setWhatsNewPopoutVisible(false);
        } else {
          showToast("No release notes are available yet for this build.");
        }
        return;
      }
      setWhatsNewPopoutVisible(snapshot.decision === "show" && Boolean(snapshot.currentEntry));
    } catch {
      // Release notes are optional; never block the workspace.
    }
  }, [showToast]);

  const dismissWhatsNewPopout = useCallback(() => {
    setWhatsNewPopoutVisible(false);
    const version = whatsNew?.nextLastSeenVersion ?? whatsNew?.currentVersion ?? appVersion;
    void window.maximoDesktop.markWhatsNewSeen(version || undefined).then(setState).catch(() => undefined);
  }, [appVersion, whatsNew]);

  const closeWhatsNewDialog = useCallback(() => {
    setWhatsNewDialogOpen(false);
    setWhatsNewPopoutVisible(false);
    const version = whatsNew?.nextLastSeenVersion ?? whatsNew?.currentVersion ?? appVersion;
    void window.maximoDesktop.markWhatsNewSeen(version || undefined).then(setState).catch(() => undefined);
  }, [appVersion, whatsNew]);

  const openWhatsNewDialog = useCallback(() => {
    setWhatsNewDialogOpen(true);
  }, []);

  useEffect(() => {
    if (!state?.onboardingComplete || !account?.loggedIn) return;
    void refreshWhatsNew();
  }, [account?.loggedIn, refreshWhatsNew, state?.onboardingComplete]);

  const refreshAccount = async () => {
    setAccountBusy(true);
    try {
      setAccount(await window.maximoDesktop.accountStatus());
      setAccountLoaded(true);
    } finally {
      setAccountBusy(false);
    }
  };
  const openAccount = () => { setAccountOpen(true); void refreshAccount(); };
  const refreshUsage = async () => {
    setUsageBusy(true);
    try { setUsage(await window.maximoDesktop.accountUsage()); } finally { setUsageBusy(false); }
  };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setCreateProjectOpen(false);
        setAttachmentPreview(null);
        if (settingsOpen) setSettingsOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=\"true\"]") && !event.metaKey && !event.ctrlKey && !event.altKey) return;
      const matches = MAXIMO_SHORTCUTS.filter((definition) => matchesShortcut(event, definition.chord));
      const definition = (inspectorVisible
        ? matches.find((item) => item.command === "terminal.workspace.terminal" || item.command === "terminal.workspace.chat")
        : undefined) ?? matches[0];
      if (!definition || (settingsOpen && definition.command !== "shortcuts.show")) return;
      event.preventDefault();
      const command = definition.command;
      if (command === "shortcuts.show") { setSettingsSectionRequest("shortcuts"); setSettingsOpen(true); return; }
      if (command === "sidebar.toggle") { if (window.innerWidth <= 900) setSidebarOpen(true); else setSidebarVisible((value) => !value); return; }
      if (command === "sidebar.addProject" || command === "sidebar.importThread" || command === "project.open") { void openProject(); return; }
      if (command === "workspace.openFiles") { requestDockPane("explorer"); return; }
      if (command === "workspace.toggleDock") { setInspectorVisible((value) => !value); return; }
      if (command === "sidebar.search") { setSearchOpen(true); return; }
      if (command === "sidebar.activity") { navigateSurface(activeSurface === "activity" ? "chat" : "activity"); return; }
      if (command === "settings.usage") { openAccount(); void refreshUsage(); return; }
      if (command === "chat.new" || command === "chat.newChat" || command === "chat.newClaude" || command === "chat.newCodex" || command === "chat.newCursor") { void newThread(state?.selectedProjectId); return; }
      if (command === "chat.newLatestProject") { const latest = [...(state?.projects ?? [])].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)[0]; void newThread(latest?.id); return; }
      if (command === "chat.newTerminal") {
        const projectId = state?.selectedProjectId;
        if (!projectId) return;
        void window.maximoDesktop.createThread(projectId).then((next) => { setState(next); rememberThread(next.selectedThreadId); setActiveSurface("chat"); requestDockPane("terminal"); });
        return;
      }
      if (command === "chat.split") { requestDockPane("sidechat"); return; }
      if (command === "view.recent.previous") { void goBack(); return; }
      if (command === "view.recent.next") { void goForward(); return; }
      if (command === "composer.focus.toggle") { document.querySelector<HTMLElement>(".composer-input")?.focus(); return; }
      if (command === "modelPicker.toggle") { window.dispatchEvent(new CustomEvent("maximo:model-picker", { detail: "model" })); return; }
      if (command === "traitsPicker.toggle") { window.dispatchEvent(new CustomEvent("maximo:model-picker", { detail: "effort" })); return; }
      if (command === "model.next" || command === "model.previous") { window.dispatchEvent(new CustomEvent("maximo:model-cycle", { detail: command === "model.next" ? 1 : -1 })); return; }
      if (command === "terminal.toggle") { requestDockPane("terminal"); return; }
      if (command === "diff.toggle") { requestDockPane("diff"); return; }
      if (command === "browser.toggle") { requestDockPane("browser"); return; }
      if (command === "editor.openFavorite") { if (currentProject) void window.maximoDesktop.openInEditor(currentProject.path); return; }
      if (command === "git.commitAndPush") { requestDockPane("git"); return; }
      if (command === "terminal.workspace.newFullWidth") { requestDockPane("terminal"); return; }
      if (command === "terminal.workspace.closeActive") { window.dispatchEvent(new Event("maximo:workspace-close-active")); return; }
      if (command === "terminal.workspace.terminal" || command === "terminal.workspace.chat") { window.dispatchEvent(new CustomEvent("maximo:workspace-select", { detail: command.endsWith("terminal") ? "terminal" : "chat" })); return; }
      if (command.startsWith("space.jump.")) {
        const index = Number(command.split(".").at(-1)) - 1;
        const spaceId = index === 0 ? null : state?.spaces[index - 1]?.id ?? null;
        void window.maximoDesktop.selectSpace(spaceId).then(setState);
        return;
      }
      if (command === "space.previous" || command === "space.next") {
        const spaces: Array<string | null> = [null, ...(state?.spaces ?? []).map((space) => space.id)];
        const current = spaces.indexOf(state?.selectedSpaceId ?? null);
        const offset = command === "space.next" ? 1 : -1;
        const next = spaces[(current + offset + spaces.length) % spaces.length] ?? null;
        void window.maximoDesktop.selectSpace(next).then(setState);
        return;
      }
      if (command.startsWith("thread.jump.")) {
        const index = Number(command.split(".").at(-1)) - 1;
        const threads = (state?.threads ?? []).filter((thread) => !thread.archived && thread.messages.length > 0).sort((left, right) => right.updatedAt - left.updatedAt);
        const targetThread = threads[index];
        if (targetThread) void selectThread(targetThread.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSurface, currentProject, goBack, goForward, inspectorVisible, navigateSurface, newThread, openAccount, openProject, refreshUsage, rememberThread, requestDockPane, selectThread, settingsOpen, state]);
  const resetProviderState = async () => {
    invalidateProviderState();
    try {
      setState(await window.maximoDesktop.resetProviderSelections());
    } catch {
      showToast("Provider settings could not be reset locally.");
    }
  };
  const loginAccount = async (method: LoginMethod, apiKey?: string, openCodePlan?: OpenCodePlan): Promise<boolean> => {
    if (account?.loggedIn && !window.confirm("Sign out of the current account and continue with another sign-in method?")) return false;
    setAccountBusy(true);
    try {
      await resetProviderState();
      if (account?.loggedIn) await window.maximoDesktop.accountLogout();
      const result = await window.maximoDesktop.accountLogin(method, apiKey, openCodePlan);
      setAccount(result.status); setUsage(null); showToast(result.message);
      if (result.ok) {
        await refreshEngineModels(true);
        void refreshUsage();
      }
      return result.ok;
    } finally { setAccountBusy(false); }
  };
  const cancelLoginAccount = async () => {
    if (!accountBusy) return;
    try {
      const result = await window.maximoDesktop.accountCancelLogin();
      if (result.message) showToast(result.message);
    } catch {
      showToast("Unable to cancel sign-in.");
    }
  };
  const logoutAccount = async () => {
    if (!window.confirm("Sign out of Maximo Syntax on this computer?")) return;
    setAccountBusy(true);
    try {
      await resetProviderState();
      const result = await window.maximoDesktop.accountLogout();
      setAccount(result.status);
      showToast(result.message);
    } finally { setAccountBusy(false); }
  };
  const flushQueuedFollowUp = useCallback((threadId: string, requestedItem?: QueuedFollowUp) => {
    const previous = followUpDispatchesRef.current[threadId] ?? Promise.resolve();
    const operation = previous.then(async () => {
      const item = requestedItem ?? followUpQueuesRef.current[threadId]?.[0];
      if (!item) return;
      setFollowUpQueues((current) => ({
        ...current,
        [threadId]: (current[threadId] ?? []).filter((entry) => entry.id !== item.id),
      }));
      try {
        const result = await window.maximoDesktop.sendToRun({
          threadId,
          prompt: item.prompt,
          attachments: item.attachments,
          model: item.model,
          effort: item.effort,
          permission: item.permission,
          asFollowUp: true,
        });
        if (result.state) setState(result.state);
        if (!result.accepted) {
          showToast(result.error ?? "Unable to send queued follow-up.");
          setFollowUpQueues((current) => ({
            ...current,
            [threadId]: [item, ...(current[threadId] ?? [])],
          }));
          await refreshState().catch(() => undefined);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Unable to send queued follow-up.");
        setFollowUpQueues((current) => ({
          ...current,
          [threadId]: [item, ...(current[threadId] ?? [])],
        }));
        await refreshState().catch(() => undefined);
      }
    });
    let tracked: Promise<void>;
    tracked = operation.finally(() => {
      if (followUpDispatchesRef.current[threadId] === tracked) delete followUpDispatchesRef.current[threadId];
    });
    followUpDispatchesRef.current[threadId] = tracked;
    return tracked;
  }, [refreshState]);
  flushQueuedFollowUpRef.current = flushQueuedFollowUp;

  const sendPrompt = async (prompt: string, attachments: Attachment[], model: string, effort: string, permission: PermissionMode, contextWindow?: number) => {
    if (!currentThread) return;
    const midTurn = currentThread.status === "running";
    // Mid-turn: queue in the composer, then hand it to the CLI immediately.
    // The runner writes it at the next tool-result boundary so the Maximo
    // Syntax CLI can inject it into the current task before its next request.
    if (midTurn) {
      const item: QueuedFollowUp = {
        id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `followup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        prompt,
        attachments,
        model,
        effort,
        permission,
      };
      setFollowUpQueues((current) => ({
        ...current,
        [currentThread.id]: [...(current[currentThread.id] ?? []), item],
      }));
      if (state?.settings.followUpBehavior === "steer") {
        void flushQueuedFollowUpRef.current(currentThread.id, item);
      }
      return;
    }
    const sessionAlive = liveSessions.has(currentThread.id);
    const result = sessionAlive
      ? await window.maximoDesktop.sendToRun({ threadId: currentThread.id, prompt, attachments, model, effort, permission, contextWindow })
      : await window.maximoDesktop.startRun({ threadId: currentThread.id, prompt, attachments, model, effort, permission, contextWindow });
    if (result.state) setState(result.state);
    if (!result.accepted) { showToast(result.error ?? "Unable to start the task."); await refreshState(); }
  };

  const editAndResendMessage = async (messageId: string, text: string) => {
    const thread = currentThread;
    if (!thread) return;
    const model = thread.model ?? state?.settings.defaultModel ?? "";
    const effort = thread.effort ?? state?.settings.defaultEffort ?? "";
    const permission = thread.permission ?? state?.settings.defaultPermission ?? "auto";
    const result = await window.maximoDesktop.editAndResendMessage({
      threadId: thread.id,
      prompt: text,
      attachments: [],
      model,
      effort,
      permission,
      editMessageId: messageId,
    });
    if (result.state) setState(result.state);
    if (!result.accepted) showToast(result.error ?? "Unable to edit and resend the message.");
    else showToast("Message edited and resent.");
  };

  const revertToMessage = async (messageId: string, revertFiles: boolean) => {
    const thread = currentThread;
    if (!thread) return;
    // Try the full revert (transcript + files) first; if the file checkpoint is
    // unavailable, fall back to transcript-only so the conversation can still
    // be rolled back.
    const result = revertFiles
      ? await window.maximoDesktop.revertToMessage({ threadId: thread.id, messageId, revertFiles: true })
      : await window.maximoDesktop.revertToMessage({ threadId: thread.id, messageId, revertFiles: false });
    if (result.state) setState(result.state);
    if (!result.ok) {
      if (revertFiles) {
        const fallback = await window.maximoDesktop.revertToMessage({ threadId: thread.id, messageId, revertFiles: false });
        if (fallback.state) setState(fallback.state);
        if (fallback.ok) {
          const removed = typeof fallback.removedMessages === "number" ? fallback.removedMessages : 0;
          showToast(`Reverted to this message · ${removed} message${removed === 1 ? "" : "s"} discarded. File restore wasn't available (${result.error ?? "no file checkpoint"}).`);
          return;
        }
      }
      showToast(result.error ?? "Unable to revert the conversation.");
      await refreshState();
      return;
    }
    const removed = typeof result.removedMessages === "number" ? result.removedMessages : 0;
    const restored = typeof result.restoredFiles === "number" ? result.restoredFiles : 0;
    if (revertFiles) showToast(`Reverted to this message · ${removed} message${removed === 1 ? "" : "s"} discarded, ${restored} file${restored === 1 ? "" : "s"} restored.`);
    else showToast(`Reverted to this message · ${removed} message${removed === 1 ? "" : "s"} discarded.`);
  };

  const removeQueuedFollowUp = (threadId: string, id: string) => {
    setFollowUpQueues((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((item) => item.id !== id),
    }));
  };

  const editQueuedFollowUp = (threadId: string, item: QueuedFollowUp) => {
    removeQueuedFollowUp(threadId, item.id);
  };

  const submitAnswers = async (answers: Record<string, string>) => {
    const target = pendingQuestion;
    if (!target) return;
    let original: Record<string, unknown> = {};
    try { original = JSON.parse(target.data) as Record<string, unknown>; } catch { /* keep the request valid with an empty input */ }
    const result = await window.maximoDesktop.respondToPermission(target.threadId, {
      requestId: target.requestId,
      behavior: "allow",
      updatedInput: { ...original, answers },
      toolUseID: target.toolUseId,
    });
    if (!result) { showToast("The question request is no longer active."); return; }
    try {
      setState(await window.maximoDesktop.recordQuestionInteraction(target.threadId, questionInteractionAnswers(target.questions, answers, "Skipped"), target.toolUseId));
    } catch {
      showToast("The answer was sent, but it could not be added to the chat history.");
    }
    setPendingQuestion((current) => current?.requestId === target.requestId ? null : current);
  };

  const skipQuestion = async () => {
    const target = pendingQuestion;
    if (!target) return;
    const result = await window.maximoDesktop.respondToPermission(target.threadId, {
      requestId: target.requestId,
      behavior: "deny",
      message: "Question skipped by the user.",
      toolUseID: target.toolUseId,
    });
    if (!result) { showToast("The question request is no longer active."); return; }
    try {
      setState(await window.maximoDesktop.recordQuestionInteraction(target.threadId, questionInteractionAnswers(target.questions, {}, "Skipped"), target.toolUseId));
    } catch {
      showToast("The skipped question could not be added to the chat history.");
    }
    setPendingQuestion((current) => current?.requestId === target.requestId ? null : current);
  };

  const respondToPermission = async (decision: "approve" | "deny", remember: boolean) => {
    const target = pendingPermission;
    if (!target) return;
    const response = {
      requestId: target.requestId,
      behavior: decision === "approve" ? "allow" as const : "deny" as const,
      updatedInput: decision === "approve" ? (() => { try { return JSON.parse(target.data) as Record<string, unknown>; } catch { return {}; } })() : undefined,
      message: decision === "deny" ? "Permission denied by the user." : undefined,
      toolUseID: target.toolUseId,
      ...(remember ? { updatedPermissions: [] } : {}),
    };
    const result = await window.maximoDesktop.respondToPermission(target.threadId, response);
    if (!result) { showToast("This permission request is no longer active."); return; }
    try {
      setState(await window.maximoDesktop.recordPermissionInteraction(target.threadId, {
        toolName: target.payload.toolName,
        decision: decision === "approve" ? "approved" : "denied",
        detail: target.payload.detail,
        remember,
        toolUseId: target.toolUseId,
      }));
    } catch {
      showToast("The permission decision was sent, but it could not be added to the chat history.");
    }
    setPendingPermission((current) => current?.requestId === target.requestId ? null : current);
  };

  if (!state) return <SetupGate status={engine} onRetry={() => void window.maximoDesktop.ensureEngine(true).then(setEngine)} onContinue={() => undefined} />;
  if (!state.onboardingComplete) return <SetupGate status={engine} onRetry={() => void window.maximoDesktop.ensureEngine(true).then(setEngine)} onContinue={() => void window.maximoDesktop.completeOnboarding().then(setState)} />;
  if (!accountLoaded) {
    return (
      <>
        <AccountLoadingGate theme={state.settings.theme} />
        {toast && <div className="toast"><AlertCircle size={15} />{toast}</div>}
      </>
    );
  }
  if (!account?.loggedIn) {
    return (
      <>
        <SignInGate
          theme={state.settings.theme}
          busy={accountBusy}
          onLogin={loginAccount}
          onCancelLogin={() => void cancelLoginAccount()}
          onRefresh={() => void refreshAccount()}
        />
        {toast && <div className="toast"><AlertCircle size={15} />{toast}</div>}
      </>
    );
  }

  return (
    <div className={`app-shell theme-${state.settings.theme} density-${state.settings.uiDensity} ${state.settings.useSystemUiFont ? "system-ui-font" : ""} ${sidebarVisible ? "" : "sidebar-hidden"} ${inspectorVisible ? "" : "inspector-hidden"}`} style={{ ...appearanceVariables, "--sidebar-width": `${sidebarWidth}px`, "--inspector-width": `${inspectorWidth}px` } as CSSProperties}>

       <Sidebar state={state} currentThread={currentThread} account={account} timestampFormat={state.settings.timestampFormat} activeSurface={activeSurface} onNavigateSurface={navigateSurface} onOpenProject={openProject} onCreateProject={() => setCreateProjectOpen(true)} onNewThread={newThread}
         onSelectProject={(id) => void selectProject(id)} onSelectThread={(id, surface) => void selectThread(id, surface)} onOpenSearch={() => setSearchOpen(true)} onToggleSidebar={() => window.innerWidth <= 900 ? setSidebarOpen(false) : setSidebarVisible((value) => !value)} onBack={() => void goBack()} onForward={() => void goForward()} canGoBack={navigation.index > 0} canGoForward={navigation.index >= 0 && navigation.index < navigation.ids.length - 1} onSettings={() => setSettingsOpen(true)} onAccount={openAccount}
         onUsage={() => { setAccountOpen(true); void refreshUsage(); }} onLogout={() => void logoutAccount()} onMarkThreadRead={(id) => void markThreadRead(id)} onMarkAllNotificationsRead={() => void markAllNotificationsRead()}
          onDeleteThread={(id) => { if (state.settings.confirmThreadDelete && !window.confirm("Delete this chat from Maximo Syntax Desktop? The project files will not be touched.")) return; void window.maximoDesktop.deleteThread(id).then(setState); }}
          onRenameThread={(id) => { const thread = state.threads.find((item) => item.id === id); const title = window.prompt("Rename chat", thread?.title ?? ""); if (title?.trim()) void window.maximoDesktop.renameThread(id, title).then(setState); }}
          onToggleThreadPinned={(id) => void window.maximoDesktop.toggleThreadPinned(id).then(setState)}
          onArchiveThread={(id) => { if (state.settings.confirmThreadArchive && !window.confirm("Archive this chat? You can restore it from Settings.")) return; void window.maximoDesktop.archiveThread(id).then(setState); }}
         onRenameProject={(id) => { const project = state.projects.find((item) => item.id === id); const name = window.prompt("Rename project", project?.name ?? ""); if (name?.trim()) void window.maximoDesktop.renameProject(id, name).then(setState); }}
          onToggleProjectPinned={(id) => void window.maximoDesktop.toggleProjectPinned(id).then(setState)}
          onReorderProject={(sourceId, targetId) => void window.maximoDesktop.reorderProjects(sourceId, targetId).then(setState).catch(() => showToast("Unable to reorder projects."))}
          onSelectSpace={(spaceId) => void window.maximoDesktop.selectSpace(spaceId).then(setState).catch(() => showToast("Unable to switch spaces."))}
          onCreateSpace={createSpace}
           onArchiveProjectThreads={(id) => { if (state.settings.confirmThreadArchive && !window.confirm("Archive all sent chats in this project? You can still start a new chat.")) return; void window.maximoDesktop.archiveProjectThreads(id).then(setState); }}
        onRemoveProject={(id) => { if (window.confirm("Remove this project from Maximo Syntax Desktop? Its files will stay on disk.")) void window.maximoDesktop.removeProject(id).then(setState); }}
        onResize={resizeSidebar}
        open={sidebarOpen} onClose={() => setSidebarOpen(false)}
        updateState={updateState}
        onUpdateAction={() => { void openAppUpdateDownload(); }} />
      <section className="workspace">
        <header className="topbar drag-region">
          <div className="topbar-left"><button className="topbar-button no-drag" onClick={() => window.innerWidth <= 900 ? setSidebarOpen(true) : setSidebarVisible((value) => !value)} title="Toggle sidebar">{sidebarVisible ? <PanelLeft size={16} /> : <Menu size={16} />}</button>{currentProject && <><FolderOpen size={14} /><span>{currentProject.name}</span></>}{currentThread && <><span className="crumb">/</span><strong>{currentThread.title}</strong></>}</div>
          <div className="topbar-right no-drag">
             {engine?.available && <span className="engine-ready"><i />CLI {engine.version}</span>}
               {activeSurface === "chat" && currentProject && <button className={`topbar-button ${environmentOpen && !inspectorVisible ? "active" : ""}`} onClick={toggleEnvironment} title="Toggle environment"><HardDrive size={16} /></button>}
              {activeSurface === "chat" && <button className="topbar-button" onClick={() => setInspectorVisible((value) => !value)} title="Toggle inspector"><PanelRight size={16} /></button>}
            <button className="topbar-button" onClick={() => setSettingsOpen(true)} title="Settings"><Settings size={16} /></button>
          </div>
        </header>
             <main className={`main-stage ${activeSurface !== "chat" && activeSurface !== "activity" ? "surface-stage" : environmentOpen && !inspectorVisible ? "environment-reserved" : ""}`}>
             {activeSurface === "kanban" ? <KanbanView state={state} currentProject={currentProject} onOpenThread={selectThread} onNewThread={(projectId) => void newThread(projectId)} /> : activeSurface === "pull-requests" ? <PullRequestsView project={currentProject} /> : <>
            {currentProject && <WorkspaceEnvironment
              open={environmentOpen && !inspectorVisible}
               project={currentProject}
               thread={currentThread}
               git={git}
               activity={currentThread ? liveRuns[currentThread.id]?.activity : undefined}
               onJumpToMessage={jumpToMessage}
              onTogglePinDone={setMessagePinDone}
              onRemovePin={removeMessagePin}
              onRenamePin={renameMessagePin}
              onToggleMarkerDone={setThreadMarkerDone}
              onRemoveMarker={removeThreadMarker}
              onRenameMarker={renameThreadMarker}
              onUpdateNotes={updateThreadNotes}
              onOpenDock={(kind) => requestDockPane(kind)}
             onOpenBrowser={(url) => requestDockPane("browser", undefined, url)}
             onReveal={() => void window.maximoDesktop.revealPath(currentProject.path)}
               onOpenEditor={() => void window.maximoDesktop.openInEditor(currentProject.path)}
               onRefresh={() => { setGit(null); void window.maximoDesktop.gitStatus(currentProject.id).then(setGit); }}
               onSettings={() => setSettingsOpen(true)}
               onUsage={() => { setAccountOpen(true); void refreshUsage(); }}
               settings={state.settings}
             />}
            {!inspectorVisible && currentProject && <div className={`workspace-edge-rail ${environmentOpen ? "environment-open" : ""}`} aria-label="Workspace tools">
              <button type="button" className={environmentOpen ? "active" : ""} onClick={toggleEnvironment} title="Toggle environment"><HardDrive size={14} /></button>
             <button type="button" onClick={() => requestDockPane("explorer")} title="Open files"><Folders size={14} /></button>
             <button type="button" onClick={() => requestDockPane("git")} title="Open source control"><GitBranch size={14} /></button>
             <button type="button" onClick={() => requestDockPane("terminal")} title="Open terminal"><TerminalSquare size={14} /></button>
           </div>}
           {!currentThread ? <EmptyWorkspace project={currentProject} onOpenProject={openProject} onNewThread={() => void newThread(currentProject?.id)} /> : <>
                 <MessageView thread={currentThread} project={currentProject} git={git} models={engineModels} live={liveRuns[currentThread.id]} waiting={pendingQuestion?.threadId === currentThread.id || pendingPermission?.threadId === currentThread.id} skillNames={skillNames} timestampFormat={state.settings.timestampFormat} streamingEnabled={state.settings.enableAssistantStreaming} onPreviewAttachment={openAttachmentPreview} onOpenFile={openDiff} onTogglePin={toggleMessagePin} onEditResend={(messageId, text) => void editAndResendMessage(messageId, text)} onRevert={(messageId, revertFiles) => void revertToMessage(messageId, revertFiles)} />
              <MessageTrail thread={currentThread} onSelect={jumpToMessage} />
             <Composer key={currentThread.id} thread={currentThread} project={currentProject} git={git} live={liveRuns[currentThread.id]} settings={state.settings} models={engineModels} modelOptions={modelOptions} slashCommands={slashCommands} skillCommands={skillCommands} discoveredSkills={discoveredSkills} contextUsage={currentContextUsage} contextLoading={Boolean(contextLoadingByThread[currentThread.id])} onRefreshContext={() => refreshContextUsage(currentThread.id)} onSend={sendPrompt} onPreviewAttachment={openAttachmentPreview}
              onStop={() => {
                setFollowUpQueues((current) => {
                  if (!current[currentThread.id]?.length) return current;
                  const next = { ...current };
                  delete next[currentThread.id];
                  return next;
                });
                void window.maximoDesktop.stopRun(currentThread.id);
              }}
              onOpenProject={openProject} onAccountUsage={() => { setAccountOpen(true); void refreshUsage(); }}
              onSettingsChanged={async (patch) => { const next = await window.maximoDesktop.updateSettings(patch); setState(next); }} onGitChanged={setGit}
              pendingQuestion={pendingQuestion?.threadId === currentThread.id ? pendingQuestion : undefined}
              pendingPermission={pendingPermission?.threadId === currentThread.id ? pendingPermission : undefined}
              onSubmitAnswers={(answers) => void submitAnswers(answers)} onSkipQuestion={() => void skipQuestion()}
              onApprovePermission={(remember) => void respondToPermission("approve", remember)} onDenyPermission={() => void respondToPermission("deny", false)}
              queuedFollowUps={followUpQueues[currentThread.id] ?? []}
              onRemoveQueuedFollowUp={(id) => removeQueuedFollowUp(currentThread.id, id)}
              onEditQueuedFollowUp={(item) => editQueuedFollowUp(currentThread.id, item)}
            />
           </>}
           </>}
        </main>
      </section>
      {currentProject && <WorkspaceDock
         open={inspectorVisible && !settingsOpen}
         suspendNativeSurfaces={accountOpen || whatsNewDialogOpen || Boolean(attachmentPreview)}
        project={currentProject}
        thread={currentThread}
        state={state}
        git={git}
        reviewFile={reviewFile}
        reviewDiff={reviewDiff}
        activity={currentThread ? liveRuns[currentThread.id]?.activity : undefined}
        request={dockRequest}
        sideChat={{ thread: sideChatThread, liveText: sideChatThreadId ? liveRuns[sideChatThreadId]?.text : undefined, running: sideChatThread?.status === "running" || Boolean(sideChatThreadId && liveSessions.has(sideChatThreadId)), onCreate: createSideChat, onSend: (prompt) => void sendSideChat(prompt) }}
        onRequestHandled={() => setDockRequest(null)}
        onOpenChange={setInspectorVisible}
        onOpenDiff={(path, diff) => void openDiff(path, diff)}
        onCloseReview={() => { setReviewFile(null); setReviewDiff(null); }}
        onRefreshGit={() => { setGit(null); void window.maximoDesktop.gitStatus(currentProject.id).then(setGit); }}
        onGitChanged={setGit}
        onOpenEditor={(path) => void window.maximoDesktop.openInEditor(path)}
        onReveal={(path) => void window.maximoDesktop.revealPath(path)}
        onResize={resizeInspector}
      />}
      {searchOpen && <SearchPalette
        state={state}
        onClose={() => setSearchOpen(false)}
        onSelectThread={(id) => void selectThread(id)}
        onSelectProject={(id) => void selectProject(id)}
        onNewThread={newThread}
        onOpenProject={openProject}
        onOpenFile={(projectId, path) => {
          if (currentProject?.id === projectId) requestDockPane("file", path);
          else void selectProject(projectId).then(() => requestDockPane("file", path));
        }}
        onOpenBrowser={(url) => requestDockPane("browser", undefined, url)}
      />}
      {createProjectOpen && <CreateProjectModal onClose={() => setCreateProjectOpen(false)} onChooseSources={() => window.maximoDesktop.chooseProjectSources()} onCreate={createProject} spaces={state.spaces} selectedSpaceId={state.selectedSpaceId} onCreateSpace={createSpace} />}
      {settingsOpen && <EnhancedSettingsModal state={state} engine={engine} models={engineModels} modelOptions={modelOptions} account={account} usage={usage} appVersion={appVersion} appDataPath={appDataPath} skills={[...discoveredSkills, ...skillCommands]} initialSection={settingsSectionRequest} onClose={() => { setSettingsOpen(false); setSettingsSectionRequest("general"); }} onSave={async (patch) => { const next = await window.maximoDesktop.updateSettings(patch); setState(next); setInspectorVisible(next.settings.showInspector); setEnvironmentOpen(next.settings.environmentPanelDefaultOpen); }} onRepair={async () => { const next = await window.maximoDesktop.updateEngine(); setEngine(next); if (next.available) await refreshEngineModels(); }} onAccount={() => { setSettingsOpen(false); openAccount(); }} onUsage={() => void refreshUsage()} onRefreshSkills={() => refreshDiscoveredSkills(currentProject?.path)} onResetProvider={resetProviderState} onRevealDataPath={() => { if (appDataPath) void window.maximoDesktop.revealPath(appDataPath); }} onRestoreThread={async (threadId) => { setState(await window.maximoDesktop.unarchiveThread(threadId)); }} onDeleteArchivedThread={async (threadId) => { const thread = state.threads.find((item) => item.id === threadId); if (!thread || !window.confirm(`Permanently delete "${thread.title}"? This removes the chat history forever.`)) return; setState(await window.maximoDesktop.deleteThread(threadId)); }} updateState={updateState} onCheckForUpdates={checkForAppUpdates} onOpenUpdateDownload={openAppUpdateDownload} onOpenWhatsNew={() => { void refreshWhatsNew({ forceDialog: true }); }} />}
      {accountOpen && <AccountModal account={account} usage={usage} usageBusy={usageBusy} busy={accountBusy} onClose={() => setAccountOpen(false)} onRefresh={() => void refreshAccount()} onLogin={(method, apiKey, openCodePlan) => loginAccount(method, apiKey, openCodePlan)} onCancelLogin={() => void cancelLoginAccount()} onLogout={() => void logoutAccount()} onUsage={() => void refreshUsage()} />}
      {attachmentPreview && <AttachmentPreviewModal state={attachmentPreview} theme={state.settings.theme} onClose={() => { attachmentPreviewRequestRef.current += 1; setAttachmentPreview(null); }} />}
      {whatsNewPopoutVisible && whatsNew?.currentEntry && (
        <WhatsNewPopoutCard
          entry={whatsNew.currentEntry}
          currentVersion={whatsNew.currentVersion || appVersion}
          onOpen={openWhatsNewDialog}
          onDismiss={dismissWhatsNewPopout}
        />
      )}
      <WhatsNewDialog
        open={whatsNewDialogOpen}
        currentVersion={whatsNew?.currentVersion || appVersion}
        currentEntry={whatsNew?.currentEntry ?? null}
        allEntries={whatsNew?.allEntries ?? []}
        onClose={closeWhatsNewDialog}
        onOpenReleaseUrl={(url) => { void window.maximoDesktop.openPath(url); }}
      />
      {toast && <div className="toast"><AlertCircle size={15} />{toast}</div>}
    </div>
  );
}
