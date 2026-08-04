import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  FileCode2,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  Globe2,
  HardDrive,
  Pencil,
  RefreshCw,
  Settings,
  TerminalSquare,
  Trash2,
  Wrench,
} from "lucide-react";
import type { GitRemote, GitStatus, LocalServer, PinnedMessage, Project, RunActivity, Settings as DesktopSettings, Thread, ThreadMarker } from "../../desktop/types";
import type { WorkspacePaneKind } from "./WorkspaceDock";

interface WorkspaceEnvironmentProps {
  open: boolean;
  project?: Project;
  thread?: Thread;
  git: GitStatus | null;
  activity?: RunActivity[];
  onJumpToMessage: (messageId: string) => void;
  onTogglePinDone: (messageId: string, done: boolean) => void;
  onRemovePin: (messageId: string) => void;
  onRenamePin: (messageId: string, label: string | null) => void;
  onToggleMarkerDone: (markerId: string, done: boolean) => void;
  onRemoveMarker: (markerId: string) => void;
  onRenameMarker: (markerId: string, label: string | null) => void;
  onUpdateNotes: (notes: string) => void;
  onOpenDock: (kind: WorkspacePaneKind) => void;
  onOpenBrowser: (url: string) => void;
  onReveal: () => void;
  onOpenEditor: () => void;
  onRefresh: () => void;
  onSettings: () => void;
  onUsage: () => void;
  settings: Pick<DesktopSettings, "showEnvironmentUsage" | "showEnvironmentLocalServers" | "showEnvironmentRepository" | "showEnvironmentEditor" | "showEnvironmentPinned" | "showEnvironmentMarkers" | "showEnvironmentNotepad" | "showEnvironmentActivity">;
}

function EnvironmentRow({ icon, label, trailing, onClick, disabled = false, className = "" }: { icon: ReactNode; label: ReactNode; trailing?: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return <button type="button" className={`workspace-environment-row ${className}`} onClick={onClick} disabled={disabled}><span className="workspace-environment-row-icon">{icon}</span><span className="workspace-environment-row-label">{label}</span>{trailing && <span className="workspace-environment-row-trailing">{trailing}</span>}</button>;
}

function EnvironmentSection({ label, children, open, onToggle }: { label: string; children: ReactNode; open: boolean; onToggle: () => void }) {
  return <section className="workspace-environment-section"><button type="button" className="workspace-environment-section-heading" onClick={onToggle}><span>{label}</span>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>{open && children}</section>;
}

function markerLabel(marker: ThreadMarker, text: string | undefined): string {
  if (marker.label?.trim()) return marker.label.trim();
  const source = marker.selectedText || text || "Marked message";
  return source.replace(/\s+/g, " ").trim().slice(0, 82) || "Marked message";
}

function pinLabel(pin: PinnedMessage, text: string | undefined): string {
  if (pin.label?.trim()) return pin.label.trim();
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 82) || "Pinned message";
}

function EnvironmentChecklistRow({
  label,
  checked,
  leading,
  available,
  onJump,
  onToggle,
  onRemove,
  onRename,
}: {
  label: string;
  checked: boolean;
  leading?: ReactNode;
  available: boolean;
  onJump: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (label: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  useEffect(() => {
    if (!editing) setDraft(label);
  }, [editing, label]);

  const commit = () => {
    onRename(draft.trim() || null);
    setEditing(false);
  };

  return <li className={`workspace-environment-item ${checked ? "done" : ""} ${!available ? "unavailable" : ""}`}>
    <button type="button" className="workspace-environment-check" onClick={onToggle} title={checked ? "Mark not done" : "Mark done"} aria-label={checked ? "Mark not done" : "Mark done"}><span>{checked && <Check size={10} />}</span></button>
    {editing ? <input className="workspace-environment-item-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") setEditing(false); }} autoFocus maxLength={160} /> : <button type="button" className="workspace-environment-item-label" onClick={onJump} onDoubleClick={() => setEditing(true)} onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); setEditing(true); } }} title={available ? "Click to jump; double-click or press F2 to rename" : "Message is unavailable; double-click or press F2 to rename"}>{leading && <span className="workspace-environment-item-leading">{leading}</span>}<span>{label}</span></button>}
    <button type="button" className="workspace-environment-item-action edit" onClick={() => setEditing(true)} title="Rename"><Pencil size={11} /></button>
    <button type="button" className="workspace-environment-item-action remove" onClick={onRemove} title="Remove"><Trash2 size={11} /></button>
  </li>;
}

function EnvironmentNotes({ thread, onUpdate }: { thread?: Thread; onUpdate: (notes: string) => void }) {
  const [value, setValue] = useState(thread?.notes ?? "");
  useEffect(() => setValue(thread?.notes ?? ""), [thread?.id, thread?.notes]);
  useEffect(() => {
    if (!thread || value === (thread.notes ?? "")) return;
    const timer = window.setTimeout(() => onUpdate(value), 450);
    return () => window.clearTimeout(timer);
  }, [onUpdate, thread, value]);
  return <div className="workspace-environment-notes"><textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="Type here" maxLength={10_000} aria-label="Chat notes" /><small>{value.length.toLocaleString()} / 10,000</small></div>;
}

export default function WorkspaceEnvironment({ open, project, thread, git, activity, onJumpToMessage, onTogglePinDone, onRemovePin, onRenamePin, onToggleMarkerDone, onRemoveMarker, onRenameMarker, onUpdateNotes, onOpenDock, onOpenBrowser, onReveal, onOpenEditor, onRefresh, onSettings, onUsage, settings }: WorkspaceEnvironmentProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(true);
  const [markersOpen, setMarkersOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [servers, setServers] = useState<LocalServer[]>([]);
  const [serversLoading, setServersLoading] = useState(false);
  const [remote, setRemote] = useState<GitRemote | null>(null);

  useEffect(() => {
    if (!project) {
      setRemote(null);
      return;
    }
    void window.maximoDesktop.gitRemote(project.id).then(setRemote).catch(() => setRemote(null));
  }, [project?.id]);

  useEffect(() => {
    if (!open || !serversOpen) return;
    setServersLoading(true);
    void window.maximoDesktop.listLocalServers().then(setServers).catch(() => setServers([])).finally(() => setServersLoading(false));
  }, [open, serversOpen]);

  if (!project) return null;
  const recentActivity = activity?.slice(-5).reverse() ?? [];
  const messageText = new Map((thread?.messages ?? []).map((message) => [message.id, message.content]));
  const pins = thread?.pinnedMessages ?? [];
  const markers = thread?.markers ?? [];
  return <aside className={`workspace-environment glass-panel ${open ? "open" : "closed"}`} aria-label="Environment" aria-hidden={!open}>
    <header className="workspace-environment-header"><div><span>Environment</span><small title={project.path}>{project.name}</small></div><button type="button" onClick={onSettings} title="Environment settings"><Settings size={14} /></button></header>
    <div className="workspace-environment-content">
       <EnvironmentRow icon={<FileCode2 size={15} />} label="Changes" trailing={git?.isRepository ? <><b className="workspace-additions">+{git.additions}</b><i className="workspace-deletions">-{git.deletions}</i></> : <ChevronRight size={13} />} onClick={() => onOpenDock("diff")} disabled={!git?.isRepository} />
       {settings.showEnvironmentUsage && <EnvironmentRow icon={<Gauge size={15} />} label="Usage remaining" trailing={<ChevronRight size={13} />} onClick={onUsage} />}
      <EnvironmentSection label="Local" open={localOpen} onToggle={() => setLocalOpen((value) => !value)}><EnvironmentRow icon={<HardDrive size={14} />} label={<span title={project.path}>{project.path}</span>} trailing={<ExternalLink size={13} />} onClick={onReveal} /></EnvironmentSection>
      <EnvironmentRow icon={<GitBranch size={15} />} label={git?.branch || "main"} trailing={<ChevronDown size={13} />} onClick={() => onOpenDock("git")} disabled={!git?.isRepository} />
      <EnvironmentRow icon={<GitCommitHorizontal size={15} />} label="Commit and Push" trailing={<ChevronRight size={13} />} onClick={() => onOpenDock("git")} disabled={!git?.isRepository || Boolean(git.clean)} />
       {settings.showEnvironmentLocalServers && <EnvironmentSection label="Local Servers" open={serversOpen} onToggle={() => setServersOpen((value) => !value)}><div className="workspace-server-list">{serversLoading ? <div className="workspace-environment-subtle"><RefreshCw size={12} className="spin" />Scanning listening ports...</div> : servers.length ? servers.map((server) => <button type="button" className="workspace-server-row" key={`${server.address}:${server.port}`} onClick={() => onOpenBrowser(`${server.protocol}://${server.address}:${server.port}`)}><Globe2 size={13} /><span>{server.address}:{server.port}</span><ExternalLink size={11} /></button>) : <div className="workspace-environment-subtle">No local servers detected.</div>}<button type="button" className="workspace-server-refresh" onClick={() => { setServersOpen(false); window.setTimeout(() => setServersOpen(true), 0); }}><RefreshCw size={11} />Refresh</button></div></EnvironmentSection>}
       {settings.showEnvironmentRepository && remote && <EnvironmentSection label="Repository" open={true} onToggle={() => undefined}><EnvironmentRow icon={<GitBranch size={15} />} label={<span title={remote.url}>{remote.url.replace(/^git@github\.com:/, "github.com/").replace(/\.git$/, "")}</span>} trailing={<ExternalLink size={13} />} onClick={() => onOpenBrowser(remote.url.startsWith("git@github.com:") ? `https://github.com/${remote.url.slice("git@github.com:".length).replace(/\.git$/, "")}` : remote.url)} /></EnvironmentSection>}
       {settings.showEnvironmentEditor && <EnvironmentSection label="Editor" open={true} onToggle={() => undefined}><EnvironmentRow icon={<Code2 size={15} />} label="Editor view" trailing={<ChevronRight size={13} />} onClick={() => onOpenDock("explorer")} /><EnvironmentRow icon={<Wrench size={14} />} label="Open in external editor" trailing={<ExternalLink size={13} />} onClick={onOpenEditor} /></EnvironmentSection>}
       {settings.showEnvironmentPinned && thread && pins.length > 0 && <EnvironmentSection label="Pinned" open={pinsOpen} onToggle={() => setPinsOpen((value) => !value)}><ul className="workspace-environment-items">{pins.map((pin) => <EnvironmentChecklistRow key={pin.messageId} label={pinLabel(pin, messageText.get(pin.messageId))} checked={pin.done} available={messageText.has(pin.messageId)} onJump={() => onJumpToMessage(pin.messageId)} onToggle={() => onTogglePinDone(pin.messageId, !pin.done)} onRemove={() => onRemovePin(pin.messageId)} onRename={(label) => onRenamePin(pin.messageId, label)} />)}</ul></EnvironmentSection>}
       {settings.showEnvironmentMarkers && thread && markers.length > 0 && <EnvironmentSection label="Markers" open={markersOpen} onToggle={() => setMarkersOpen((value) => !value)}><ul className="workspace-environment-items">{markers.map((marker) => <EnvironmentChecklistRow key={marker.id} label={markerLabel(marker, messageText.get(marker.messageId))} checked={marker.done} available={messageText.has(marker.messageId)} leading={<span className={`workspace-marker-swatch ${marker.color}`} />} onJump={() => onJumpToMessage(marker.messageId)} onToggle={() => onToggleMarkerDone(marker.id, !marker.done)} onRemove={() => onRemoveMarker(marker.id)} onRename={(label) => onRenameMarker(marker.id, label)} />)}</ul></EnvironmentSection>}
       {settings.showEnvironmentNotepad && thread && <EnvironmentSection label="Notepad" open={notesOpen} onToggle={() => setNotesOpen((value) => !value)}><EnvironmentNotes thread={thread} onUpdate={onUpdateNotes} /></EnvironmentSection>}
       {settings.showEnvironmentActivity && thread && recentActivity.length > 0 && <EnvironmentSection label="Activity" open={activityOpen} onToggle={() => setActivityOpen((value) => !value)}><div className="workspace-environment-activity">{recentActivity.map((item, index) => <div key={`${item.timestamp}-${index}`}><TerminalSquare size={12} /><span>{item.label}</span></div>)}</div></EnvironmentSection>}
    </div>
    <footer className="workspace-environment-footer"><button type="button" onClick={onRefresh}><RefreshCw size={12} />Refresh status</button><button type="button" onClick={() => onOpenDock("terminal")}><TerminalSquare size={12} />Terminal</button></footer>
  </aside>;
}
