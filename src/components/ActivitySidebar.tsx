import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  GitBranch,
  Pin,
  PinOff,
  Plus,
  SquarePen,
} from "lucide-react";
import type { AppState, Thread } from "../../desktop/types";

interface ActivitySidebarProps {
  state: AppState;
  activeThreadId?: string;
  onOpenThread: (threadId: string) => void;
  onMarkThreadRead: (threadId: string) => void;
  onToggleThreadPinned: (threadId: string) => void;
  onNewThread: () => void;
  onAddProject: () => void;
}

type ActivityGroup = "time" | "project";

function isAttentionThread(thread: Thread): boolean {
  return thread.status === "running" || thread.status === "error" || thread.status === "cancelled" || Boolean(thread.unread);
}

function activityDate(thread: Thread): Date {
  return new Date(thread.updatedAt || thread.createdAt);
}

function dateBucket(thread: Thread): "Today" | "Yesterday" | "Earlier" {
  const now = new Date();
  const date = activityDate(thread);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startOfToday - startOfDate) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}

function activityStatus(thread: Thread): string {
  if (thread.status === "running") return "Working now";
  if (thread.status === "error") return "Needs attention";
  if (thread.status === "cancelled") return "Stopped";
  if (thread.unread) return "Done · Unread";
  return "Done";
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`;
  return `${Math.round(delta / 86_400_000)}d`;
}

function ActivitySection({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <section className="activity-sidebar-section">
    <button type="button" className="activity-sidebar-section-heading" onClick={onToggle} aria-expanded={open}><span>{label}</span>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
    {open && <div className="activity-sidebar-section-content">{children}</div>}
  </section>;
}

function ActivityThreadRow({ thread, projectName, active, onOpen, onMarkRead, onTogglePinned }: { thread: Thread; projectName: string; active: boolean; onOpen: () => void; onMarkRead: () => void; onTogglePinned: () => void }) {
  const running = thread.status === "running";
  const canMarkDone = !running && Boolean(thread.unread);
  return <div className={`activity-sidebar-row ${active ? "active" : ""} ${thread.unread ? "unread" : ""}`}>
    <button type="button" className="activity-sidebar-row-main" onClick={onOpen}>
      <span className="activity-sidebar-row-title"><span className={`activity-sidebar-status ${running ? "running" : thread.status === "error" || thread.status === "cancelled" ? "attention" : ""}`} />{thread.title}</span>
      <span className="activity-sidebar-row-meta"><FolderOpen size={11} /><span>{projectName}</span>{thread.model && <span className="activity-sidebar-row-model">{thread.model}</span>}<time>{relativeTime(thread.updatedAt)}</time></span>
    </button>
    <span className="activity-sidebar-row-actions">
      <button type="button" onClick={(event) => { event.stopPropagation(); onTogglePinned(); }} title={thread.pinned ? "Unpin chat" : "Pin chat"} aria-label={thread.pinned ? "Unpin chat" : "Pin chat"}>{thread.pinned ? <PinOff size={12} /> : <Pin size={12} />}</button>
      {canMarkDone && <button type="button" onClick={(event) => { event.stopPropagation(); onMarkRead(); }} title="Mark as read" aria-label="Mark as read"><Check size={12} /></button>}
    </span>
  </div>;
}

export default function ActivitySidebar({ state, activeThreadId, onOpenThread, onMarkThreadRead, onToggleThreadPinned, onNewThread, onAddProject }: ActivitySidebarProps) {
  const [groupMode, setGroupMode] = useState<ActivityGroup>("time");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const threads = useMemo(() => state.threads.filter((thread) => thread.messages.length > 0 && !thread.archived).sort((left, right) => right.updatedAt - left.updatedAt), [state.threads]);
  const pinned = threads.filter((thread) => thread.pinned);
  const active = threads.filter((thread) => !thread.pinned && isAttentionThread(thread));
  const done = threads.filter((thread) => !thread.pinned && !isAttentionThread(thread));
  const projectName = (thread: Thread) => state.projects.find((project) => project.id === thread.projectId)?.name ?? "Workspace";
  const grouped = (items: Thread[]) => {
    if (groupMode === "project") {
      const groups = new Map<string, Thread[]>();
      for (const thread of items) {
        const key = projectName(thread);
        groups.set(key, [...(groups.get(key) ?? []), thread]);
      }
      return [...groups.entries()];
    }
    const groups = new Map<string, Thread[]>();
    for (const thread of items) {
      const key = dateBucket(thread);
      groups.set(key, [...(groups.get(key) ?? []), thread]);
    }
    return ["Today", "Yesterday", "Earlier"].flatMap((key) => groups.has(key) ? [[key, groups.get(key)!] as [string, Thread[]]] : []);
  };
  const renderRows = (items: Thread[]) => items.map((thread) => <ActivityThreadRow key={thread.id} thread={thread} projectName={projectName(thread)} active={thread.id === activeThreadId} onOpen={() => onOpenThread(thread.id)} onMarkRead={() => onMarkThreadRead(thread.id)} onTogglePinned={() => onToggleThreadPinned(thread.id)} />);
  const groupedActive = grouped(active);
  return <div className="activity-sidebar-view">
    <div className="activity-sidebar-toolbar">
      <span className="activity-sidebar-title">Activity</span>
      <span className="activity-sidebar-toolbar-actions">
        <button type="button" onClick={onNewThread} title="New chat"><SquarePen size={13} /></button>
        <button type="button" onClick={onAddProject} title="Add project"><Plus size={14} /></button>
        <span className="activity-sidebar-menu-wrap"><button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} title="Activity grouping"><GitBranch size={13} /></button>{menuOpen && <div className="activity-sidebar-menu" role="menu"><button type="button" className={groupMode === "time" ? "selected" : ""} onClick={() => { setGroupMode("time"); setMenuOpen(false); }}>Group by time</button><button type="button" className={groupMode === "project" ? "selected" : ""} onClick={() => { setGroupMode("project"); setMenuOpen(false); }}>Group by project</button></div>}</span>
      </span>
    </div>
    {pinned.length > 0 && <ActivitySection label="Pinned" open={pinnedOpen} onToggle={() => setPinnedOpen((value) => !value)}>{renderRows(pinned)}</ActivitySection>}
    {groupedActive.length > 0 ? groupedActive.map(([label, items]) => <ActivitySection key={label} label={label} open onToggle={() => undefined}>{renderRows(items)}</ActivitySection>) : <div className="activity-sidebar-empty">No activity yet</div>}
    {done.length > 0 && <ActivitySection label="Done" open={doneOpen} onToggle={() => setDoneOpen((value) => !value)}>{renderRows(done)}</ActivitySection>}
  </div>;
}
