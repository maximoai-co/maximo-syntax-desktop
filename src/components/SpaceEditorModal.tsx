import { useEffect, useRef, useState } from "react";
import type { SpaceIconName } from "../../desktop/types";
import { SPACE_ICON_OPTIONS, SpaceIcon } from "./SpaceIcon";

interface SpaceEditorModalProps {
  existingNames: string[];
  onClose: () => void;
  onCreate: (name: string, icon: SpaceIconName) => Promise<void>;
}

export default function SpaceEditorModal({ existingNames, onClose, onCreate }: SpaceEditorModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<SpaceIconName>("briefcase");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const duplicate = existingNames.some((item) => item.trim().toLowerCase() === name.trim().toLowerCase());
  const invalid = !name.trim() || duplicate;

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async () => {
    if (invalid || busy) {
      if (!name.trim()) setError("Enter a space name.");
      else if (duplicate) setError("That space name is already taken.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim(), icon);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the space.");
      setBusy(false);
    }
  };

  return <div className="space-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="space-editor-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="new-space-title">
      <header className="space-editor-header"><div><h2 id="new-space-title">New space</h2><p>Group projects into a focused work context. Projects you add while a space is open land in it.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close"><span aria-hidden="true">×</span></button></header>
      <label className="space-editor-field"><span>Name</span><input ref={inputRef} value={name} maxLength={32} placeholder="Work" onChange={(event) => { setName(event.target.value); setError(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }} /></label>
      <fieldset className="space-icon-field"><legend>Icon</legend><div className="space-icon-grid" role="radiogroup" aria-label="Space icon">
        {SPACE_ICON_OPTIONS.map((option) => <button key={option.name} type="button" role="radio" aria-checked={icon === option.name} className={icon === option.name ? "selected" : ""} title={option.label} onClick={() => setIcon(option.name)}><SpaceIcon icon={option.name} size={16} /></button>)}
      </div></fieldset>
      {error && <p className="space-editor-error" role="alert">{error}</p>}
      <footer className="space-editor-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary-button compact" onClick={() => void submit()} disabled={busy}>{busy ? "Creating…" : "Create space"}</button></footer>
    </section>
  </div>;
}
