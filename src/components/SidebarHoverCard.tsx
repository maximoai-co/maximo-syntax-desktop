import { Bot, CheckCircle2, CircleAlert, Clock3, Folder, FolderOpen, MessageCircle, Pin, PinOff, Settings, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Project, ThemeMode, Thread } from "../../desktop/types";
import modelLogoUrl from "../assets/maximoai-logo.svg";
import modelOpenAiUrl from "../assets/model-openai.svg";
import modelOpenAiCodexUrl from "../assets/model-openai-codex.svg";
import modelClaudeUrl from "../assets/model-claudeai.svg";
import modelGrokUrl from "../assets/model-grok.svg";
import modelGoogleUrl from "../assets/model-google.svg";
import modelDeepSeekUrl from "../assets/model-deepseek.svg";
import modelMistralUrl from "../assets/model-mistral.svg";
import modelMetaUrl from "../assets/model-meta.svg";
import modelPerplexityUrl from "../assets/model-perplexity.svg";
import modelOllamaUrl from "../assets/model-ollama.svg";

export interface SidebarHoverCardProps {
  kind: "project" | "thread";
  project?: Project;
  thread?: Thread;
  chatCount?: number;
  top: number;
  left: number;
  theme: ThemeMode;
  onToggleProjectPin?: () => void;
  onEditProject?: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

function displayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const homeMatch = normalized.match(/^\/(?:Users|home)\/[^/]+(?=\/|$)/);
  return homeMatch ? `~${normalized.slice(homeMatch[0].length)}` : normalized;
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function threadStatus(thread: Thread): { label: string; tone: "working" | "attention" | "complete" } {
  if (thread.status === "running") return { label: "Working now", tone: "working" };
  if (thread.status === "error" || thread.status === "cancelled") return { label: "Needs attention", tone: "attention" };
  if (thread.unread) return { label: "Done - unread", tone: "complete" };
  return { label: "Complete", tone: "complete" };
}

function CardRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`sidebar-hover-card-row ${className}`}>{children}</div>;
}

/** Compact model logo for the hover card's model row (shared glyph with the main chat surfaces). */
function ModelLogo({ model }: { model?: string }) {
  const raw = (model ?? "").trim().toLowerCase();
  const brand: "maximo" | "openai" | "openai-codex" | "claude" | "grok" | "google" | "deepseek" | "mistral" | "meta" | "perplexity" | "ollama" | "unknown" =
    !raw || raw === "default" || raw === "cli default" || raw === "default (recommended)" ? "maximo" : /^maximo-/.test(raw) || /(^|[\s-_])maximo/.test(raw) || /^(maximo)$/.test(raw) ? "maximo" : /^gpt-?|^o[0-9](-|$)|chatgpt/.test(raw) || /(^|[\s-_])gpt-?[0-9]/.test(raw) ? "openai" : /codex/.test(raw) ? "openai-codex" : /^claude|^anthropic/.test(raw) || /(^|[\s-_])claude/.test(raw) || /(^|[\s-_])anthropic/.test(raw) ? "claude" : /^gemini|^google/.test(raw) || /(^|[\s-_])gemini/.test(raw) ? "google" : /^grok|^xai/.test(raw) || /(^|[\s-_])grok/.test(raw) ? "grok" : /^deepseek/.test(raw) || /(^|[\s-_])deepseek/.test(raw) ? "deepseek" : /^(mistral|mixtral|codestral)/.test(raw) || /(^|[\s-_])mistral/.test(raw) ? "mistral" : /^(llama|meta)/.test(raw) || /(^|[\s-_])llama/.test(raw) || /(^|[\s-_])meta/.test(raw) ? "meta" : /^perplexity|^pplx/.test(raw) || /(^|[\s-_])perplexity/.test(raw) ? "perplexity" : /^ollama/.test(raw) || /(^|[\s-_])ollama/.test(raw) ? "ollama" : "unknown";
  const src = brand === "maximo" ? modelLogoUrl : brand === "openai" ? modelOpenAiUrl : brand === "openai-codex" ? modelOpenAiCodexUrl : brand === "claude" ? modelClaudeUrl : brand === "grok" ? modelGrokUrl : brand === "google" ? modelGoogleUrl : brand === "deepseek" ? modelDeepSeekUrl : brand === "mistral" ? modelMistralUrl : brand === "meta" ? modelMetaUrl : brand === "perplexity" ? modelPerplexityUrl : brand === "ollama" ? modelOllamaUrl : undefined;
  if (!src) return <Bot size={13} />;
  return <img className="model-logo sidebar-model-logo" src={src} alt="" aria-hidden="true" draggable={false} />;
}

function RowIcon({ children }: { children: ReactNode }) {
  return <span className="sidebar-hover-card-icon">{children}</span>;
}

export default function SidebarHoverCard({
  kind,
  project,
  thread,
  chatCount = 0,
  top,
  left,
  theme,
  onToggleProjectPin,
  onEditProject,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: SidebarHoverCardProps) {
  if (kind === "project" && project) {
    return (
      <div
        className={`sidebar-hover-card project-hover-card theme-${theme}`}
        role="dialog"
        aria-label={`${project.name} project details`}
        style={{ top, left }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <CardRow className="sidebar-hover-card-title">
          <RowIcon><FolderOpen size={14} /></RowIcon>
          <strong>{project.name}</strong>
          {onToggleProjectPin && (
            <button
              type="button"
              className="sidebar-hover-card-pin"
              aria-label={project.pinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
              aria-pressed={Boolean(project.pinned)}
              onClick={onToggleProjectPin}
            >
              {project.pinned ? <PinOff size={12} /> : <Pin size={12} />}
            </button>
          )}
        </CardRow>
        <CardRow className="sidebar-hover-card-muted">
          <RowIcon><MessageCircle size={13} /></RowIcon>
          <span>{chatCount} {chatCount === 1 ? "chat" : "chats"}</span>
        </CardRow>
        <div className="sidebar-hover-card-divider" />
        <CardRow className="sidebar-hover-card-muted">
          <RowIcon><Folder size={13} /></RowIcon>
          <span title={project.path}>{displayPath(project.path)}</span>
        </CardRow>
        {onEditProject && (
          <>
            <div className="sidebar-hover-card-divider" />
            <button type="button" className="sidebar-hover-card-action" onClick={onEditProject}>
              <RowIcon><Settings size={13} /></RowIcon>
              <span>Edit project</span>
            </button>
          </>
        )}
      </div>
    );
  }

  if (!thread) return null;
  const status = threadStatus(thread);
  const threadProject = project;
  return (
    <div
      className={`sidebar-hover-card thread-hover-card theme-${theme}`}
      role="tooltip"
      aria-label={`${thread.title} chat details`}
      style={{ top, left }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <CardRow className="sidebar-hover-card-title">
        <strong>{thread.title}</strong>
        <time>{relativeTime(thread.updatedAt)}</time>
      </CardRow>
      <CardRow className={`sidebar-hover-card-muted sidebar-hover-card-status ${status.tone}`}>
        <RowIcon>{status.tone === "working" ? <Clock3 size={13} /> : status.tone === "attention" ? <CircleAlert size={13} /> : <CheckCircle2 size={13} />}</RowIcon>
        <span>{status.label}</span>
      </CardRow>
      {threadProject && (
        <CardRow className="sidebar-hover-card-muted">
          <RowIcon><FolderOpen size={13} /></RowIcon>
          <span title={threadProject.name}>{threadProject.name}</span>
        </CardRow>
      )}
      {threadProject && (
        <CardRow className="sidebar-hover-card-muted">
          <RowIcon><Folder size={13} /></RowIcon>
          <span title={threadProject.path}>{displayPath(threadProject.path)}</span>
        </CardRow>
      )}
      <CardRow className="sidebar-hover-card-muted">
        {thread.permission === "full" ? <RowIcon><ShieldAlert size={13} /></RowIcon> : <RowIcon><ModelLogo model={thread.model} /></RowIcon>}
        <span>{thread.model?.trim() || "CLI default"}{thread.effort?.trim() ? ` - ${thread.effort.trim()}` : ""}</span>
      </CardRow>
    </div>
  );
}
