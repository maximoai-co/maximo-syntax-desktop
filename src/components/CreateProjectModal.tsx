import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, Folder, FolderPlus, Plus, X } from "lucide-react";
import { MAX_PROJECT_SOURCE_COUNT } from "../../desktop/types";
import type { Space, SpaceIconName } from "../../desktop/types";
import SpaceEditorModal from "./SpaceEditorModal";
import { SpaceIcon } from "./SpaceIcon";

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function SpacePicker({ spaces, value, onChange, disabled }: { spaces: Space[]; value: string | null; onChange: (value: string | null) => void; disabled: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = value ? spaces.find((space) => space.id === value) : undefined;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return <div className="project-space-select" ref={rootRef}>
    <button type="button" className="project-space-select-trigger" onClick={() => setOpen((current) => !current)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}><SpaceIcon icon={selected?.icon ?? "cloud"} size={15} /><span>{selected?.name ?? "Void · Unfiled"}</span><ChevronDown size={13} /></button>
    {open && <div className="project-space-select-menu glass-panel" role="listbox" aria-label="Project space">
      <button type="button" role="option" aria-selected={!value} className={!value ? "selected" : ""} onClick={() => { onChange(null); setOpen(false); }}><SpaceIcon icon="cloud" size={14} /><span>Void · Unfiled</span>{!value && <Check size={13} />}</button>
      {spaces.map((space) => <button type="button" role="option" aria-selected={space.id === value} className={space.id === value ? "selected" : ""} key={space.id} onClick={() => { onChange(space.id); setOpen(false); }}><SpaceIcon icon={space.icon} size={14} /><span>{space.name}</span>{space.id === value && <Check size={13} />}</button>)}
    </div>}
  </div>;
}

interface CreateProjectModalProps {
  onClose: () => void;
  onChooseSources: () => Promise<string[]>;
  onCreate: (name: string, sourcePaths: string[], spaceId: string | null) => Promise<void>;
  spaces: Space[];
  selectedSpaceId?: string | null;
  onCreateSpace: (name: string, icon: SpaceIconName) => Promise<Space>;
}

export default function CreateProjectModal({ onClose, onChooseSources, onCreate, spaces, selectedSpaceId = null, onCreateSpace }: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(selectedSpaceId);
  const [spaceEditorOpen, setSpaceEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const addSources = async () => {
    if (sourcePaths.length >= MAX_PROJECT_SOURCE_COUNT) return;
    try {
      const chosen = await onChooseSources();
      setSourcePaths((current) => [...new Set([...current, ...chosen])].slice(0, MAX_PROJECT_SOURCE_COUNT));
      if (!name.trim() && chosen[0]) setName(folderName(chosen[0]));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to choose source folders.");
    }
  };

  const makePrimary = (path: string) => {
    setSourcePaths((current) => [path, ...current.filter((item) => item !== path)]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sourcePaths.length || busy) {
      if (!sourcePaths.length) setError("Add at least one source folder.");
      return;
    }
    setBusy(true);
    setError(null);
    try { await onCreate(name, sourcePaths, spaceId); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create the project."); } finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="create-project-modal glass-panel" onSubmit={submit}>
      <div className="modal-header"><div><span className="eyebrow">WORKSPACE</span><h2>Create project</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></div>
      <label className="project-name-input"><Folder size={16} /><input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" aria-label="Project name" /></label>
       <div className="project-source-heading"><strong>Source folders</strong><small>{sourcePaths.length ? `${sourcePaths.length}/${MAX_PROJECT_SOURCE_COUNT} selected` : `Add up to ${MAX_PROJECT_SOURCE_COUNT} folders`}</small></div>
       <div className="project-source-list">
         {sourcePaths.map((path, index) => <div className="project-source-row" key={path}><Folder size={15} /><span><strong>{folderName(path)}</strong><small>{path}</small></span>{index === 0 ? <b><Check size={12} />Primary</b> : <button type="button" className="project-source-primary" onClick={() => makePrimary(path)}>Make primary</button>}<button type="button" className="project-source-remove" onClick={() => setSourcePaths((current) => current.filter((item) => item !== path))} aria-label={`Remove ${folderName(path)}`}><X size={13} /></button></div>)}
         <button type="button" className="add-source-button" onClick={() => void addSources()} disabled={busy || sourcePaths.length >= MAX_PROJECT_SOURCE_COUNT}><FolderPlus size={15} />{sourcePaths.length >= MAX_PROJECT_SOURCE_COUNT ? `Maximum ${MAX_PROJECT_SOURCE_COUNT} folders` : "Add folder"}</button>
       </div>
       <p className="project-source-note">The primary folder is the CLI working directory. Other folders are passed to Syntax as additional allowed project directories.</p>
      <div className="project-space-heading"><strong>Space</strong><small>Group this project into a focused work context</small></div>
       <div className="project-space-row">
        <SpacePicker spaces={spaces} value={spaceId} onChange={setSpaceId} disabled={busy} />
        <button type="button" className="project-space-add" onClick={() => setSpaceEditorOpen(true)} disabled={busy} title="Create a new space" aria-label="Create a new space"><Plus size={15} /></button>
       </div>
       {error && <p className="project-form-error" role="alert">{error}</p>}
      <footer className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary-button compact" disabled={busy || sourcePaths.length === 0}>{busy ? "Creating…" : "Create project"}</button></footer>
      {spaceEditorOpen && <SpaceEditorModal existingNames={["Void", ...spaces.map((space) => space.name)]} onClose={() => setSpaceEditorOpen(false)} onCreate={async (newName, icon) => { const created = await onCreateSpace(newName, icon); setSpaceId(created.id); }} />}
    </form>
  </div>;
}
