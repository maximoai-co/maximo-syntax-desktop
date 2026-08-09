import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Diff,
  Ellipsis,
  ExternalLink,
  File,
  FileCode2,
  FilePenLine,
  FileText,
  Folder,
  FolderOpen,
  Folders,
  Globe2,
  GitBranch,
  GitCommitHorizontal,
  HardDrive,
  Maximize2,
  MessageCircle,
  Minus,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type {
  AppState,
  BrowserState,
  GitDiff,
  GitFile,
  GitStatus,
  LocalServer,
  Project,
  RunActivity,
  Settings,
  TerminalEvent,
  TerminalSession,
  Thread,
  WorkspaceFileContent,
  WorkspaceFileEntry,
} from "../../desktop/types";
import { collapseDuplicateBrowserScheme } from "../../desktop/browser-url";
import { DiffCode, diffLanguageForPath, patchStats } from "./DiffReview";
import MarkdownContent from "./MarkdownContent";
import { highlightCode } from "./MarkdownCodeBlock";
import { useLiveRun } from "../liveRunStore";

export type WorkspacePaneKind = "diff" | "terminal" | "browser" | "explorer" | "file" | "sidechat" | "git";

export interface WorkspaceDockRequest {
  id: number;
  kind: WorkspacePaneKind;
  filePath?: string;
  url?: string;
}

export interface WorkspaceSideChat {
  thread?: Thread;
  running: boolean;
  onCreate: () => void;
  onSend: (prompt: string) => void;
}

interface DockPane {
  id: string;
  kind: WorkspacePaneKind;
  filePath?: string;
  url?: string;
}

interface DockState {
  panes: DockPane[];
  activePaneId: string | null;
}

interface WorkspaceDockProps {
  open: boolean;
  /**
   * Keep the dock layout visible but detach native surfaces (WebContentsView
   * browser) so HTML overlays like Account can dim the full window cleanly.
   * Unlike `open={false}`, this does not collapse the inspector column.
   */
  suspendNativeSurfaces?: boolean;
  project?: Project;
  thread?: Thread;
  state?: AppState;
  git: GitStatus | null;
  reviewFile?: string | null;
  reviewDiff: GitDiff | null;
  activity?: RunActivity[];
  request?: WorkspaceDockRequest | null;
  sideChat?: WorkspaceSideChat;
  onRequestHandled?: () => void;
  onOpenChange: (open: boolean) => void;
  onOpenDiff: (path: string, diff?: GitDiff) => void;
  onCloseReview: () => void;
  onRefreshGit: () => void;
  onGitChanged: (status: GitStatus) => void;
  onOpenEditor: (path: string) => void;
  onReveal: (path: string) => void;
  onResize: (event: React.PointerEvent<HTMLDivElement>) => void;
}

function projectFilePath(project: Project, relativePath: string): string {
  return `${project.path.replace(/[\\/]+$/, "")}/${relativePath.replace(/^[/\\]+/, "")}`;
}

function dockStorageKey(project?: Project, thread?: Thread): string {
  return `maximo-syntax:right-dock:v1:${project?.id ?? "none"}:${thread?.id ?? "none"}`;
}

function readDockState(key: string): DockState {
  const fallback: DockState = { panes: [], activePaneId: null };
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<DockState> | null;
    if (!value || !Array.isArray(value.panes)) return fallback;
    const panes = value.panes.flatMap((pane) => {
      if (!pane || typeof pane !== "object" || typeof pane.id !== "string") return [];
      if (!["diff", "terminal", "browser", "explorer", "file", "sidechat", "git"].includes(pane.kind as string)) return [];
      return [{ id: pane.id, kind: pane.kind as WorkspacePaneKind, ...(typeof pane.filePath === "string" ? { filePath: pane.filePath } : {}), ...(typeof pane.url === "string" ? { url: pane.url } : {}) }];
    });
    const activePaneId = typeof value.activePaneId === "string" && panes.some((pane) => pane.id === value.activePaneId)
      ? value.activePaneId
      : panes[0]?.id ?? null;
    return { panes, activePaneId };
  } catch {
    return fallback;
  }
}

function writeDockState(key: string, state: DockState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Workspace chrome persistence is best effort and must never block the chat.
  }
}

function paneLabel(pane: DockPane): string {
  if (pane.kind === "diff") return "Diff";
  if (pane.kind === "terminal") return "Terminal";
  if (pane.kind === "browser") return "Browser";
  if (pane.kind === "explorer") return "Explorer";
  if (pane.kind === "git") return "Git";
  if (pane.kind === "sidechat") return "Side";
  return pane.filePath?.split(/[\\/]/).filter(Boolean).at(-1) ?? "File";
}

function readTerminalTheme(element: HTMLElement): { background: string; foreground: string; cursor: string; selectionBackground: string } {
  const styles = getComputedStyle(element);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const accent = read("--accent-strong", "#78d6c1");
  return {
    background: read("--terminal-background", "#0b0d0e"),
    foreground: read("--terminal-foreground", "#d6dcdb"),
    cursor: accent,
    selectionBackground: read("--accent-soft", "rgba(120,214,193,.28)"),
  };
}

function PaneIcon({ kind, size = 14 }: { kind: WorkspacePaneKind; size?: number }) {
  if (kind === "diff") return <Diff size={size} />;
  if (kind === "terminal") return <TerminalSquare size={size} />;
  if (kind === "browser") return <Globe2 size={size} />;
  if (kind === "explorer") return <Folders size={size} />;
  if (kind === "git") return <GitCommitHorizontal size={size} />;
  if (kind === "sidechat") return <MessageCircle size={size} />;
  return <FileCode2 size={size} />;
}

function fileLanguage(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  const names: Record<string, string> = {
    ts: "TypeScript",
    tsx: "TSX",
    js: "JavaScript",
    jsx: "JSX",
    json: "JSON",
    md: "Markdown",
    css: "CSS",
    html: "HTML",
    py: "Python",
    rs: "Rust",
    sh: "Shell",
    yml: "YAML",
    yaml: "YAML",
  };
  return names[extension] ?? (extension ? extension.toUpperCase() : "Text");
}

const WorkspaceFileViewer = memo(function WorkspaceFileViewer({
  project,
  filePath,
  onOpenEditor,
  compact = false,
  active = true,
}: {
  project: Project;
  filePath: string | null;
  onOpenEditor: (path: string) => void;
  compact?: boolean;
  active?: boolean;
}) {
  const [file, setFile] = useState<WorkspaceFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [markdownPreview, setMarkdownPreview] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!active) return () => { cancelled = true; };
    if (!filePath) {
      setFile(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setEditing(false);
    void window.maximoDesktop.readWorkspaceFile(project.id, filePath).then((next) => {
      if (cancelled) return;
      setFile(next);
      setDraft(next.content ?? "");
      setMarkdownPreview(next.mimeType === "text/markdown");
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to read this file.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [active, filePath, project.id]);

  const content = file?.content ?? "";
  const isMarkdown = file?.mimeType === "text/markdown";
  const sourceLanguage = diffLanguageForPath(filePath ?? undefined);
  const sourceLines = useMemo(() => content.split("\n").map((line, index) => {
    const highlighted = sourceLanguage ? highlightCode(line || " ", sourceLanguage) : null;
    return <div className="workspace-source-line" key={`${index}-${line.slice(0, 20)}`}><span>{index + 1}</span>{highlighted ? <code className={`hljs${highlighted.language ? ` language-${highlighted.language}` : ""}`} dangerouslySetInnerHTML={{ __html: highlighted.html }} /> : <code>{line || " "}</code>}</div>;
  }), [content, sourceLanguage]);

  const save = async () => {
    if (!file || file.kind !== "text") return;
    setSaving(true);
    setError(null);
    try {
      const next = await window.maximoDesktop.writeWorkspaceFile(project.id, file.path, draft, file.modifiedAt);
      setFile(next);
      setDraft(next.content ?? draft);
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save this file.");
    } finally {
      setSaving(false);
    }
  };

  if (!active) return <div className="workspace-empty-state compact"><FileCode2 size={17} /><span>Panel paused</span><small>Activate this pane to resume its preview.</small></div>;
  if (!filePath) return <div className="workspace-empty-state"><FileText size={21} /><span>Select a file to view it.</span><small>Use Explorer or open a changed file from Diff.</small></div>;
  if (loading) return <div className="workspace-empty-state"><RefreshCw size={18} className="spin" /><span>Reading {filePath}</span></div>;
  if (error && !file) return <div className="workspace-empty-state error"><AlertCircle size={18} /><span>{error}</span></div>;

  return (
    <div className={`workspace-file-viewer ${compact ? "compact" : ""}`}>
      <header className="workspace-file-header">
        <div className="workspace-file-title"><FileCode2 size={14} /><strong title={filePath}>{filePath.split(/[\\/]/).at(-1)}</strong><small>{fileLanguage(filePath)}</small></div>
        <div className="workspace-file-actions">
          {isMarkdown && <div className="workspace-segmented"><button type="button" className={markdownPreview ? "active" : ""} onClick={() => setMarkdownPreview(true)}>Preview</button><button type="button" className={!markdownPreview ? "active" : ""} onClick={() => setMarkdownPreview(false)}>Source</button></div>}
          {file?.kind === "text" && <button type="button" className={editing ? "active" : ""} onClick={() => setEditing((value) => !value)} title={editing ? "Stop editing" : "Edit file"}><FilePenLine size={13} /></button>}
          {editing && <button type="button" className="workspace-file-save" onClick={() => void save()} disabled={saving} title="Save file">{saving ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}</button>}
          <button type="button" onClick={() => onOpenEditor(projectFilePath(project, filePath))} title="Open in external editor"><ExternalLink size={13} /></button>
        </div>
      </header>
      {error && <div className="workspace-file-error"><AlertCircle size={13} />{error}</div>}
      {file?.reason ? <div className="workspace-empty-state error"><AlertCircle size={18} /><span>{file.reason}</span></div>
        : file?.kind === "image" && file.dataUrl ? <div className="workspace-file-media"><img src={file.dataUrl} alt={file.name} /></div>
        : file?.kind === "pdf" && file.dataUrl ? <iframe className="workspace-file-pdf" title={file.name} src={file.dataUrl} />
          : editing ? <textarea className="workspace-file-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />
            : markdownPreview && isMarkdown ? <div className="workspace-markdown-scroll"><MarkdownContent>{content}</MarkdownContent></div>
                : <div className="workspace-source-scroll"><div className="workspace-source-code">{sourceLines}</div></div>}
    </div>
  );
});

const WorkspaceExplorerPane = memo(function WorkspaceExplorerPane({ project, onOpenFile, onOpenEditor, active = true }: { project: Project; onOpenFile: (path: string) => void; onOpenEditor: (path: string) => void; active?: boolean }) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<WorkspaceFileEntry[]>([]);
  const searchRequestRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    setQuery("");
    setEntries({});
    setExpanded(new Set());
    setSelectedPath(null);
    setSearchResults([]);
    setError(null);
    setLoadingPath("");
    void window.maximoDesktop.listWorkspaceFiles(project.id, "").then((next) => setEntries({ "": next })).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to list this project.")).finally(() => setLoadingPath(null));
  }, [active, project.id]);

  useEffect(() => {
    if (!active) return;
    const requestId = ++searchRequestRef.current;
    const timer = window.setTimeout(() => {
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }
      setLoadingPath("search");
      void window.maximoDesktop.listWorkspaceFiles(project.id, "", query).then((results) => {
        if (searchRequestRef.current === requestId) setSearchResults(results);
      }).catch((reason) => {
        if (searchRequestRef.current === requestId) setError(reason instanceof Error ? reason.message : "Unable to search this project.");
      }).finally(() => {
        if (searchRequestRef.current === requestId) setLoadingPath(null);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [active, project.id, query]);

  const toggleDirectory = async (entry: WorkspaceFileEntry) => {
    const path = entry.path;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    if (!entries[path]) {
      setLoadingPath(path);
      try {
        const next = await window.maximoDesktop.listWorkspaceFiles(project.id, path);
        setEntries((current) => ({ ...current, [path]: next }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to open this folder.");
      } finally {
        setLoadingPath(null);
      }
    }
  };

  const visibleEntries = query.trim() ? searchResults : entries[""] ?? [];
  const renderEntry = (entry: WorkspaceFileEntry, depth = 0) => {
    const isDirectory = entry.kind === "directory";
    const isExpanded = expanded.has(entry.path);
    const nested = isDirectory && isExpanded && !query.trim() ? entries[entry.path] ?? [] : [];
    return (
      <div key={entry.path}>
        <button
          type="button"
          className={`workspace-tree-row ${selectedPath === entry.path ? "selected" : ""}`}
          style={{ "--tree-depth": depth } as CSSProperties}
          title={entry.path}
          onClick={() => {
            if (isDirectory) void toggleDirectory(entry);
            else setSelectedPath(entry.path);
          }}
          onDoubleClick={() => { if (!isDirectory) onOpenFile(entry.path); }}
        >
          {isDirectory ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="workspace-tree-spacer" />}
          {isDirectory ? (isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />) : <File size={14} />}
          <span>{query.trim() ? entry.path : entry.name}</span>
          {loadingPath === entry.path && <RefreshCw size={11} className="spin" />}
        </button>
        {nested.map((child) => renderEntry(child, depth + 1))}
      </div>
    );
  };

  if (!active) return <div className="workspace-empty-state compact"><Folders size={17} /><span>Panel paused</span><small>Activate this pane to resume the file explorer.</small></div>;

  return (
    <div className="workspace-explorer-pane">
      <div className="workspace-explorer-tree">
        <div className="workspace-explorer-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search files…" aria-label="Search files" /><kbd>⌘P</kbd></div>
        {error && <div className="workspace-inline-error"><AlertCircle size={13} />{error}</div>}
        {loadingPath === "" && !visibleEntries.length ? <div className="workspace-tree-state"><RefreshCw size={14} className="spin" />Loading files…</div>
          : !visibleEntries.length ? <div className="workspace-tree-state">{query ? "No matching files." : "No files found."}</div>
            : visibleEntries.map((entry) => renderEntry(entry))}
      </div>
      <div className="workspace-explorer-preview">
        {selectedPath ? <WorkspaceFileViewer project={project} filePath={selectedPath} onOpenEditor={onOpenEditor} /> : <div className="workspace-empty-state"><FileText size={21} /><span>Select a file to view it.</span><small>Double-click a file to open a file tab.</small></div>}
      </div>
    </div>
  );
});

function ChangedFileRow({ file, onOpenDiff, onStage, onUnstage }: { file: GitFile; onOpenDiff: () => void; onStage?: () => void; onUnstage?: () => void }) {
  return (
    <div className="workspace-git-file-row">
      <button type="button" className="workspace-git-file-main" onClick={onOpenDiff} title={file.path}><span className={`workspace-git-status status-${file.status[0]}`}>{file.status}</span><span>{file.path}</span><small><b>+{file.additions}</b> <i>-{file.deletions}</i></small></button>
      {file.staged && onUnstage ? <button type="button" className="workspace-git-file-action" onClick={onUnstage} title="Unstage file"><Minus size={12} /></button> : onStage ? <button type="button" className="workspace-git-file-action" onClick={onStage} title="Stage file"><Plus size={12} /></button> : null}
    </div>
  );
}

const WorkspaceGitPane = memo(function WorkspaceGitPane({ project, git, onOpenDiff, onRefresh, onGitChanged, active = true }: { project: Project; git: GitStatus | null; onOpenDiff: (path: string) => void; onRefresh: () => void; onGitChanged: (status: GitStatus) => void; active?: boolean }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDiff, setSelectedDiff] = useState<GitDiff | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const staged = git?.files.filter((file) => file.staged) ?? [];
  const changes = git?.files.filter((file) => !file.staged) ?? [];

  useEffect(() => {
    let cancelled = false;
    if (!active) return () => { cancelled = true; };
    if (!selectedPath) {
      setSelectedDiff(null);
      return;
    }
    void window.maximoDesktop.gitDiff(project.id, selectedPath).then((next) => { if (!cancelled) setSelectedDiff(next); }).catch(() => { if (!cancelled) setSelectedDiff(null); });
    return () => { cancelled = true; };
  }, [active, project.id, selectedPath]);

  const mutate = async (action: "stage" | "unstage", paths: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const next = action === "stage" ? await window.maximoDesktop.gitStage(project.id, paths) : await window.maximoDesktop.gitUnstage(project.id, paths);
      onGitChanged(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Git action failed.");
    } finally {
      setBusy(false);
    }
  };

  const commitPush = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await window.maximoDesktop.gitCommitPush(project.id, message.trim());
      onGitChanged(next);
      setMessage("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Commit and push failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!active) return <div className="workspace-empty-state compact"><GitCommitHorizontal size={17} /><span>Panel paused</span><small>Activate this pane to resume source control.</small></div>;
  if (!git) return <div className="workspace-empty-state"><RefreshCw size={18} className="spin" /><span>Reading source control…</span></div>;
  if (!git.isRepository) return <div className="workspace-empty-state"><GitBranch size={20} /><span>Not a Git repository</span><small>Initialize Git in the project to see source control here.</small></div>;
  return (
    <div className="workspace-git-pane">
      <header className="workspace-pane-titlebar"><div><GitCommitHorizontal size={15} /><strong>Source control</strong><span>{git.branch || "detached"}</span></div><button type="button" onClick={onRefresh} title="Refresh changes"><RefreshCw size={13} /></button></header>
      {error && <div className="workspace-inline-error"><AlertCircle size={13} />{error}</div>}
      <div className="workspace-git-list">
        <section className="workspace-git-section"><div className="workspace-git-section-heading"><span>Staged</span><b>{staged.length}</b>{staged.length > 0 && <button type="button" disabled={busy} onClick={() => void mutate("unstage", staged.map((file) => file.path))}>Unstage all</button>}</div>{staged.length ? staged.map((file) => <ChangedFileRow key={`staged-${file.path}`} file={file} onOpenDiff={() => { setSelectedPath(file.path); onOpenDiff(file.path); }} onUnstage={() => void mutate("unstage", [file.path])} />) : <p className="workspace-git-empty">No staged changes.</p>}</section>
        <section className="workspace-git-section"><div className="workspace-git-section-heading"><span>Changes</span><b>{changes.length}</b>{changes.length > 0 && <button type="button" disabled={busy} onClick={() => void mutate("stage", changes.map((file) => file.path))}>Stage all</button>}</div>{changes.length ? changes.map((file) => <ChangedFileRow key={`change-${file.path}`} file={file} onOpenDiff={() => { setSelectedPath(file.path); onOpenDiff(file.path); }} onStage={() => void mutate("stage", [file.path])} />) : <p className="workspace-git-empty">No unstaged changes.</p>}</section>
      </div>
      <div className="workspace-git-commit"><div className="workspace-git-commit-title"><Upload size={13} /><span>Commit and Push</span></div><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" onKeyDown={(event) => { if (event.key === "Enter") void commitPush(); }} /><button type="button" className="primary-button compact" disabled={busy || !git.files.length || !message.trim()} onClick={() => void commitPush()}>{busy ? <RefreshCw size={13} className="spin" /> : <Upload size={13} />}Commit and push</button></div>
     <div className="workspace-git-diff">{selectedDiff ? <div className="workspace-selected-diff"><div className="workspace-selected-diff-header"><span>{selectedDiff.path}</span><span><b>+{patchStats(selectedDiff.patch).additions}</b> <i>-{patchStats(selectedDiff.patch).deletions}</i></span></div><DiffCode patch={selectedDiff.patch} language={diffLanguageForPath(selectedDiff.path)} showMetadata={false} /></div> : <div className="workspace-empty-state compact"><FileCode2 size={17} /><span>Select a file to view its diff.</span></div>}</div>
    </div>
  );
});

interface ManagedTerminalView {
  session: TerminalSession;
}

function TerminalViewport({ session, active, terminalFontSizePx = 12, terminalFontFamily = "", onInput, onResize, onReady }: {
  session: TerminalSession;
  active: boolean;
  terminalFontSizePx?: number;
  terminalFontFamily?: string;
  onInput: (value: string) => void;
  onResize: (columns: number, rows: number) => void;
  onReady: (terminal: Terminal | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputRef = useRef(onInput);
  const resizeRef = useRef(onResize);
  inputRef.current = onInput;
  resizeRef.current = onResize;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "bar",
      cursorWidth: 1,
      convertEol: true,
      scrollback: 5_000,
       fontFamily: terminalFontFamily.trim() ? `"${terminalFontFamily.replace(/["';{}<>]/g, "").trim()}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` : "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
       fontSize: terminalFontSizePx,
      lineHeight: 1.35,
       theme: readTerminalTheme(mount),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(mount);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    const dataDisposable = terminal.onData((value) => inputRef.current(value));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      fit.fit();
      resizeRef.current(terminal.cols, terminal.rows);
    });
    const themeObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      terminal.options.theme = readTerminalTheme(mount);
    });
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme-variant"] });
    observer?.observe(mount);
    onReady(terminal);
    resizeRef.current(terminal.cols, terminal.rows);
    if (active) terminal.focus();
    return () => {
      observer?.disconnect();
      themeObserver?.disconnect();
      dataDisposable.dispose();
      onReady(null);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
    // The terminal is one runtime per session; activity changes only focus it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  useEffect(() => {
    if (!active || !terminalRef.current || !fitRef.current) return;
    fitRef.current.fit();
    terminalRef.current.focus();
    resizeRef.current(terminalRef.current.cols, terminalRef.current.rows);
  }, [active]);

  useEffect(() => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    terminal.options.fontSize = terminalFontSizePx;
    terminal.options.fontFamily = terminalFontFamily.trim()
      ? `"${terminalFontFamily.replace(/["';{}<>]/g, "").trim()}", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
      : "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    fit.fit();
    resizeRef.current(terminal.cols, terminal.rows);
  }, [terminalFontFamily, terminalFontSizePx]);

  return <div ref={mountRef} className={`workspace-terminal-viewport ${active ? "active" : "inactive"}`} onMouseDown={() => terminalRef.current?.focus()} aria-hidden={!active} />;
}

const WorkspaceTerminalPane = memo(function WorkspaceTerminalPane({ project, paneActive = true, settings }: { project: Project; paneActive?: boolean; settings?: Pick<Settings, "terminalFontSizePx" | "terminalFontFamily" | "confirmTerminalTabClose"> }) {
  const [sessions, setSessions] = useState<ManagedTerminalView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const sessionsRef = useRef<ManagedTerminalView[]>([]);
  const outputBySessionRef = useRef<Record<string, string>>({});
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());
  const active = sessions.find((item) => item.session.sessionId === activeId);

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.maximoDesktop.onTerminalEvent((event: TerminalEvent) => {
      if (event.type === "started") return;
      if (event.type === "output") {
        outputBySessionRef.current[event.sessionId] = `${outputBySessionRef.current[event.sessionId] ?? ""}${event.text}`.slice(-60_000);
        terminalsRef.current.get(event.sessionId)?.write(event.text);
        return;
      }
      const message = event.type === "exit" ? `\r\n[process exited (${event.code ?? "unknown"})]\r\n` : `\r\n[terminal error: ${event.message}]\r\n`;
      outputBySessionRef.current[event.sessionId] = `${outputBySessionRef.current[event.sessionId] ?? ""}${message}`.slice(-60_000);
      terminalsRef.current.get(event.sessionId)?.write(message);
    });
    const start = async () => {
      try {
        const session = await window.maximoDesktop.terminalStart(project.id);
        if (disposed) {
          await window.maximoDesktop.terminalStop(session.sessionId);
          return;
        }
        outputBySessionRef.current[session.sessionId] = "";
        setSessions([{ session }]);
        setActiveId(session.sessionId);
      } catch (reason) {
        if (!disposed) {
          const session = { sessionId: "error", cwd: project.path, shell: "" };
          outputBySessionRef.current.error = reason instanceof Error ? reason.message : "Unable to start terminal.";
          setSessions([{ session }]);
          setActiveId(session.sessionId);
        }
      }
    };
    void start();
    return () => {
      disposed = true;
      unsubscribe();
      for (const item of sessionsRef.current) void window.maximoDesktop.terminalStop(item.session.sessionId);
    };
    // A terminal pane is kept mounted while another dock tab is selected. It should
    // only be recreated when the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const newTerminal = async () => {
    try {
      const session = await window.maximoDesktop.terminalStart(project.id);
      outputBySessionRef.current[session.sessionId] = "";
      setSessions((current) => [...current, { session }]);
      setActiveId(session.sessionId);
    } catch {
      // The active terminal displays the manager's error event when available.
    }
  };

  const send = async () => {
    if (!active || active.session.sessionId === "error" || !input) return;
    await window.maximoDesktop.terminalInput(active.session.sessionId, `${input}\n`);
    setInput("");
  };

  const closeSession = async (sessionId: string) => {
    const target = sessions.find((item) => item.session.sessionId === sessionId);
    if (!target || target.session.sessionId === "error") return;
    if (settings?.confirmTerminalTabClose !== false && !window.confirm("Close this terminal tab? Its session output will be cleared.")) return;
    await window.maximoDesktop.terminalStop(target.session.sessionId);
    terminalsRef.current.delete(target.session.sessionId);
    delete outputBySessionRef.current[target.session.sessionId];
    const remaining = sessions.filter((item) => item.session.sessionId !== target.session.sessionId);
    setSessions(remaining);
    setActiveId((current) => current === target.session.sessionId ? remaining.at(-1)?.session.sessionId ?? null : current);
  };

  const closeActive = async () => {
    if (active) await closeSession(active.session.sessionId);
  };

  if (!paneActive) return <div className="workspace-empty-state compact"><TerminalSquare size={17} /><span>Panel paused</span><small>Activate this pane to resume the terminal.</small></div>;

  return <div className="workspace-terminal-pane">
    <header className="workspace-pane-titlebar"><div><TerminalSquare size={15} /><strong>Terminal</strong><span>{active?.session.cwd ?? project.path}</span></div><div className="workspace-pane-title-actions"><button type="button" onClick={() => void newTerminal()} title="New terminal"><Plus size={13} /></button><button type="button" onClick={() => void closeActive()} title="Close terminal" disabled={!active}><X size={13} /></button></div></header>
    <div className="workspace-terminal-tabs">{sessions.map((item, index) => <div className={`workspace-terminal-tab ${item.session.sessionId === activeId ? "active" : ""}`} key={item.session.sessionId}><button type="button" className="workspace-terminal-tab-select" onClick={() => setActiveId(item.session.sessionId)}><TerminalSquare size={11} />{item.session.sessionId === "error" ? "Terminal" : `Shell ${index + 1}`}</button>{sessions.length > 1 && item.session.sessionId !== "error" && <button type="button" className="workspace-terminal-tab-close" onClick={() => void closeSession(item.session.sessionId)} title={`Close Shell ${index + 1}`} aria-label={`Close Shell ${index + 1}`}><X size={10} /></button>}</div>)}</div>
     <div className="workspace-terminal-surface">{sessions.map((item) => <TerminalViewport key={item.session.sessionId} session={item.session} active={item.session.sessionId === activeId} terminalFontSizePx={settings?.terminalFontSizePx} terminalFontFamily={settings?.terminalFontFamily} onInput={(value) => { if (item.session.sessionId !== "error") void window.maximoDesktop.terminalInput(item.session.sessionId, value); }} onResize={(columns, rows) => { if (item.session.sessionId !== "error") void window.maximoDesktop.terminalResize(item.session.sessionId, columns, rows); }} onReady={(terminal) => { if (terminal) { terminalsRef.current.set(item.session.sessionId, terminal); const buffered = outputBySessionRef.current[item.session.sessionId]; if (buffered) terminal.write(buffered); } else terminalsRef.current.delete(item.session.sessionId); }} />)}</div>
    <div className="workspace-terminal-input"><span className="workspace-terminal-prompt">›</span><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} placeholder="Run a command…" spellCheck={false} autoCapitalize="off" autoCorrect="off" /><button type="button" onClick={() => void send()} disabled={!input || !active || active.session.sessionId === "error"} title="Send command"><Send size={14} /></button></div>
  </div>;
});

function normalizeBrowserUrl(value: string): string {
  const trimmed = collapseDuplicateBrowserScheme(value);
  if (!trimmed) return "about:blank";
  const candidate = /^(?:https?:\/\/|about:blank$)/i.test(trimmed)
    ? trimmed
    : trimmed.includes(" ")
      ? `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
      : /\./.test(trimmed)
        ? `https://${trimmed}`
        : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "about:" ? "about:blank" : parsed.toString();
  } catch {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }
}

const WorkspaceBrowserPane = memo(function WorkspaceBrowserPane({
  initialUrl,
  threadId,
  paneActive = true,
  suspendNative = false,
}: {
  initialUrl?: string;
  threadId?: string;
  paneActive?: boolean;
  /**
   * Modal overlays cannot cover WebContentsView. Two-phase freeze:
   * keep the live page attached until a screenshot is ready, then swap to the
   * image and detach so the modal backdrop can blur real page content.
   */
  suspendNative?: boolean;
}) {
  const [browser, setBrowser] = useState<BrowserState | null>(null);
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [freezeFrameUrl, setFreezeFrameUrl] = useState<string | null>(null);
  // false while capture is in flight — keeps the native view up until we have pixels.
  const [freezeReady, setFreezeReady] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastRequestedUrlRef = useRef<string | undefined>(undefined);
  const active = browser?.tabs.find((tab) => tab.id === browser.activeTabId) ?? browser?.tabs[0] ?? null;
  const activeTabId = active?.id;
  const activeUrl = active?.url;
  // Stay live until freeze-frame is ready (or when not suspending at all).
  const nativeLive = Boolean(paneActive && threadId && (!suspendNative || !freezeReady));
  const showFreezeFrame = Boolean(suspendNative && freezeReady && freezeFrameUrl);
  const mergeBrowser = (next: BrowserState) => setBrowser((current) => current && current.version > next.version ? current : next);

  useEffect(() => {
    if (!threadId) {
      setBrowser(null);
      return;
    }
    let cancelled = false;
    const unsubscribe = window.maximoDesktop.browser.onState((state) => {
      if (!cancelled && state.threadId === threadId) mergeBrowser(state);
    });
    const requestedUrl = initialUrl && initialUrl !== lastRequestedUrlRef.current ? normalizeBrowserUrl(initialUrl) : undefined;
    if (initialUrl) lastRequestedUrlRef.current = initialUrl;
    void window.maximoDesktop.browser.open({ threadId, ...(requestedUrl ? { initialUrl: requestedUrl } : {}) }).then((state) => {
      if (!cancelled) mergeBrowser(state);
    }).catch(() => {
      if (!cancelled) setBrowser(null);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      void window.maximoDesktop.browser.setPanelBounds({ threadId, bounds: null });
    };
  }, [initialUrl, threadId]);

  useEffect(() => {
    if (!threadId || !nativeLive) return;
    return window.maximoDesktop.browser.onCopyLink((event) => {
      if (event.threadId === threadId) {
        setNotice("Link copied");
        window.setTimeout(() => setNotice(null), 1_400);
      }
    });
  }, [nativeLive, threadId]);

  useEffect(() => {
    setAddress(activeUrl === "about:blank" ? "" : activeUrl ?? "");
  }, [activeTabId, activeUrl]);

  // Phase 1: when a modal asks to suspend, capture first while native is still live.
  useEffect(() => {
    if (!suspendNative) {
      setFreezeReady(false);
      setFreezeFrameUrl(null);
      return;
    }
    if (!paneActive || !threadId) {
      setFreezeReady(true);
      return;
    }
    if (!activeTabId || !activeUrl || activeUrl === "about:blank") {
      setFreezeFrameUrl(null);
      setFreezeReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const shot = await window.maximoDesktop.browser.captureScreenshot({ threadId, tabId: activeTabId });
        if (cancelled) return;
        if (typeof shot.dataUrl === "string" && shot.dataUrl.startsWith("data:image/")) {
          setFreezeFrameUrl(shot.dataUrl);
        } else {
          setFreezeFrameUrl(null);
        }
      } catch {
        if (!cancelled) setFreezeFrameUrl(null);
      } finally {
        if (!cancelled) setFreezeReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [suspendNative, paneActive, threadId, activeTabId, activeUrl]);

  // Phase 2: pin native bounds while live; hide only after freeze is ready.
  useLayoutEffect(() => {
    if (!threadId) return;

    if (!nativeLive) {
      void window.maximoDesktop.browser.hide({ threadId });
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = () => {
      const rect = viewport.getBoundingClientRect();
      void window.maximoDesktop.browser.setPanelBounds({
        threadId,
        bounds: rect.width > 0 && rect.height > 0
          ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
          : null,
      });
    };
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    observer?.observe(viewport);
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      // If we are only mid-freeze (still suspending, not ready), keep attached for capture.
      if (!(suspendNative && !freezeReady && paneActive)) {
        void window.maximoDesktop.browser.setPanelBounds({ threadId, bounds: null });
      }
    };
  }, [freezeReady, nativeLive, paneActive, suspendNative, threadId]);

  const navigate = async () => {
    if (!threadId || !active || suspendNative) return;
    const next = normalizeBrowserUrl(address);
    setAddress(next === "about:blank" ? "" : next);
    const state = await window.maximoDesktop.browser.navigate({ threadId, tabId: active.id, url: next });
    mergeBrowser(state);
  };

  const newTab = () => {
    if (!threadId || suspendNative) return;
    void window.maximoDesktop.browser.newTab({ threadId, activate: true }).then(mergeBrowser);
  };

  const closeTab = (id: string) => {
    if (!threadId || suspendNative) return;
    void window.maximoDesktop.browser.closeTab({ threadId, tabId: id }).then(mergeBrowser);
  };

  if (!paneActive) return <div className="workspace-empty-state compact"><Globe2 size={17} /><span>Panel paused</span><small>Activate this pane to resume the browser.</small></div>;
  if (!threadId) return <div className="workspace-empty-state"><Globe2 size={20} /><span>Select a chat to use the browser.</span></div>;

  return (
    <div className={`workspace-browser-pane ${suspendNative ? "suspended" : ""} ${showFreezeFrame ? "has-freeze-frame" : ""}`}>
      <header className="workspace-browser-toolbar"><button type="button" onClick={() => active && void window.maximoDesktop.browser.goBack({ threadId, tabId: active.id }).then(mergeBrowser)} disabled={suspendNative || !active?.canGoBack} title="Back"><ChevronRight size={14} className="rotate-180" /></button><button type="button" onClick={() => active && void window.maximoDesktop.browser.goForward({ threadId, tabId: active.id }).then(mergeBrowser)} disabled={suspendNative || !active?.canGoForward} title="Forward"><ChevronRight size={14} /></button><button type="button" onClick={() => active && void window.maximoDesktop.browser.reload({ threadId, tabId: active.id }).then(mergeBrowser)} disabled={suspendNative || !active} title="Reload">{active?.isLoading ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />}</button><form onSubmit={(event) => { event.preventDefault(); void navigate(); }}><Globe2 size={13} /><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Search or enter web address" spellCheck={false} disabled={suspendNative} /></form>{notice && <span className="workspace-browser-notice">{notice}</span>}<button type="button" onClick={() => { if (active?.url && active.url !== "about:blank") void window.maximoDesktop.openPath(active.url); }} title="Open in system browser" disabled={suspendNative}><ExternalLink size={13} /></button><button type="button" onClick={() => active && void window.maximoDesktop.browser.copyScreenshotToClipboard({ threadId, tabId: active.id }).then(() => { setNotice("Screenshot copied"); window.setTimeout(() => setNotice(null), 1_400); })} disabled={suspendNative || !active || active.url === "about:blank"} title="Copy screenshot"><Camera size={13} /></button><button type="button" onClick={() => active && void window.maximoDesktop.browser.copyLink({ threadId, tabId: active.id })} disabled={suspendNative || !active || active.url === "about:blank"} title="Copy link"><Copy size={13} /></button></header>
      <div className="workspace-browser-tabs">{browser?.tabs.map((tab) => <div className={`workspace-browser-tab ${tab.id === active?.id ? "active" : ""}`} key={tab.id}><button type="button" onClick={() => void window.maximoDesktop.browser.selectTab({ threadId, tabId: tab.id }).then(mergeBrowser)} disabled={suspendNative}><Globe2 size={11} /><span>{tab.title}</span></button><button type="button" onClick={() => closeTab(tab.id)} title="Close tab" disabled={suspendNative}><X size={11} /></button></div>)}<button type="button" className="workspace-browser-new-tab" onClick={newTab} title="New tab" disabled={suspendNative}><Plus size={13} /></button></div>
      <div ref={viewportRef} className={`workspace-browser-surface ${showFreezeFrame ? "freeze" : nativeLive ? "live" : "idle"}`}>
        {showFreezeFrame
          ? <img className="workspace-browser-freeze-frame" src={freezeFrameUrl!} alt="" draggable={false} />
          : <div className="workspace-browser-native-placeholder" aria-hidden="true" />}
      </div>
    </div>
  );
});

const WorkspaceSideChatPane = memo(function WorkspaceSideChatPane({ sideChat, active = true }: { sideChat: WorkspaceSideChat; active?: boolean }) {
  const [prompt, setPrompt] = useState("");
  const messages = sideChat.thread?.messages.filter((message) => message.role !== "system") ?? [];
  const liveText = useLiveRun(active ? sideChat.thread?.id : undefined)?.text;
  const send = () => {
    if (!prompt.trim() || sideChat.running) return;
    sideChat.onSend(prompt.trim());
    setPrompt("");
  };
  if (!active) return <div className="workspace-empty-state compact"><MessageCircle size={17} /><span>Panel paused</span><small>Activate this pane to resume side chat.</small></div>;
  return (
    <div className="workspace-sidechat-pane">
      <header className="workspace-pane-titlebar"><div><MessageCircle size={15} /><strong>Side chat</strong><span>Companion thread</span></div></header>
      {!sideChat.thread ? <div className="workspace-empty-state"><MessageCircle size={22} /><span>Open a companion chat</span><small>Keep a second Maximo conversation beside the current task.</small><button type="button" className="primary-button compact" onClick={sideChat.onCreate}><Plus size={13} />New side chat</button></div> : <>
        <div className="workspace-sidechat-messages">{messages.length === 0 && !liveText && <div className="workspace-sidechat-empty">Ask a focused question without leaving this task.</div>}{messages.map((message) => <div className={`workspace-sidechat-message ${message.role}`} key={message.id}><span>{message.role === "user" ? "You" : "Maximo"}</span>{message.content && <MarkdownContent>{message.content}</MarkdownContent>}</div>)}{liveText && <div className="workspace-sidechat-message assistant"><span>Maximo</span><MarkdownContent streaming>{liveText}</MarkdownContent></div>}</div>
        <div className="workspace-sidechat-input"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={sideChat.running ? "Maximo is working…" : "Ask a side question…"} disabled={sideChat.running} /><button type="button" onClick={send} disabled={!prompt.trim() || sideChat.running} title="Send"><Send size={14} /></button></div>
      </>}
    </div>
  );
});

type DiffScope = "working-tree" | "unstaged" | "staged" | "branch" | "all-turns" | "last-turn";

const diffScopeOptions: Array<{ value: DiffScope; label: string; description: string }> = [
  { value: "working-tree", label: "Working tree", description: "All local changes" },
  { value: "unstaged", label: "Unstaged", description: "Changes not in the index" },
  { value: "staged", label: "Staged", description: "Changes ready to commit" },
  { value: "branch", label: "Branch", description: "Changes on this branch" },
  { value: "all-turns", label: "All turns", description: "Changes from every task turn" },
  { value: "last-turn", label: "Last turn", description: "Changes from the latest task" },
];

function DiffScopeSelect({ value, onChange }: { value: DiffScope; onChange: (value: DiffScope) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = diffScopeOptions.find((option) => option.value === value) ?? diffScopeOptions[0];
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return <div className={`custom-select workspace-diff-scope ${open ? "open" : ""}`} ref={rootRef}>
    <button type="button" className="custom-select-trigger" aria-label="Diff source" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((visible) => !visible)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}><span>{selected.label}</span><ChevronDown size={12} /></button>
    {open && <div className="custom-select-menu glass-panel" role="listbox" aria-label="Diff source">{diffScopeOptions.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "active" : ""} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}><span className="select-option-copy"><strong>{option.label}</strong><small>{option.description}</small></span><span className="select-check">{option.value === value && <Check size={13} />}</span></button>)}</div>}
  </div>;
}

const WorkspaceDiffPane = memo(function WorkspaceDiffPane({ project, git, reviewFile, reviewDiff, onOpenDiff, onCloseReview, onOpenEditor, onOpenGit, defaultWrapped = false, active = true }: { project: Project; git: GitStatus | null; reviewFile?: string | null; reviewDiff: GitDiff | null; onOpenDiff: (path: string) => void; onCloseReview: () => void; onOpenEditor: (path: string) => void; onOpenGit: () => void; defaultWrapped?: boolean; active?: boolean }) {
  const [scope, setScope] = useState<DiffScope>("working-tree");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"stacked" | "split">("stacked");
  const [wrapped, setWrapped] = useState(defaultWrapped);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());
  const [filePatches, setFilePatches] = useState<Record<string, GitDiff | null>>({});
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(() => new Set());
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileMenuOpen, setFileMenuOpen] = useState<string | null>(null);
  const [diffHeaderMenuOpen, setDiffHeaderMenuOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const jumpRef = useRef<HTMLDivElement>(null);
  const files = git?.files ?? [];
  const scopedFiles = files.filter((file) => {
    if (scope === "staged") return file.staged;
    if (scope === "unstaged") return !file.staged;
    return true;
  });
  const filteredFiles = scopedFiles.filter((file) => file.path.toLowerCase().includes(query.trim().toLowerCase()));
  const scopedFilesForJump = filteredFiles;
  const selectedFile = files.find((file) => file.path === reviewFile);
  const stats = reviewDiff ? patchStats(reviewDiff.patch) : { additions: selectedFile?.additions ?? 0, deletions: selectedFile?.deletions ?? 0 };
  const copyDiff = async () => {
    if (!reviewDiff?.patch) return;
    await navigator.clipboard.writeText(reviewDiff.patch);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  };
  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 1_800); };
  const copyPath = async (path: string) => { await navigator.clipboard.writeText(path); showToast("Path copied"); };
  const referInChat = async (path: string) => { await navigator.clipboard.writeText(`@${path}`); showToast("Reference copied — paste in chat"); };
  const askWhy = async (path: string) => { await navigator.clipboard.writeText(`Why did ${path} change in this turn?`); showToast("Prompt copied — paste in chat"); };
  const toggleFileCollapsed = (path: string) => {
    const wasCollapsed = collapsedFiles.has(path);
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (wasCollapsed) {
      const needsFetch = !filePatches[path] && !loadingFiles.has(path);
      if (needsFetch) {
        if (path === reviewFile && reviewDiff) {
          setFilePatches((m) => ({ ...m, [path]: reviewDiff }));
          return;
        }
        setLoadingFiles((s) => new Set(s).add(path));
        void window.maximoDesktop.gitDiff(project.id, path).then((diff) => {
          setFilePatches((m) => ({ ...m, [path]: diff }));
        }).catch(() => setFilePatches((m) => ({ ...m, [path]: null }))).finally(() => {
          setLoadingFiles((s) => { const n = new Set(s); n.delete(path); return n; });
        });
      }
    }
  };

  useEffect(() => setWrapped(defaultWrapped), [defaultWrapped]);
  useEffect(() => {
    if (reviewFile && reviewDiff) setFilePatches((m) => ({ ...m, [reviewFile]: reviewDiff }));
  }, [reviewFile, reviewDiff]);
  // When the user opens a file from the timeline (e.g. clicking main.ts in the
  // "Edited 3 files" card) we must ensure that file is expanded in the list
  // and its patch is cached, even if the initial auto-collapse already ran.
  // Synara's DiffPanel does the same: the selected file is always uncollapsed.
  useEffect(() => {
    if (!reviewFile) return;
    setCollapsedFiles((prev) => {
      if (!prev.has(reviewFile)) return prev;
      const next = new Set(prev);
      next.delete(reviewFile);
      return next;
    });
    // Also cache the known diff so the inline row can render immediately without
    // waiting for a second gitDiff round-trip. The detail pane uses reviewDiff
    // directly, but the file-list inline view reads from filePatches.
    if (reviewDiff && reviewDiff.path === reviewFile) {
      setFilePatches((m) => (m[reviewFile] ? m : { ...m, [reviewFile]: reviewDiff }));
    }
    if (detailCollapsed) setDetailCollapsed(false);
  }, [reviewFile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active) return;
    if (scopedFiles.length === 0) return;
    if (collapsedFiles.size !== 0) return;
    if (Object.keys(filePatches).length !== 0) return;
    const init = new Set(scopedFiles.map((f) => f.path));
    if (reviewFile) init.delete(reviewFile);
    if (init.size > 0) setCollapsedFiles(init);
  }, [active, scopedFiles, reviewFile, collapsedFiles.size, filePatches]);
  useEffect(() => {
    if (!jumpOpen) return;
    const close = (e: MouseEvent) => {
      if (!jumpRef.current?.contains(e.target as Node)) setJumpOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [jumpOpen]);
  useEffect(() => {
    if (!fileMenuOpen && !diffHeaderMenuOpen && !jumpOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".file-context-menu") && !target.closest(".file-menu-trigger")) setFileMenuOpen(null);
      if (!target.closest(".diff-header-menu") && !target.closest(".diff-header-menu-trigger")) setDiffHeaderMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [fileMenuOpen, diffHeaderMenuOpen, jumpOpen]);

  if (!active) return <div className="workspace-empty-state compact"><Diff size={17} /><span>Panel paused</span><small>Activate this pane to resume the diff.</small></div>;

  const isDetailCollapsed = detailCollapsed;

  return <div className="workspace-diff-pane">
     <header className="workspace-pane-titlebar workspace-diff-header"><div><Diff size={15} /><DiffScopeSelect value={scope} onChange={setScope} /><span>{filteredFiles.length} file{filteredFiles.length === 1 ? "" : "s"}</span></div><span className="workspace-diff-totals"><b>+{git?.additions ?? 0}</b> <i>-{git?.deletions ?? 0}</i></span></header>
    <div className="workspace-diff-toolbar"><div className="workspace-diff-toolbar-left"><button type="button" className="workspace-diff-icon-btn" onClick={() => setJumpOpen((v) => !v)} title="Jump to file" aria-label="Jump to file"><Search size={14} /></button>{jumpOpen && <div ref={jumpRef} className="workspace-diff-jump-menu"><div className="workspace-diff-jump-header"><Search size={13} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Jump to file" aria-label="Search changed files" /></div><div className="workspace-diff-jump-list">{scopedFilesForJump.length === 0 ? <div className="workspace-tree-state">{files.length ? "No matching files" : "Working tree is clean."}</div> : scopedFilesForJump.map((file) => <button type="button" key={file.path} className="workspace-diff-jump-item" onClick={() => { onOpenDiff(file.path); setJumpOpen(false); }}><span className="workspace-diff-jump-icon"><FileCode2 size={13} /></span><span className="workspace-diff-jump-copy"><strong>{file.path.split(/[\\/]/).at(-1)}</strong><small>{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "Project root"}</small></span><span className="workspace-diff-jump-stats"><b>+{file.additions}</b><i>-{file.deletions}</i></span></button>)}</div></div>}</div><div className="workspace-diff-toolbar-actions"><button type="button" className={`workspace-diff-view-btn ${view === "stacked" ? "active" : ""}`} onClick={() => setView("stacked")} title="Stacked diff">Stacked</button><button type="button" className={`workspace-diff-view-btn ${view === "split" ? "active" : ""}`} onClick={() => setView("split")} title="Split diff">Split</button><button type="button" className={`workspace-diff-view-btn ${wrapped ? "active" : ""}`} onClick={() => setWrapped((value) => !value)} title="Wrap long lines">Wrap</button><button type="button" className="workspace-diff-view-btn" onClick={() => setDetailCollapsed((value) => !value)} title={detailCollapsed ? "Expand diff" : "Collapse diff"}>{detailCollapsed ? "Expand" : "Collapse"}</button><button type="button" className="workspace-diff-icon-btn" onClick={() => void copyDiff()} disabled={!reviewDiff?.patch} title={copied ? "Copied" : "Copy diff"}>{copied ? <Check size={12} /> : <Copy size={12} />}</button><div className="workspace-diff-actions"><button type="button" className="workspace-diff-icon-btn" onClick={() => setActionsOpen((value) => !value)} title="Diff options" aria-label="Diff options"><MoreHorizontal size={14} /></button>{actionsOpen && <div className="workspace-diff-actions-menu"><button type="button" onClick={() => { setWrapped((v) => !v); setActionsOpen(false); }}><Copy size={13} />{wrapped ? "Disable wrap" : "Wrap long lines"}</button><button type="button" onClick={() => { void copyDiff(); setActionsOpen(false); }}><Copy size={13} />{copied ? "Copied" : "Copy diff"}</button><button type="button" onClick={() => { const allCollapsed = filteredFiles.every((f) => collapsedFiles.has(f.path)); if (allCollapsed) setCollapsedFiles(new Set()); else setCollapsedFiles(new Set(filteredFiles.map((f) => f.path))); setActionsOpen(false); }}><Folder size={13} />{filteredFiles.every((f) => collapsedFiles.has(f.path)) ? "Expand all" : "Collapse all"}</button><button type="button" onClick={onOpenGit}><GitCommitHorizontal size={13} />Open source control</button><button type="button" onClick={() => onOpenEditor(reviewFile ? projectFilePath(project, reviewFile) : project.path)}><ExternalLink size={13} />Open in editor</button></div>}</div></div></div>
    <div className={`workspace-diff-workspace ${view} ${wrapped ? "wrapped" : ""} ${isDetailCollapsed ? "detail-collapsed" : ""}`}>
      <aside className="workspace-diff-file-list">{filteredFiles.length === 0 ? <div className="workspace-tree-state">{files.length ? "No files match this view." : "Working tree is clean."}</div> : filteredFiles.map((file) => {
        const isCollapsed = collapsedFiles.has(file.path);
        const patchEntry = filePatches[file.path];
        const isLoading = loadingFiles.has(file.path);
        const handleHeaderClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
          const native = event.nativeEvent as unknown as { composedPath?: () => EventTarget[] };
          const path = typeof native.composedPath === "function" ? native.composedPath() : [];
          const clickedMenu = path.some((node) => node instanceof Element && node.hasAttribute("data-diff-header-menu"));
          if (clickedMenu) return;
          const clickedHeader = path.some((node) => node instanceof Element && (node.hasAttribute("data-diff-file-header") || node.hasAttribute("data-diffs-header") || node.hasAttribute("data-file-info")));
          if (!clickedHeader) return;
          event.stopPropagation();
          toggleFileCollapsed(file.path);
        };
        return <div key={file.path} className={`workspace-diff-file-row ${reviewFile === file.path ? "selected" : ""} ${isCollapsed ? "collapsed" : "expanded"}`} data-diff-file-path={file.path}>
          <div className="workspace-diff-file-row-header" data-diff-file-header="" onClickCapture={handleHeaderClickCapture}>
            <button type="button" className="workspace-diff-file-card" onClick={() => onOpenDiff(file.path)} title={file.path}><span className={`workspace-git-status status-${file.status[0]}`}>{file.status}</span><span className="workspace-diff-file-icon"><FileCode2 size={14} /></span><span className="workspace-diff-file-copy"><strong>{file.path.split(/[\\/]/).at(-1)}</strong><small>{file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "Project root"}</small></span><span className="workspace-diff-file-stats"><b>+{file.additions}</b><i>-{file.deletions}</i></span></button>
            <span data-diff-header-menu="true" className="inline-flex"><button type="button" className="file-menu-trigger" onClick={(e) => { e.stopPropagation(); setFileMenuOpen(fileMenuOpen === file.path ? null : file.path); }} aria-label="File actions"><Ellipsis size={14} /></button></span>
            <button type="button" className="turn-file-collapse file-row-collapse" aria-label={isCollapsed ? "Expand diff" : "Collapse diff"} onClick={(e) => { e.stopPropagation(); toggleFileCollapsed(file.path); }}><ChevronDown size={14} className={isCollapsed ? "" : "open"} /></button>
            {fileMenuOpen === file.path && <div className="file-context-menu"><button type="button" onClick={() => { void referInChat(file.path); setFileMenuOpen(null); }}>Refer {file.path.split(/[\\/]/).at(-1)}</button><button type="button" onClick={() => { void askWhy(file.path); setFileMenuOpen(null); }}>Ask why this changed</button><button type="button" onClick={() => { void copyPath(file.path); setFileMenuOpen(null); }}>Copy path</button></div>}
          </div>
          {!isCollapsed && <div className="workspace-diff-file-inline">
            {isLoading ? <div className="workspace-tree-state"><RefreshCw size={12} className="spin" />Loading diff…</div> : patchEntry?.patch ? <div className="workspace-diff-code inline"><DiffCode patch={patchEntry.patch} language={diffLanguageForPath(patchEntry.path)} showMetadata={false} className={view === "split" ? "split-view" : ""} /></div> : <div className="workspace-tree-state">No diff available.</div>}
          </div>}
        </div>;
      })}</aside>
       <section className="workspace-diff-detail">{!reviewFile ? <div className="workspace-empty-state"><Diff size={20} /><span>Select a file to review its changes.</span><small>Choose a changed file on the left to inspect the full patch.</small></div> : <><header className="workspace-diff-detail-header" data-diff-file-header="" onClickCapture={(event) => {
        const native = event.nativeEvent as unknown as { composedPath?: () => EventTarget[] };
        const path = typeof native.composedPath === "function" ? native.composedPath() : [];
        if (path.some((node) => node instanceof Element && node.hasAttribute("data-diff-header-menu"))) return;
        const clickedHeader = path.some((node) => node instanceof Element && (node.hasAttribute("data-diff-file-header") || node.hasAttribute("data-file-info")));
        if (!clickedHeader) return;
        const target = event.target as Element;
        if (target.closest("button") && !target.closest(".turn-file-collapse")) return;
        event.stopPropagation();
        toggleFileCollapsed(reviewFile);
      }}><div className="workspace-diff-detail-fileinfo" data-file-info=""><FileCode2 size={14} /><div><strong>{reviewFile.split(/[\\/]/).at(-1)}</strong><small>{reviewFile.includes("/") ? reviewFile.slice(0, reviewFile.lastIndexOf("/")) : "Project root"}</small></div></div><div className="workspace-diff-detail-stats"><b>+{stats.additions}</b> <i>-{stats.deletions}</i></div><div className="diff-header-actions"><span data-diff-header-menu="true" className="inline-flex"><button type="button" className="diff-header-menu-trigger" onClick={() => setDiffHeaderMenuOpen((v) => !v)} aria-label="Diff actions"><Ellipsis size={14} /></button></span>{diffHeaderMenuOpen && <div className="file-context-menu diff-header-menu"><button type="button" onClick={() => { void referInChat(reviewFile); setDiffHeaderMenuOpen(false); }}>Refer {reviewFile.split(/[\\/]/).at(-1)}</button><button type="button" onClick={() => { void askWhy(reviewFile); setDiffHeaderMenuOpen(false); }}>Ask why this changed</button><button type="button" onClick={() => { void copyPath(reviewFile); setDiffHeaderMenuOpen(false); }}>Copy path</button></div>}<button type="button" className="workspace-diff-icon-btn" onClick={(e) => { e.stopPropagation(); onOpenEditor(projectFilePath(project, reviewFile)); }} title="Open in editor"><ExternalLink size={13} /></button><button type="button" className="turn-file-collapse" aria-label={isDetailCollapsed ? "Expand diff" : "Collapse diff"} onClick={(e) => { e.stopPropagation(); setDetailCollapsed((v) => !v); }}><ChevronDown size={14} className={isDetailCollapsed ? "" : "open"} /></button></div></header>{isDetailCollapsed ? null : reviewDiff?.patch ? <div className="workspace-diff-code"><DiffCode patch={reviewDiff.patch} language={diffLanguageForPath(reviewDiff.path)} showMetadata={false} className={view === "split" ? "split-view" : ""} /></div> : <div className="workspace-empty-state"><RefreshCw size={18} className="spin" /><span>Reading diff…</span></div>}</>}</section>
    </div>
    {toast && <div className="diff-toast">{toast}</div>}
  </div>;
});

function renderLauncherButton(kind: WorkspacePaneKind, label: string, onClick: () => void, disabled = false) {
  return <button key={kind} type="button" className="workspace-launcher-button" onClick={onClick} disabled={disabled}><PaneIcon kind={kind} size={16} /><span>{label}</span><ChevronRight size={13} /></button>;
}

function WorkspaceDockUnmemoized(props: WorkspaceDockProps) {
  const storageKey = dockStorageKey(props.project, props.thread);
  const [dock, setDock] = useState<DockState>(() => readDockState(storageKey));
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setDock(readDockState(storageKey)), [storageKey]);
  useEffect(() => writeDockState(storageKey, dock), [dock, storageKey]);

  const openPane = (kind: WorkspacePaneKind, filePath?: string, url?: string) => {
    setDock((current) => {
      const existing = kind === "file" ? current.panes.find((pane) => pane.kind === "file" && pane.filePath === filePath) : current.panes.find((pane) => pane.kind === kind);
      if (existing) return { ...current, panes: url && kind === "browser" ? current.panes.map((pane) => pane.id === existing.id ? { ...pane, url } : pane) : current.panes, activePaneId: existing.id };
      const pane: DockPane = { id: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`, kind, ...(filePath ? { filePath } : {}), ...(url ? { url } : {}) };
      return { panes: [...current.panes, pane], activePaneId: pane.id };
    });
    setMenuOpen(false);
    props.onOpenChange(true);
  };

  useEffect(() => {
    if (!props.request) return;
    openPane(props.request.kind, props.request.filePath, props.request.url);
    props.onRequestHandled?.();
    // The request id is the deliberate trigger; the dock callback props may change
    // while the request is being consumed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request?.id]);

  useEffect(() => {
    if (!props.reviewFile) return;
    openPane("diff");
    // A file review is an explicit action from chat, so it always promotes Diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.reviewFile]);

  const closePane = (paneId: string) => {
    setDock((current) => {
      const index = current.panes.findIndex((pane) => pane.id === paneId);
      if (index < 0) return current;
      const panes = current.panes.filter((pane) => pane.id !== paneId);
      const nextActive = current.activePaneId === paneId ? panes[Math.min(index, panes.length - 1)]?.id ?? null : current.activePaneId;
      return { panes, activePaneId: nextActive };
    });
    const pane = dock.panes.find((candidate) => candidate.id === paneId);
    if (pane?.kind === "diff") props.onCloseReview();
  };

  useEffect(() => {
    const closeActive = () => {
      if (dock.activePaneId) closePane(dock.activePaneId);
    };
    const selectWorkspace = (event: Event) => {
      const kind = (event as CustomEvent<"terminal" | "chat">).detail;
      if (kind === "chat") {
        props.onOpenChange(false);
        return;
      }
      const pane = dock.panes.find((candidate) => candidate.kind === "terminal");
      if (pane) setDock((current) => ({ ...current, activePaneId: pane.id }));
      else openPane("terminal");
    };
    window.addEventListener("maximo:workspace-close-active", closeActive);
    window.addEventListener("maximo:workspace-select", selectWorkspace);
    return () => {
      window.removeEventListener("maximo:workspace-close-active", closeActive);
      window.removeEventListener("maximo:workspace-select", selectWorkspace);
    };
  }, [dock.activePaneId, dock.panes, props.onCloseReview, props.onOpenChange]);

  const activePane = dock.panes.find((pane) => pane.id === dock.activePaneId) ?? null;
  const paneIsActive = (paneId: string) => props.open && paneId === activePane?.id;
  const hasChanges = Boolean(props.git?.files.length);
  const launcher = useMemo(() => [
    ...(hasChanges ? [{ kind: "diff" as const, label: "Review" }] : []),
    { kind: "terminal" as const, label: "Terminal" },
    { kind: "browser" as const, label: "Browser" },
    ...(props.project ? [{ kind: "explorer" as const, label: "Files" }] : []),
    ...(props.sideChat ? [{ kind: "sidechat" as const, label: "Side chat" }] : []),
    ...(props.git?.isRepository ? [{ kind: "git" as const, label: "Source control" }] : []),
  ], [hasChanges, props.git?.isRepository, props.project, props.sideChat]);

  return (
    <>
    <aside className={`workspace-dock ${props.open ? "open" : "closed"} ${menuOpen && activePane?.kind === "browser" ? "browser-menu-open" : ""}`} aria-hidden={!props.open}>
      <header className="workspace-dock-header drag-region">
        <div className="workspace-dock-tabs no-drag">{dock.panes.map((pane) => <div className={`workspace-dock-tab ${pane.id === dock.activePaneId ? "active" : ""}`} key={pane.id}><button type="button" className="workspace-dock-tab-main" onClick={() => setDock((current) => ({ ...current, activePaneId: pane.id }))} title={paneLabel(pane)}><PaneIcon kind={pane.kind} size={13} /><span>{paneLabel(pane)}</span></button><button type="button" className="workspace-dock-tab-close" onClick={() => closePane(pane.id)} title={`Close ${paneLabel(pane)}`}><X size={12} /></button></div>)}</div>
        <div className="workspace-dock-actions no-drag">{dock.panes.length > 0 && <div className="workspace-add-menu-wrap"><button type="button" className="workspace-icon-button" onClick={() => setMenuOpen((value) => !value)} title="Add panel"><Plus size={15} /></button>{menuOpen && <div className="workspace-add-menu">{(["diff", "terminal", "browser", "explorer", "sidechat", "git"] as WorkspacePaneKind[]).map((kind) => <button type="button" key={kind} disabled={kind === "explorer" && !props.project || kind === "git" && !props.git?.isRepository || kind === "diff" && !hasChanges} onClick={() => openPane(kind)}><PaneIcon kind={kind} size={13} /><span>{kind === "explorer" ? "Explorer" : kind === "sidechat" ? "Side chat" : kind === "git" ? "Source control" : kind.charAt(0).toUpperCase() + kind.slice(1)}</span></button>)}</div>}</div>}
          <button type="button" className="workspace-icon-button" onClick={() => props.onOpenChange(false)} title="Collapse panel"><PanelRightClose size={15} /></button></div>
      </header>
      <div className="workspace-dock-body">
        {!activePane && <nav className="workspace-launcher" aria-label="Open a panel">{launcher.map((item) => renderLauncherButton(item.kind, item.label, () => openPane(item.kind), item.kind === "explorer" && !props.project))}</nav>}
        {dock.panes.map((pane) => <div className={`workspace-pane-layer ${pane.id === activePane?.id ? "active" : "inactive"}`} aria-hidden={pane.id === activePane?.id ? undefined : true} key={pane.id}>
           {pane.kind === "explorer" && props.project ? <WorkspaceExplorerPane project={props.project} active={paneIsActive(pane.id)} onOpenFile={(path) => openPane("file", path)} onOpenEditor={props.onOpenEditor} />
             : pane.kind === "file" && props.project ? <WorkspaceFileViewer project={props.project} filePath={pane.filePath ?? null} active={paneIsActive(pane.id)} onOpenEditor={props.onOpenEditor} />
               : pane.kind === "git" && props.project ? <WorkspaceGitPane project={props.project} git={props.git} active={paneIsActive(pane.id)} onOpenDiff={props.onOpenDiff} onRefresh={props.onRefreshGit} onGitChanged={props.onGitChanged} />
                    : pane.kind === "diff" && props.project ? <WorkspaceDiffPane project={props.project} git={props.git} active={paneIsActive(pane.id)} reviewFile={props.reviewFile} reviewDiff={props.reviewDiff} defaultWrapped={props.state?.settings.diffWordWrap} onOpenDiff={props.onOpenDiff} onCloseReview={props.onCloseReview} onOpenEditor={props.onOpenEditor} onOpenGit={() => openPane("git")} />
                    : pane.kind === "terminal" && props.project ? <WorkspaceTerminalPane project={props.project} settings={props.state?.settings} paneActive={paneIsActive(pane.id)} />
                        : pane.kind === "browser" ? <WorkspaceBrowserPane initialUrl={pane.url} threadId={props.thread?.id} paneActive={paneIsActive(pane.id)} suspendNative={Boolean(props.suspendNativeSurfaces)} />
                       : pane.kind === "sidechat" && props.sideChat ? <WorkspaceSideChatPane sideChat={props.sideChat} active={paneIsActive(pane.id)} />
                        : <div className="workspace-empty-state"><CircleHelp size={18} /><span>This panel is unavailable.</span></div>}
        </div>)}
      </div>
    </aside>
    {props.open && <div className="resize-handle resize-handle-inspector workspace-dock-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize workspace panel" onPointerDown={props.onResize} />}
    </>
  );
}

// The dock chrome (tabs, launcher, pane shells) ignores main-task activity
// churn. The side-chat pane subscribes directly to its keyed live snapshot, so
// text chunks never repaint the dock chrome or the main app shell.
const WorkspaceDock = memo(WorkspaceDockUnmemoized, (prev, next) =>
  prev.open === next.open &&
  prev.suspendNativeSurfaces === next.suspendNativeSurfaces &&
  prev.project === next.project &&
  prev.thread === next.thread &&
  prev.state === next.state &&
  prev.git === next.git &&
  prev.reviewFile === next.reviewFile &&
  prev.reviewDiff === next.reviewDiff &&
  prev.request === next.request &&
  prev.sideChat?.thread === next.sideChat?.thread &&
  prev.sideChat?.running === next.sideChat?.running
);

export default WorkspaceDock;
export { PaneIcon, WorkspaceFileViewer, projectFilePath };
