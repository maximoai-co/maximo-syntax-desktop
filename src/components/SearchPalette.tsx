import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileCode2,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MessageSquarePlus,
  Search,
  X,
} from "lucide-react";
import type { AppState, Project, Thread, WorkspaceFileEntry } from "../../desktop/types";
import { collapseDuplicateBrowserScheme } from "../../desktop/browser-url";

interface SearchPaletteProps {
  state: AppState;
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onNewThread: (projectId?: string) => void;
  onOpenProject: () => void;
  onOpenFile?: (projectId: string, path: string) => void;
  onOpenBrowser?: (url: string) => void;
}

type PaletteItem =
  | { kind: "thread"; id: string; thread: Thread; projectName: string; snippet?: string; matchLabel?: string }
  | { kind: "project"; id: string; project: Project }
  | { kind: "file"; id: string; projectId: string; file: WorkspaceFileEntry }
  | { kind: "browser"; id: string; query: string; url: string }
  | { kind: "new"; id: "new" }
  | { kind: "open-project"; id: "open-project" };

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function queryTokens(value: string): string[] {
  return normalize(value).split(" ").filter(Boolean);
}

function includesEveryToken(value: string, tokens: readonly string[]): boolean {
  const normalized = normalize(value);
  return tokens.every((token) => normalized.includes(token));
}

function snippetForThread(thread: Thread, query: string): { snippet?: string; count: number } {
  if (!normalize(query)) return { count: 0 };
  const tokens = queryTokens(query);
  let count = 0;
  let best: string | undefined;
  for (const message of thread.messages) {
    const text = message.content.replace(/\s+/g, " ").trim();
    if (!text || !includesEveryToken(text, tokens)) continue;
    count += 1;
    if (!best) {
      const tokenIndex = tokens.map((token) => text.toLowerCase().indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
      const start = Math.max(0, tokenIndex - 28);
      const value = text.slice(start, start + 112).trim();
      best = `${start > 0 ? "..." : ""}${value}${start + value.length < text.length ? "..." : ""}`;
    }
  }
  return { snippet: best, count };
}

function scoreThread(thread: Thread, projectName: string, query: string): number | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return 0;
  const title = normalize(thread.title);
  const project = normalize(projectName);
  const tokens = queryTokens(query);
  const { count } = snippetForThread(thread, query);
  if (title === normalizedQuery) return 180;
  if (title.startsWith(normalizedQuery)) return 160;
  if (title.includes(normalizedQuery)) return 140;
  if (count > 0) return 120 + Math.min(12, count);
  if (project === normalizedQuery) return 90;
  if (project.includes(normalizedQuery) || includesEveryToken(`${title} ${project}`, tokens)) return 70;
  return null;
}

function scoreProject(project: Project, query: string): number | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;
  const haystack = normalize(`${project.name} ${project.path} ${project.spaceId ?? ""}`);
  const name = normalize(project.name);
  if (name === normalizedQuery) return 170;
  if (name.startsWith(normalizedQuery)) return 150;
  if (name.includes(normalizedQuery)) return 130;
  if (haystack.includes(normalizedQuery)) return 90;
  return null;
}

function normalizeBrowserTarget(value: string): string {
  const trimmed = collapseDuplicateBrowserScheme(value.trim().replace(/^web\s*:\s*/i, ""));
  if (!trimmed) return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

function itemLabel(item: PaletteItem): string {
  if (item.kind === "thread") return item.thread.title || "Untitled chat";
  if (item.kind === "project") return item.project.name;
  if (item.kind === "file") return item.file.path;
  if (item.kind === "browser") return item.url.startsWith("https://www.google.com/search?") ? `Search the web for "${item.query}"` : `Open ${item.url}`;
  if (item.kind === "new") return "New chat";
  return "Open project";
}

function itemDetail(item: PaletteItem): string {
  if (item.kind === "thread") return `${item.projectName}${item.snippet ? ` · ${item.snippet}` : item.matchLabel ? ` · ${item.matchLabel}` : ""}`;
  if (item.kind === "project") return item.project.path;
  if (item.kind === "file") return item.projectId === "" ? item.file.path : item.file.kind === "directory" ? "Folder" : "Workspace file";
  if (item.kind === "browser") return item.url;
  if (item.kind === "new") return "Start a conversation in the current project";
  return "Add a local folder to your workspace";
}

function itemIcon(item: PaletteItem) {
  if (item.kind === "thread" || item.kind === "new") return <MessageSquarePlus size={15} />;
  if (item.kind === "project" || item.kind === "open-project") return <FolderOpen size={15} />;
  if (item.kind === "file") return <FileCode2 size={15} />;
  return <Globe2 size={15} />;
}

export default function SearchPalette({ state, onClose, onSelectThread, onSelectProject, onNewThread, onOpenProject, onOpenFile, onOpenBrowser }: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileResults, setFileResults] = useState<WorkspaceFileEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const projectById = useMemo(() => new Map(state.projects.map((project) => [project.id, project])), [state.projects]);
  const currentProjectId = state.selectedProjectId ?? state.threads.find((thread) => thread.id === state.selectedThreadId)?.projectId;
  const normalizedQuery = normalize(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setActiveIndex(0), [query, fileResults.length]);

  useEffect(() => {
    const projectId = currentProjectId;
    const requestId = ++requestRef.current;
    if (!projectId || !normalizedQuery || !onOpenFile) {
      setFileResults([]);
      setFilesLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setFilesLoading(true);
      void window.maximoDesktop.listWorkspaceFiles(projectId, "", normalizedQuery).then((results) => {
        if (requestRef.current === requestId) setFileResults(results.filter((entry) => entry.kind === "file").slice(0, 8));
      }).catch(() => {
        if (requestRef.current === requestId) setFileResults([]);
      }).finally(() => {
        if (requestRef.current === requestId) setFilesLoading(false);
      });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [currentProjectId, normalizedQuery, onOpenFile]);

  const threads = useMemo(() => {
    const candidates = state.threads.filter((thread) => !thread.archived && thread.messages.length > 0).map((thread, index) => {
      const projectName = projectById.get(thread.projectId)?.name ?? "Project";
      const score = scoreThread(thread, projectName, query);
      const message = snippetForThread(thread, query);
      return { thread, projectName, score, message, index };
    }).filter((candidate) => candidate.score !== null).sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || Number(Boolean(right.thread.pinned)) - Number(Boolean(left.thread.pinned)) || right.thread.updatedAt - left.thread.updatedAt || left.index - right.index).slice(0, 10);
    return candidates.map(({ thread, projectName, message }) => ({
      kind: "thread" as const,
      id: `thread:${thread.id}`,
      thread,
      projectName,
      ...(message.snippet ? { snippet: message.snippet } : {}),
      ...(message.count > 0 ? { matchLabel: `${message.count} message${message.count === 1 ? "" : "s"} match` } : {}),
    }));
  }, [projectById, query, state.threads]);

  const projects = useMemo(() => state.projects.map((project, index) => ({ project, score: scoreProject(project, query), index })).filter((candidate) => candidate.score !== null).sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || right.project.lastOpenedAt - left.project.lastOpenedAt || left.index - right.index).slice(0, 6).map(({ project }) => ({ kind: "project" as const, id: `project:${project.id}`, project })), [query, state.projects]);

  const items = useMemo<PaletteItem[]>(() => {
    const next: PaletteItem[] = [...threads, ...projects];
    for (const file of fileResults) {
      if (currentProjectId) next.push({ kind: "file", id: `file:${currentProjectId}:${file.path}`, projectId: currentProjectId, file });
    }
    if (normalizedQuery && onOpenBrowser) next.push({ kind: "browser", id: `browser:${normalizedQuery}`, query: query.trim(), url: normalizeBrowserTarget(query) });
    if (!normalizedQuery || /new|chat|conversation/i.test(normalizedQuery)) next.push({ kind: "new", id: "new" });
    if (!normalizedQuery || /open|project|folder/i.test(normalizedQuery)) next.push({ kind: "open-project", id: "open-project" });
    return next;
  }, [currentProjectId, fileResults, normalizedQuery, onOpenBrowser, projects, query, threads]);

  const choose = (item: PaletteItem) => {
    if (item.kind === "thread") onSelectThread(item.thread.id);
    else if (item.kind === "project") onSelectProject?.(item.project.id);
    else if (item.kind === "file") onOpenFile?.(item.projectId, item.file.path);
    else if (item.kind === "browser") onOpenBrowser?.(item.url);
    else if (item.kind === "new") onNewThread(state.selectedProjectId);
    else onOpenProject();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => items.length ? (value + 1) % items.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => items.length ? (value - 1 + items.length) % items.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[activeIndex];
      if (item) choose(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const hasMatches = items.length > 0;
  const threadItems = items.filter((item): item is Extract<PaletteItem, { kind: "thread" }> => item.kind === "thread");
  const projectItems = items.filter((item): item is Extract<PaletteItem, { kind: "project" }> => item.kind === "project");
  const fileItems = items.filter((item): item is Extract<PaletteItem, { kind: "file" }> => item.kind === "file");
  const browserItems = items.filter((item): item is Extract<PaletteItem, { kind: "browser" }> => item.kind === "browser");
  const suggestedItems = items.filter((item) => item.kind === "new" || item.kind === "open-project");

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="command-palette glass-panel" role="dialog" aria-modal="true" aria-label="Search workspace">
        <label className="palette-input"><Search size={16} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Search chats, projects, files, or the web" aria-label="Search workspace" /><kbd>Esc</kbd></label>
        <div className="palette-body">
          {threadItems.length > 0 && <><span className="palette-section-label">{normalizedQuery ? "Chats" : "Recent chats"}</span>{threadItems.map((item) => <PaletteRow key={item.id} item={item} index={items.indexOf(item)} activeIndex={activeIndex} onChoose={choose} onHover={setActiveIndex} />)}</>}
          {projectItems.length > 0 && <><span className="palette-section-label">Projects</span>{projectItems.map((item) => <PaletteRow key={item.id} item={item} index={items.indexOf(item)} activeIndex={activeIndex} onChoose={choose} onHover={setActiveIndex} />)}</>}
          {(fileItems.length > 0 || filesLoading) && <><span className="palette-section-label">Workspace files</span>{filesLoading && <div className="palette-loading"><LoaderCircle size={14} className="spin" />Searching files...</div>}{fileItems.map((item) => <PaletteRow key={item.id} item={item} index={items.indexOf(item)} activeIndex={activeIndex} onChoose={choose} onHover={setActiveIndex} />)}</>}
          {browserItems.length > 0 && <><span className="palette-section-label">Browser</span>{browserItems.map((item) => <PaletteRow key={item.id} item={item} index={items.indexOf(item)} activeIndex={activeIndex} onChoose={choose} onHover={setActiveIndex} />)}</>}
          {suggestedItems.length > 0 && <><span className="palette-section-label">Suggested</span>{suggestedItems.map((item) => <PaletteRow key={item.id} item={item} index={items.indexOf(item)} activeIndex={activeIndex} onChoose={choose} onHover={setActiveIndex} />)}</>}
          {!hasMatches && !filesLoading && <div className="palette-empty">{normalizedQuery ? "No matching chats, projects, files, or browser actions." : "No sent chats yet."}</div>}
        </div>
        <footer className="palette-footer"><span><ArrowUp size={12} /><ArrowDown size={12} /> Navigate</span><span>Enter Open</span><button type="button" onClick={onClose} aria-label="Close search"><X size={13} /></button></footer>
      </section>
    </div>
  );
}

function PaletteRow({ item, index, activeIndex, onChoose, onHover }: { item: PaletteItem; index: number; activeIndex: number; onChoose: (item: PaletteItem) => void; onHover: (index: number) => void }) {
  return <button type="button" className={`palette-row ${activeIndex === index ? "active" : ""}`} onMouseEnter={() => onHover(index)} onClick={() => onChoose(item)}>
    {itemIcon(item)}
    <span><strong>{itemLabel(item)}</strong><small>{itemDetail(item)}</small></span>
    <kbd>{index < 9 ? `⌘${index + 1}` : ""}</kbd>
  </button>;
}
