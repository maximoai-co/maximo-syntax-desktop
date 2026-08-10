import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Folder, FolderPlus, X } from "lucide-react";
import type { Project, ProjectColorName, ProjectIconName } from "../../desktop/types";
import { MAX_PROJECT_SOURCE_COUNT } from "../../desktop/types";
import { ProjectAppearancePicker } from "./ProjectIcon";

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export interface ProjectEditorValues {
  name: string;
  sourcePaths: string[];
  icon: ProjectIconName;
  color: ProjectColorName;
}

interface ProjectEditorModalProps {
  mode: "create" | "edit";
  project?: Project;
  onClose: () => void;
  onChooseSources: () => Promise<string[]>;
  onSave: (values: ProjectEditorValues) => Promise<void>;
}

export default function ProjectEditorModal({ mode, project, onClose, onChooseSources, onSave }: ProjectEditorModalProps) {
  const [name, setName] = useState(project?.name ?? "");
  const [sourcePaths, setSourcePaths] = useState<string[]>(() => {
    const paths = project?.sourcePaths?.length ? project.sourcePaths : project?.path ? [project.path] : [];
    return [...paths];
  });
  const [icon, setIcon] = useState<ProjectIconName>(project?.icon ?? "folder");
  const [color, setColor] = useState<ProjectColorName>(project?.color ?? "default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEdit = mode === "edit";

  useEffect(() => inputRef.current?.focus(), []);

  const addSources = async () => {
    if (sourcePaths.length >= MAX_PROJECT_SOURCE_COUNT || busy) return;
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
    if (busy) return;
    if (!name.trim()) {
      setError("Enter a project name.");
      return;
    }
    if (!sourcePaths.length) {
      setError("Add at least one source folder.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), sourcePaths, icon, color });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Unable to ${isEdit ? "save" : "create"} the project.`);
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form className="create-project-modal glass-panel" onSubmit={submit}>
      <div className="modal-header"><div><span className="eyebrow">WORKSPACE</span><h2>{isEdit ? "Edit project" : "Create project"}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={17} /></button></div>
      <div className="project-name-input"><ProjectAppearancePicker icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} /><input ref={inputRef} value={name} onChange={(event) => { setName(event.target.value); setError(null); }} placeholder="Project name" aria-label="Project name" /></div>
      <div className="project-source-heading"><strong>Source folders</strong><small>{sourcePaths.length ? `${sourcePaths.length}/${MAX_PROJECT_SOURCE_COUNT} selected` : `Add up to ${MAX_PROJECT_SOURCE_COUNT} folders`}</small></div>
      <div className="project-source-list">
        {sourcePaths.map((path, index) => <div className="project-source-row" key={path}><Folder size={15} /><span><strong>{folderName(path)}</strong><small>{path}</small></span>{index === 0 ? <b><Check size={12} />Primary</b> : <button type="button" className="project-source-primary" onClick={() => makePrimary(path)}>Make primary</button>}<button type="button" className="project-source-remove" onClick={() => setSourcePaths((current) => current.filter((item) => item !== path))} aria-label={`Remove ${folderName(path)}`}><X size={13} /></button></div>)}
        <button type="button" className="add-source-button" onClick={() => void addSources()} disabled={busy || sourcePaths.length >= MAX_PROJECT_SOURCE_COUNT}><FolderPlus size={15} />{sourcePaths.length >= MAX_PROJECT_SOURCE_COUNT ? `Maximum ${MAX_PROJECT_SOURCE_COUNT} folders` : "Add folder"}</button>
      </div>
      <p className="project-source-note">The primary folder is the CLI working directory. Other folders are passed to Syntax as additional allowed project directories.</p>
      {error && <p className="project-form-error" role="alert">{error}</p>}
      <footer className="modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary-button compact" disabled={busy || sourcePaths.length === 0}>{busy ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save" : "Create project")}</button></footer>
    </form>
  </div>;
}
