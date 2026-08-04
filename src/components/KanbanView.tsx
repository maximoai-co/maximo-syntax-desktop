import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Pin,
  Plus,
  SquarePen,
} from "lucide-react";
import type { AppState, Project, Thread } from "../../desktop/types";

interface KanbanViewProps {
  state: AppState;
  currentProject?: Project;
  onOpenThread: (threadId: string) => void;
  onNewThread: (projectId: string) => void;
}

type KanbanColumn = "draft" | "in-progress" | "done";

function columnFor(thread: Thread): KanbanColumn {
  if (thread.messages.length === 0) return "draft";
  return thread.status === "running" ? "in-progress" : "done";
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h`;
  return `${Math.round(delta / 86_400_000)}d`;
}

function KanbanStatusIcon({ column }: { column: KanbanColumn }) {
  if (column === "draft") return <span className="kanban-status-icon draft" aria-label="Draft" />;
  if (column === "in-progress") return <LoaderCircle size={14} className="kanban-status-icon running spin" aria-label="In progress" />;
  return <span className="kanban-status-icon done" aria-label="Done"><Check size={9} /></span>;
}

function KanbanCard({ thread, project, column, onOpen }: { thread: Thread; project: Project; column: KanbanColumn; onOpen: () => void }) {
  return <button type="button" className="kanban-card" onClick={onOpen}>
    <span className="kanban-card-title"><span>{thread.title || "New task"}</span>{thread.pinned && <Pin size={12} />}</span>
    {column === "draft" && <span className="kanban-card-description">Ready to start in {project.name}</span>}
    <span className="kanban-card-meta"><FolderOpen size={12} /><span>{project.name}</span>{thread.model && <span className="kanban-card-model">{thread.model}</span>}</span>
    <span className="kanban-card-footer"><span>{thread.status === "running" ? "Working now" : column === "draft" ? "Draft" : thread.status === "error" ? "Needs attention" : "Completed"}</span><span>{relativeTime(thread.updatedAt)}</span></span>
  </button>;
}

function KanbanColumnView({ label, column, threads, project, onOpen, onNew }: { label: string; column: KanbanColumn; threads: Thread[]; project: Project; onOpen: (threadId: string) => void; onNew?: () => void }) {
  return <section className="kanban-column"><header className="kanban-column-header"><span>{label}</span><span className="kanban-column-count">{threads.length}</span><span className="kanban-column-actions">{onNew && <button type="button" onClick={onNew} title="New task"><Plus size={14} /></button>}<KanbanStatusIcon column={column} /></span></header><div className="kanban-column-body">{threads.map((thread) => <KanbanCard key={thread.id} thread={thread} project={project} column={column} onOpen={() => onOpen(thread.id)} />)}{threads.length === 0 && <div className="kanban-empty-column">No cards</div>}</div></section>;
}

export default function KanbanView({ state, currentProject, onOpenThread, onNewThread }: KanbanViewProps) {
  const projects = state.projects;
  const [projectId, setProjectId] = useState(currentProject?.id ?? projects[0]?.id ?? "");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  useEffect(() => {
    if (currentProject?.id) setProjectId(currentProject.id);
    else if (!projects.some((project) => project.id === projectId)) setProjectId(projects[0]?.id ?? "");
  }, [currentProject?.id, projectId, projects]);
  const project = projects.find((candidate) => candidate.id === projectId) ?? projects[0];
  const columns = useMemo(() => {
    const result: Record<KanbanColumn, Thread[]> = { draft: [], "in-progress": [], done: [] };
    if (!project) return result;
    for (const thread of state.threads.filter((candidate) => candidate.projectId === project.id && !candidate.archived)) result[columnFor(thread)].push(thread);
    for (const column of Object.keys(result) as KanbanColumn[]) result[column].sort((left, right) => right.updatedAt - left.updatedAt);
    return result;
  }, [project, state.threads]);
  if (!project) return <section className="surface-page"><div className="surface-empty"><FolderOpen size={24} /><strong>Create a project to use Kanban</strong><span>Kanban organizes local chats into derived Draft, In Progress, and Done columns.</span></div></section>;
  return <section className="surface-page kanban-surface">
    <header className="surface-page-header"><div className="surface-page-heading"><span className="surface-eyebrow">WORKSPACE FLOW</span><h1>Kanban</h1><span className="surface-page-subtitle">{columns.draft.length + columns["in-progress"].length + columns.done.length} tasks</span></div><div className="surface-page-actions"><div className="surface-select-wrap"><button type="button" className="surface-select-trigger" onClick={() => setProjectMenuOpen((value) => !value)} aria-expanded={projectMenuOpen}><FolderOpen size={14} /><span>{project.name}</span><ChevronDown size={13} /></button>{projectMenuOpen && <div className="surface-select-menu" role="listbox">{projects.map((candidate) => <button type="button" role="option" aria-selected={candidate.id === project.id} className={candidate.id === project.id ? "selected" : ""} key={candidate.id} onClick={() => { setProjectId(candidate.id); setProjectMenuOpen(false); }}>{candidate.name}{candidate.id === project.id && <Check size={13} />}</button>)}</div>}</div><button type="button" className="surface-primary-button" onClick={() => onNewThread(project.id)}><SquarePen size={14} />New task</button></div></header>
    <div className="kanban-board-note"><GitBranch size={13} />Columns are derived from local chat state. Draft chats have no messages yet; running chats appear in progress.</div>
    <main className="kanban-board"><KanbanColumnView label="Draft" column="draft" threads={columns.draft} project={project} onOpen={onOpenThread} onNew={() => onNewThread(project.id)} /><KanbanColumnView label="In Progress" column="in-progress" threads={columns["in-progress"]} project={project} onOpen={onOpenThread} /><KanbanColumnView label="Done" column="done" threads={columns.done} project={project} onOpen={onOpenThread} /></main>
  </section>;
}
