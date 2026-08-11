import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BellRing,
  CalendarClock,
  Check,
  ChevronRight,
  CirclePlay,
  Clock3,
  Edit3,
  GitBranch,
  History,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  TimerReset,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import type {
  AppState,
  AutomationCreateInput,
  AutomationDefinition,
  AutomationRun,
  AutomationSchedule,
  AutomationSnapshot,
  EngineModel,
  PermissionMode,
  Project,
} from "../../desktop/types";
import CustomSelect, { type SelectOption } from "./CustomSelect";
import { effortForModel, effortOptionsFor, findEngineModel } from "../utils/modelCatalog";

type AutomationFilter = "all" | "active" | "paused" | "attention";
type AutomationTemplate = "health" | "summary" | "updates";

interface AutomationFormState {
  name: string;
  description: string;
  prompt: string;
  projectId: string;
  destination: AutomationDefinition["destination"];
  threadId: string;
  scheduleType: AutomationSchedule["type"];
  runAt: string;
  everyMinutes: string;
  timeOfDay: string;
  dayOfWeek: string;
  cron: string;
  timezone: string;
  model: string;
  effort: string;
  permission: PermissionMode;
  workspaceMode: AutomationDefinition["workspaceMode"];
  allowLocalFallback: boolean;
  notificationPolicy: AutomationDefinition["notificationPolicy"];
  maxRuntimeMinutes: string;
  enabled: boolean;
}

function timezoneOffset(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      timeZoneName: "shortOffset" as Intl.DateTimeFormatOptions["timeZoneName"],
    });
    const offset = formatter.formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
    return offset ? offset.replace(/^GMT/u, "UTC") : "";
  } catch {
    return "";
  }
}

function timezoneOption(timezone: string, deviceTimezone: string): SelectOption<string> {
  const offset = timezoneOffset(timezone);
  return {
    value: timezone,
    label: timezone.replace(/_/g, " "),
    ...(offset ? { description: timezone === deviceTimezone ? `Device timezone · ${offset}` : offset } : {}),
  };
}

function supportedTimezoneOptions(): SelectOption<string>[] {
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }).supportedValuesOf;
  const supported = supportedValuesOf
    ? supportedValuesOf("timeZone")
    : ["Africa/Lagos", "America/Chicago", "America/Los_Angeles", "America/New_York", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Europe/Berlin", "Europe/London", "UTC"];
  const timezones = [deviceTimezone, "UTC", ...supported].filter((timezone, index, values) => timezone && values.indexOf(timezone) === index);
  return timezones.map((timezone) => timezoneOption(timezone, deviceTimezone));
}

const baseTimezoneOptions = supportedTimezoneOptions();

const destinationOptions: SelectOption<AutomationDefinition["destination"]>[] = [
  { value: "new_chat", label: "Fresh chat each run", description: "Keep every execution in its own chat." },
  { value: "dedicated_chat", label: "One dedicated chat", description: "Continue all runs in a single automation chat." },
  { value: "existing_chat", label: "Existing chat", description: "Continue in a chat you already use." },
];

const workspaceOptions: SelectOption<AutomationDefinition["workspaceMode"]>[] = [
  { value: "auto", label: "Auto · isolate Git projects", description: "Use a worktree for Git projects and local mode elsewhere." },
  { value: "worktree", label: "Always use a worktree", description: "Keep scheduled edits isolated from your active checkout." },
  { value: "local", label: "Active project checkout", description: "Run directly in the project folder you are using." },
];

const permissionOptions: SelectOption<PermissionMode>[] = [
  { value: "auto", label: "Auto approve safe actions", description: "Let the safety classifier decide when approval is needed." },
  { value: "default", label: "Ask for approval", description: "Request approval for tool actions." },
  { value: "acceptEdits", label: "Allow edits", description: "Approve file edits while commands can still ask." },
  { value: "plan", label: "Plan only", description: "Inspect and propose work without modifying the project." },
  { value: "full", label: "Full access", description: "Run without prompts or classifier checks in trusted projects." },
];

const scheduleTypeOptions: SelectOption<AutomationSchedule["type"]>[] = [
  { value: "manual", label: "Manual only" },
  { value: "once", label: "Once" },
  { value: "interval", label: "Every N minutes" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "cron", label: "Custom cron" },
];

const dayOptions: SelectOption<string>[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  .map((label, value) => ({ value: String(value), label }));

const runtimeOptions: SelectOption<string>[] = [
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
  { value: "240", label: "4 hours" },
  { value: "480", label: "8 hours" },
  { value: "1440", label: "24 hours" },
];

const notificationOptions: SelectOption<AutomationDefinition["notificationPolicy"]>[] = [
  { value: "all", label: "Every run", description: "Notify when any execution finishes." },
  { value: "failures_only", label: "Failures only", description: "Only interrupt you when a run needs attention." },
  { value: "none", label: "None", description: "Keep results in run history without system alerts." },
];

function localDateTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultForm(state: AppState, projectId?: string): AutomationFormState {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const nextHour = new Date(Date.now() + 60 * 60_000);
  nextHour.setMinutes(0, 0, 0);
  return {
    name: "",
    description: "",
    prompt: "",
    projectId: projectId ?? state.selectedProjectId ?? state.projects[0]?.id ?? "",
    destination: "new_chat",
    threadId: "",
    scheduleType: "daily",
    runAt: localDateTime(nextHour.toISOString()),
    everyMinutes: "60",
    timeOfDay: "09:00",
    dayOfWeek: "1",
    cron: "0 9 * * 1-5",
    timezone,
    model: state.settings.defaultModel,
    effort: state.settings.defaultEffort,
    permission: state.settings.defaultPermission,
    workspaceMode: "auto",
    allowLocalFallback: true,
    notificationPolicy: "all",
    maxRuntimeMinutes: "120",
    enabled: true,
  };
}

function templateForm(state: AppState, projectId: string | undefined, template?: AutomationTemplate): AutomationFormState {
  const form = defaultForm(state, projectId);
  if (template === "health") return { ...form, name: "Daily code health check", description: "Catch regressions before they pile up.", prompt: "Review this project for failing tests, build errors, security regressions, and obvious reliability issues. Fix only changes that are safe and well-supported by the codebase, run focused verification, and summarize what changed plus anything that still needs my decision.", scheduleType: "weekdays", timeOfDay: "09:00", workspaceMode: "worktree" };
  if (template === "summary") return { ...form, name: "Weekly project summary", description: "A concise progress and decision report.", prompt: "Review the work completed in this project over the past week. Summarize meaningful changes, unresolved problems, risks, and decisions I should make next. Do not modify files unless a small documentation correction is clearly necessary.", scheduleType: "weekly", dayOfWeek: "5", timeOfDay: "16:00", permission: "plan" };
  if (template === "updates") return { ...form, name: "Weekly dependency watch", description: "High-signal dependency and tooling updates.", prompt: "Inspect this project's direct dependencies and toolchain for important updates, security advisories, deprecations, or breaking changes. Prioritize high-impact findings, avoid noisy exhaustive lists, and propose a safe upgrade order. Do not install or update anything unless the change is clearly safe and verified.", scheduleType: "weekly", dayOfWeek: "1", timeOfDay: "10:00", workspaceMode: "worktree" };
  return form;
}

function formFromDefinition(definition: AutomationDefinition): AutomationFormState {
  const schedule = definition.schedule;
  return {
    name: definition.name,
    description: definition.description ?? "",
    prompt: definition.prompt,
    projectId: definition.projectId,
    destination: definition.destination,
    threadId: definition.threadId ?? "",
    scheduleType: schedule.type,
    runAt: schedule.type === "once" ? localDateTime(schedule.runAt) : "",
    everyMinutes: schedule.type === "interval" ? String(schedule.everyMinutes) : "60",
    timeOfDay: "timeOfDay" in schedule ? schedule.timeOfDay : "09:00",
    dayOfWeek: schedule.type === "weekly" ? String(schedule.dayOfWeek) : "1",
    cron: schedule.type === "cron" ? schedule.expression : "0 9 * * 1-5",
    timezone: "timezone" in schedule ? schedule.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    model: definition.model,
    effort: definition.effort,
    permission: definition.permission,
    workspaceMode: definition.workspaceMode,
    allowLocalFallback: definition.allowLocalFallback,
    notificationPolicy: definition.notificationPolicy,
    maxRuntimeMinutes: String(definition.maxRuntimeMinutes),
    enabled: definition.enabled,
  };
}

function scheduleFromForm(form: AutomationFormState): AutomationSchedule {
  if (form.scheduleType === "manual") return { type: "manual" };
  if (form.scheduleType === "once") {
    const runAt = new Date(form.runAt);
    if (!form.runAt || Number.isNaN(runAt.getTime())) throw new Error("Choose a valid future date and time.");
    return { type: "once", runAt: runAt.toISOString() };
  }
  if (form.scheduleType === "interval") return { type: "interval", everyMinutes: Number(form.everyMinutes) };
  if (form.scheduleType === "daily" || form.scheduleType === "weekdays") {
    return { type: form.scheduleType, timeOfDay: form.timeOfDay, timezone: form.timezone };
  }
  if (form.scheduleType === "weekly") {
    return { type: "weekly", dayOfWeek: Number(form.dayOfWeek), timeOfDay: form.timeOfDay, timezone: form.timezone };
  }
  return { type: "cron", expression: form.cron, timezone: form.timezone };
}

function scheduleLabel(schedule: AutomationSchedule): string {
  if (schedule.type === "manual") return "Manual only";
  if (schedule.type === "once") return `Once · ${formatDate(schedule.runAt)}`;
  if (schedule.type === "interval") return schedule.everyMinutes === 1 ? "Every minute" : `Every ${schedule.everyMinutes} minutes`;
  if (schedule.type === "daily") return `Daily at ${schedule.timeOfDay}`;
  if (schedule.type === "weekdays") return `Weekdays at ${schedule.timeOfDay}`;
  if (schedule.type === "weekly") return `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][schedule.dayOfWeek]} at ${schedule.timeOfDay}`;
  return `Cron · ${schedule.expression}`;
}

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function relativeDate(value?: string): string {
  if (!value) return "Never";
  const delta = Date.parse(value) - Date.now();
  const absolute = Math.abs(delta);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (absolute < 60_000) return formatter.format(Math.round(delta / 1_000), "second");
  if (absolute < 60 * 60_000) return formatter.format(Math.round(delta / 60_000), "minute");
  if (absolute < 24 * 60 * 60_000) return formatter.format(Math.round(delta / (60 * 60_000)), "hour");
  return formatter.format(Math.round(delta / (24 * 60 * 60_000)), "day");
}

function runStatusLabel(status: AutomationRun["status"]): string {
  return status.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function statusFor(definition: AutomationDefinition, runs: AutomationRun[]): { label: string; kind: string } {
  const current = runs.find((run) => run.automationId === definition.id && (run.status === "queued" || run.status === "running"));
  if (current) return { label: current.status === "running" ? "Running" : "Queued", kind: "running" };
  if (definition.lastRunStatus === "failed" || definition.lastRunStatus === "interrupted" || definition.lastRunStatus === "skipped") return { label: "Needs attention", kind: "attention" };
  if (!definition.enabled) return { label: definition.schedule.type === "once" && definition.lastRunStatus === "succeeded" ? "Completed" : "Paused", kind: "paused" };
  return { label: "Active", kind: "active" };
}

function AutomationForm({ state, models, modelOptions, modelsLoading, definition, initialProjectId, template, onRefreshModels, onClose, onSaved }: {
  state: AppState;
  models: EngineModel[];
  modelOptions: SelectOption<string>[];
  modelsLoading: boolean;
  definition?: AutomationDefinition;
  initialProjectId?: string;
  template?: AutomationTemplate;
  onRefreshModels: () => Promise<EngineModel[] | null>;
  onClose: () => void;
  onSaved: (snapshot: AutomationSnapshot) => void;
}) {
  const [form, setForm] = useState(() => definition ? formFromDefinition(definition) : templateForm(state, initialProjectId, template));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedModels = useRef(false);
  const update = <K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const threads = state.threads.filter((thread) => thread.projectId === form.projectId && !thread.archived && thread.messages.length > 0);
  const projectOptions: SelectOption<string>[] = state.projects.map((project) => ({ value: project.id, label: project.name, description: project.path }));
  const threadOptions: SelectOption<string>[] = [
    { value: "", label: "Choose a chat…" },
    ...threads.map((thread) => ({ value: thread.id, label: thread.title })),
  ];
  const selectedModel = findEngineModel(models, form.model);
  const selectedEffortOptions = effortOptionsFor(selectedModel);
  const selectableModelOptions = useMemo(() => {
    if (!form.model || modelOptions.some((option) => option.value === form.model)) return modelOptions;
    return [{ value: form.model, label: form.model, description: "Saved model is not in the active account catalog" }, ...modelOptions];
  }, [form.model, modelOptions]);
  const timezoneOptions = useMemo(() => baseTimezoneOptions.some((option) => option.value === form.timezone)
    ? baseTimezoneOptions
    : [timezoneOption(form.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"), ...baseTimezoneOptions], [form.timezone]);

  useEffect(() => {
    if (requestedModels.current || modelsLoading || models.length > 0) return;
    requestedModels.current = true;
    void onRefreshModels();
  }, [models.length, modelsLoading, onRefreshModels]);

  const chooseModel = (value: string) => {
    const model = findEngineModel(models, value);
    setForm((current) => ({ ...current, model: value, effort: effortForModel(model, current.effort) }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const input: AutomationCreateInput = {
        name: form.name,
        description: form.description,
        prompt: form.prompt,
        projectId: form.projectId,
        destination: form.destination,
        ...(form.destination !== "new_chat" && form.threadId ? { threadId: form.threadId } : {}),
        schedule: scheduleFromForm(form),
        enabled: form.enabled,
        model: form.model,
        effort: form.effort,
        permission: form.permission,
        workspaceMode: form.workspaceMode,
        allowLocalFallback: form.allowLocalFallback,
        notificationPolicy: form.notificationPolicy,
        maxRuntimeMinutes: Number(form.maxRuntimeMinutes),
      };
      const snapshot = definition
        ? await window.maximoDesktop.automations.update(definition.id, input)
        : await window.maximoDesktop.automations.create(input);
      onSaved(snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save this automation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="automation-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="automation-modal glass-panel" onSubmit={submit}>
        <header className="automation-modal-header">
          <div><span>{definition ? "EDIT AUTOMATION" : "NEW AUTOMATION"}</span><h2>{definition ? definition.name : "Put Maximo on a schedule"}</h2><p>Runs persist across restarts and keep a complete chat and execution history.</p></div>
          <button type="button" className="automation-modal-close" onClick={onClose} disabled={busy} aria-label="Close automation dialog"><X size={16} /></button>
        </header>
        <div className="automation-modal-scroll">
          {error && <div className="automation-form-error"><TriangleAlert size={15} />{error}</div>}
          <section className="automation-form-section">
            <h3>Instructions</h3>
            <label className="automation-field"><span>Title</span><input autoFocus value={form.name} onChange={(event) => update("name", event.target.value)} maxLength={160} placeholder="Review open pull requests" required /></label>
            <label className="automation-field"><span>Description <small>Optional</small></span><input value={form.description} onChange={(event) => update("description", event.target.value)} maxLength={2_000} placeholder="A short note for your future self" /></label>
            <label className="automation-field"><span>What should Maximo do?</span><textarea value={form.prompt} onChange={(event) => update("prompt", event.target.value)} rows={6} maxLength={100_000} placeholder="Inspect this project for failing tests, fix safe issues, and summarize anything that needs my decision." required /></label>
          </section>

          <section className="automation-form-section">
            <h3>Where it runs</h3>
            <div className="automation-form-grid">
              <div className="automation-field"><span>Project</span><CustomSelect value={form.projectId} options={projectOptions} onChange={(value) => { update("projectId", value); update("threadId", ""); }} ariaLabel="Automation project" /></div>
              <div className="automation-field"><span>Chat</span><CustomSelect value={form.destination} options={destinationOptions} onChange={(value) => update("destination", value)} ariaLabel="Automation chat destination" /></div>
              {form.destination === "existing_chat" && <div className="automation-field automation-grid-wide"><span>Existing chat</span><CustomSelect value={form.threadId} options={threadOptions} onChange={(value) => update("threadId", value)} ariaLabel="Existing automation chat" /></div>}
              <div className="automation-field"><span>Workspace</span><CustomSelect value={form.workspaceMode} options={workspaceOptions} onChange={(value) => update("workspaceMode", value)} ariaLabel="Automation workspace" /></div>
              <div className="automation-field"><span>Permission mode</span><CustomSelect value={form.permission} options={permissionOptions} onChange={(value) => update("permission", value)} className="permission-select" ariaLabel="Automation permission mode" /></div>
            </div>
            {(form.workspaceMode === "auto" || form.workspaceMode === "worktree") && <label className="automation-check"><input type="checkbox" checked={form.allowLocalFallback} onChange={(event) => update("allowLocalFallback", event.target.checked)} /><span><strong>Allow local fallback</strong><small>If Git cannot create a worktree, run in the active checkout instead.</small></span></label>}
            {form.workspaceMode !== "local" && <div className="automation-info"><GitBranch size={14} /><span>Worktrees and branches are kept for review after runs. Maximo never deletes them automatically.</span></div>}
            {form.permission === "full" && <div className="automation-warning"><TriangleAlert size={14} /><span>Full access can run any command without asking. Use it only for instructions and repositories you trust.</span></div>}
          </section>

          <section className="automation-form-section">
            <h3>Schedule</h3>
            <div className="automation-form-grid">
              <div className="automation-field"><span>Repeat</span><CustomSelect value={form.scheduleType} options={scheduleTypeOptions} onChange={(value) => update("scheduleType", value)} ariaLabel="Automation frequency" /></div>
              {form.scheduleType === "once" && <label className="automation-field"><span>Run at</span><input type="datetime-local" value={form.runAt} onChange={(event) => update("runAt", event.target.value)} required /></label>}
              {form.scheduleType === "interval" && <label className="automation-field"><span>Every (minutes)</span><input type="number" min="1" max="525600" value={form.everyMinutes} onChange={(event) => update("everyMinutes", event.target.value)} required /></label>}
              {form.scheduleType === "weekly" && <div className="automation-field"><span>Day</span><CustomSelect value={form.dayOfWeek} options={dayOptions} onChange={(value) => update("dayOfWeek", value)} ariaLabel="Automation day" /></div>}
              {(form.scheduleType === "daily" || form.scheduleType === "weekdays" || form.scheduleType === "weekly") && <label className="automation-field"><span>At</span><input type="time" value={form.timeOfDay} onChange={(event) => update("timeOfDay", event.target.value)} required /></label>}
              {form.scheduleType === "cron" && <label className="automation-field"><span>5-field cron</span><input value={form.cron} onChange={(event) => update("cron", event.target.value)} placeholder="0 9 * * 1-5" required /></label>}
              {["daily", "weekdays", "weekly", "cron"].includes(form.scheduleType) && <div className="automation-field"><span>Timezone</span><CustomSelect value={form.timezone} options={timezoneOptions} onChange={(value) => update("timezone", value)} className="timezone-select" placement="top" searchable searchPlaceholder="Search city or timezone" ariaLabel="Automation timezone" /></div>}
              <div className="automation-field"><span>Max runtime</span><CustomSelect value={form.maxRuntimeMinutes} options={runtimeOptions} onChange={(value) => update("maxRuntimeMinutes", value)} placement="top" ariaLabel="Maximum automation runtime" /></div>
              <div className="automation-field"><span>Notifications</span><CustomSelect value={form.notificationPolicy} options={notificationOptions} onChange={(value) => update("notificationPolicy", value)} placement="top" ariaLabel="Automation notifications" /></div>
            </div>
          </section>

          <section className="automation-form-section">
            <div className="automation-form-section-heading"><h3>Model</h3><button type="button" onClick={() => void onRefreshModels()} disabled={modelsLoading}>{modelsLoading ? <RefreshCw className="spin" size={12} /> : <RefreshCw size={12} />}Refresh</button></div>
            <div className="automation-form-grid">
              <div className="automation-field"><span>Model <small>{modelsLoading ? "Refreshing account…" : "Active account"}</small></span><CustomSelect value={form.model} options={selectableModelOptions} onChange={chooseModel} placement="top" disabled={modelsLoading && models.length === 0} ariaLabel="Automation model" /></div>
              {selectedModel?.supportsEffort && selectedEffortOptions.length > 0
                ? <div className="automation-field"><span>Reasoning effort <small>Supported by {selectedModel.displayName}</small></span><CustomSelect value={form.effort} options={selectedEffortOptions} onChange={(value) => update("effort", value)} placement="top" ariaLabel="Automation reasoning effort" /></div>
                : <div className="automation-field automation-effort-unavailable"><span>Reasoning effort</span><div>{modelsLoading ? "Loading supported efforts…" : selectedModel ? "Not supported by this model" : "Choose a catalog model to see supported efforts"}</div></div>}
            </div>
            <label className="automation-check"><input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span><strong>Enable after saving</strong><small>You can pause or run it manually at any time.</small></span></label>
          </section>
        </div>
        <footer className="automation-modal-footer"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button compact" type="submit" disabled={busy || !form.name.trim() || !form.prompt.trim() || !form.projectId}>{busy ? <RefreshCw className="spin" size={14} /> : <Check size={14} />}{definition ? "Save changes" : "Create automation"}</button></footer>
      </form>
    </div>
  );
}

export default function AutomationsView({ state, currentProject, models, modelOptions, modelsLoading, onRefreshModels, onOpenThread, onToast }: {
  state: AppState;
  currentProject?: Project;
  models: EngineModel[];
  modelOptions: SelectOption<string>[];
  modelsLoading: boolean;
  onRefreshModels: () => Promise<EngineModel[] | null>;
  onOpenThread: (threadId: string) => void;
  onToast: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<AutomationSnapshot>({ automations: [], runs: [], activeCount: 0, unreadCount: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [projectFilter, setProjectFilter] = useState(currentProject?.id ?? "all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationDefinition | "new" | null>(() => new URLSearchParams(window.location.search).get("newAutomation") === "1" ? "new" : null);
  const [template, setTemplate] = useState<AutomationTemplate | undefined>();
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.maximoDesktop.automations.list();
      setSnapshot(next);
      setSelectedId((current) => current && next.automations.some((item) => item.id === current) ? current : next.automations[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load automations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return window.maximoDesktop.automations.onChanged((next) => {
      setSnapshot(next);
      setSelectedId((current) => current && next.automations.some((item) => item.id === current) ? current : next.automations[0]?.id ?? null);
    });
  }, []);

  const visible = useMemo(() => snapshot.automations.filter((definition) => {
    if (projectFilter !== "all" && definition.projectId !== projectFilter) return false;
    const status = statusFor(definition, snapshot.runs);
    if (filter === "active" && status.kind !== "active" && status.kind !== "running") return false;
    if (filter === "paused" && status.kind !== "paused") return false;
    if (filter === "attention" && status.kind !== "attention") return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${definition.name} ${definition.description ?? ""} ${definition.prompt}`.toLowerCase().includes(needle);
  }), [filter, projectFilter, query, snapshot.automations, snapshot.runs]);
  const selected = snapshot.automations.find((definition) => definition.id === selectedId) ?? visible[0];
  const selectedRuns = selected ? snapshot.runs.filter((run) => run.automationId === selected.id) : [];
  const selectedStatus = selected ? statusFor(selected, snapshot.runs) : null;
  const projectName = (projectId: string) => state.projects.find((project) => project.id === projectId)?.name ?? "Missing project";
  const projectFilterOptions: SelectOption<string>[] = [
    { value: "all", label: "All projects" },
    ...state.projects.map((project) => ({ value: project.id, label: project.name, description: project.path })),
  ];

  const perform = async (key: string, operation: () => Promise<AutomationSnapshot>, success?: string) => {
    setBusy(key);
    setError(null);
    try {
      const next = await operation();
      setSnapshot(next);
      if (success) onToast(success);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Automation action failed.";
      setError(message);
      onToast(message);
    } finally {
      setBusy(null);
    }
  };

  const choose = (definition: AutomationDefinition) => {
    setSelectedId(definition.id);
    if (snapshot.runs.some((run) => run.automationId === definition.id && run.unread)) {
      void window.maximoDesktop.automations.markRunsRead(definition.id).then(setSnapshot).catch(() => undefined);
    }
  };

  const openTemplate = (kind: "health" | "summary" | "updates") => {
    setTemplate(kind);
    setEditing("new");
  };

  return (
    <section className="automations-surface surface-page">
      <header className="surface-page-header automations-header">
        <div className="surface-page-heading"><span className="surface-eyebrow">BACKGROUND AGENTS</span><h1>Automations</h1><span className="surface-page-subtitle">Schedule Maximo to keep working, even when you are away.</span></div>
        <div className="surface-page-actions"><button type="button" className="surface-icon-button" onClick={() => void load()} title="Refresh automations"><RefreshCw size={14} className={loading ? "spin" : ""} /></button><button type="button" className="primary-button compact" onClick={() => setEditing("new")}><Plus size={14} />New automation</button></div>
      </header>
      <div className="automations-toolbar">
        <label className="automations-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations" /></label>
        <div className="automations-filter-tabs">{(["all", "active", "paused", "attention"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "attention" ? "Needs attention" : value[0].toUpperCase() + value.slice(1)}</button>)}</div>
        <CustomSelect className="automations-project-filter" value={projectFilter} options={projectFilterOptions} onChange={setProjectFilter} ariaLabel="Filter automations by project" />
        <div className="automations-summary"><span><CirclePlay size={13} />{snapshot.activeCount} running</span><span><BellRing size={13} />{snapshot.unreadCount} unread</span></div>
      </div>
      {error && <div className="automations-error"><TriangleAlert size={15} /><span>{error}</span><button onClick={() => setError(null)}><X size={13} /></button></div>}
      <div className="automations-layout">
        <aside className="automations-list" aria-label="Automations">
          {loading && snapshot.automations.length === 0 ? <div className="automations-loading"><RefreshCw className="spin" size={17} />Loading automations…</div> : visible.length > 0 ? visible.map((definition) => {
            const status = statusFor(definition, snapshot.runs);
            const unread = snapshot.runs.some((run) => run.automationId === definition.id && run.unread);
            return <button type="button" key={definition.id} className={`automation-list-item ${selected?.id === definition.id ? "selected" : ""}`} onClick={() => choose(definition)}><span className={`automation-state-dot ${status.kind}`} /> <span className="automation-list-copy"><strong>{definition.name}{unread && <i />}</strong><small>{projectName(definition.projectId)} · {scheduleLabel(definition.schedule)}</small><span>{status.label}{definition.nextRunAt ? ` · ${relativeDate(definition.nextRunAt)}` : ""}</span></span><ChevronRight size={14} /></button>;
          }) : <div className="automation-list-empty"><Clock3 size={20} /><strong>No matches</strong><span>Try another filter or create an automation.</span></div>}
        </aside>

        <main className="automation-detail">
          {selected ? <>
            <div className="automation-detail-heading">
              <div><span className={`automation-status-pill ${selectedStatus?.kind}`}><i />{selectedStatus?.label}</span><h2>{selected.name}</h2><p>{selected.description || `Runs in ${projectName(selected.projectId)}`}</p></div>
              <div className="automation-detail-actions"><button type="button" disabled={Boolean(busy)} onClick={() => setEditing(selected)}><Edit3 size={14} />Edit</button><button type="button" disabled={Boolean(busy)} onClick={() => void perform(`toggle-${selected.id}`, () => window.maximoDesktop.automations.setEnabled(selected.id, !selected.enabled), selected.enabled ? "Automation paused." : "Automation resumed.")}>{busy === `toggle-${selected.id}` ? <RefreshCw className="spin" size={14} /> : selected.enabled ? <Pause size={14} /> : <Play size={14} />}{selected.enabled ? "Pause" : "Resume"}</button><button type="button" className="primary-button compact" disabled={Boolean(busy) || selectedRuns.some((run) => run.status === "queued" || run.status === "running")} onClick={() => void perform(`run-${selected.id}`, () => window.maximoDesktop.automations.runNow(selected.id), "Automation queued.")}>{busy === `run-${selected.id}` ? <RefreshCw className="spin" size={14} /> : <Zap size={14} />}Run now</button><button type="button" className="automation-delete-button" disabled={Boolean(busy)} title="Delete automation" onClick={() => { if (window.confirm(`Delete “${selected.name}”? Run history and worktrees are kept.`)) void perform(`delete-${selected.id}`, () => window.maximoDesktop.automations.delete(selected.id), "Automation deleted.").then(() => setSelectedId(null)); }}><Trash2 size={14} /></button></div>
            </div>
            <div className="automation-detail-grid">
              <div><CalendarClock size={15} /><span><small>Schedule</small><strong>{scheduleLabel(selected.schedule)}</strong>{"timezone" in selected.schedule && <em>{selected.schedule.timezone}</em>}</span></div>
              <div><TimerReset size={15} /><span><small>Next run</small><strong>{selected.nextRunAt ? relativeDate(selected.nextRunAt) : selected.enabled ? "Manual" : "Paused"}</strong><em>{selected.nextRunAt ? formatDate(selected.nextRunAt) : "—"}</em></span></div>
              <div><MessageSquare size={15} /><span><small>Chat</small><strong>{selected.destination === "new_chat" ? "Fresh chat each run" : selected.destination === "dedicated_chat" ? "Dedicated chat" : "Existing chat"}</strong><em>{selected.model || "CLI default model"}</em></span></div>
              <div><GitBranch size={15} /><span><small>Workspace</small><strong>{selected.workspaceMode === "auto" ? "Auto isolation" : selected.workspaceMode === "worktree" ? "Git worktree" : "Active checkout"}</strong><em>{selected.permission === "full" ? "Full access" : selected.permission === "auto" ? "Auto permissions" : selected.permission}</em></span></div>
            </div>
            <section className="automation-prompt-card"><div><Sparkles size={15} /><span>Instructions</span></div><p>{selected.prompt}</p></section>
            <section className="automation-history">
              <div className="automation-section-heading"><span><History size={15} />Run history</span><small>{selectedRuns.length} run{selectedRuns.length === 1 ? "" : "s"}</small></div>
              {selectedRuns.length > 0 ? <div className="automation-run-list">{selectedRuns.slice(0, 30).map((run) => <article key={run.id} className={`automation-run-row is-${run.status}`}><span className="automation-run-icon">{run.status === "succeeded" ? <Check size={13} /> : run.status === "running" || run.status === "queued" ? <RefreshCw className={run.status === "running" ? "spin" : ""} size={13} /> : <TriangleAlert size={13} />}</span><div><strong>{runStatusLabel(run.status)}</strong><small>{run.trigger.replace("_", " ")} · {formatDate(run.startedAt ?? run.createdAt)}</small>{(run.error || run.summary) && <p>{run.error || run.summary}</p>}</div><div className="automation-run-actions">{run.threadId && <button type="button" onClick={() => onOpenThread(run.threadId!)}>Open chat</button>}{(run.status === "running" || run.status === "queued") && <button type="button" className="danger" onClick={() => void perform(`cancel-${run.id}`, () => window.maximoDesktop.automations.cancelRun(run.id))}>Cancel</button>}</div></article>)}</div> : <div className="automation-history-empty"><History size={18} /><span>No runs yet. Use Run now to test it before relying on the schedule.</span></div>}
            </section>
          </> : <div className="automations-welcome"><span className="automations-welcome-icon"><Clock3 size={25} /></span><h2>Make routine work disappear</h2><p>Create a durable background agent from scratch, use a starter, or simply ask Maximo in a chat: “Run this every weekday at 9.”</p><button className="primary-button" onClick={() => setEditing("new")}><Plus size={14} />Create your first automation</button><div className="automation-template-grid"><button onClick={() => openTemplate("health")}><GitBranch size={16} /><strong>Code health check</strong><span>Find regressions and failing tests each morning.</span></button><button onClick={() => openTemplate("summary")}><History size={16} /><strong>Weekly summary</strong><span>Summarize progress and unresolved decisions.</span></button><button onClick={() => openTemplate("updates")}><Sparkles size={16} /><strong>Dependency watch</strong><span>Check important updates without noisy churn.</span></button></div></div>}
        </main>
      </div>
      {editing && <AutomationForm state={state} models={models} modelOptions={modelOptions} modelsLoading={modelsLoading} definition={editing === "new" ? undefined : editing} initialProjectId={currentProject?.id} template={editing === "new" ? template : undefined} onRefreshModels={onRefreshModels} onClose={() => { setEditing(null); setTemplate(undefined); }} onSaved={(next) => { setSnapshot(next); setEditing(null); setTemplate(undefined); setSelectedId(editing === "new" ? next.automations[0]?.id ?? null : editing.id); onToast(editing === "new" ? "Automation created." : "Automation updated."); }} />}
    </section>
  );
}
