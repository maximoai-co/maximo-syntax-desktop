import { Check, ShieldAlert, ShieldCheck, X } from "lucide-react";

export interface PermissionRequestPayload {
  toolName: string;
  description?: string;
  detail?: string;
}

interface PermissionRequestModalProps {
  request: PermissionRequestPayload;
  onApprove: (remember: boolean) => void;
  onDeny: () => void;
}

function summarizeInput(toolName: string, raw: string): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (toolName === "Bash" || toolName === "KillShell") return typeof parsed.command === "string" ? parsed.command : undefined;
    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit" || toolName === "NotebookEdit") {
      if (typeof parsed.file_path === "string") return parsed.file_path;
      if (typeof parsed.path === "string") return parsed.path;
    }
    if (toolName === "WebFetch" || toolName === "WebSearch") {
      if (typeof parsed.url === "string") return parsed.url;
      if (typeof parsed.query === "string") return parsed.query;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toolDescription(toolName: string): string {
  switch (toolName) {
    case "Bash": return "Run a shell command in the project folder.";
    case "Edit": return "Modify an existing file.";
    case "Write": return "Create or overwrite a file.";
    case "MultiEdit": return "Apply multiple edits to one or more files.";
    case "NotebookEdit": return "Edit a Jupyter notebook cell.";
    case "WebFetch": return "Fetch content from a URL.";
    case "WebSearch": return "Search the web.";
    case "KillShell": return "Stop a running shell process.";
    case "Agent": return "Spawn a sub-agent to handle a sub-task.";
    default: return `${toolName} wants to run.`;
  }
}

export default function PermissionRequestModal({ request, onApprove, onDeny }: PermissionRequestModalProps) {
  const detail = summarizeInput(request.toolName, request.detail ?? "") ?? request.detail;
  return (
    <section className="permission-panel" role="dialog" aria-modal="true" aria-labelledby="permission-modal-title">
      <header className="modal-header">
        <div>
          <span className="eyebrow">PERMISSION REQUESTED</span>
          <h2 id="permission-modal-title">Allow {request.toolName}?</h2>
        </div>
        <button type="button" onClick={onDeny} aria-label="Deny"><X size={17} /></button>
      </header>
      <div className="permission-body">
        <span className="permission-icon"><ShieldAlert size={18} /></span>
        <div className="permission-meta">
          <p>{request.description ?? toolDescription(request.toolName)}</p>
          {detail && <pre className="permission-detail">{detail}</pre>}
        </div>
      </div>
      <div className="permission-choices" aria-label="Permission choices">
        <button type="button" className="permission-choice" onClick={() => onApprove(false)}>
          <span className="permission-choice-number">1</span>
          <span className="permission-choice-copy"><strong>Approve once</strong><small>Allow just this request</small></span>
          <ShieldCheck size={14} />
        </button>
        <button type="button" className="permission-choice" onClick={() => onApprove(true)}>
          <span className="permission-choice-number">2</span>
          <span className="permission-choice-copy"><strong>Always allow this project</strong><small>Do not ask again for {request.toolName}</small></span>
          <Check size={14} />
        </button>
        <button type="button" className="permission-choice danger" onClick={onDeny}>
          <span className="permission-choice-number">3</span>
          <span className="permission-choice-copy"><strong>Deny</strong><small>Reject this request and stop here</small></span>
          <X size={14} />
        </button>
      </div>
    </section>
  );
}
