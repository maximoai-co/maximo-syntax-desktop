import { useEffect, useState } from "react";
import { Check, ExternalLink, GitBranch, GitPullRequest, RefreshCw, Search, TriangleAlert } from "lucide-react";
import type { GitRemote, GitStatus, Project } from "../../desktop/types";

interface PullRequestsViewProps {
  project?: Project;
}

type PullRequestState = "open" | "closed" | "all";

function githubRepositoryUrl(remoteUrl: string): string | null {
  const value = remoteUrl.trim().replace(/^git\+/, "");
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i.exec(value);
  const https = /^(?:https?|ssh):\/\/(?:git@)?github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i.exec(value);
  const repository = ssh?.[1] ?? https?.[1];
  return repository ? `https://github.com/${repository}` : null;
}

function openUrl(url: string, setError: (value: string | null) => void) {
  void window.maximoDesktop.openPath(url).then((error) => setError(error || null)).catch((error) => setError(error instanceof Error ? error.message : "Unable to open this URL."));
}

export default function PullRequestsView({ project }: PullRequestsViewProps) {
  const [remote, setRemote] = useState<GitRemote | null>(null);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PullRequestState>("open");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!project) return;
    setLoading(true);
    setError(null);
    Promise.all([window.maximoDesktop.gitRemote(project.id), window.maximoDesktop.gitStatus(project.id)]).then(([nextRemote, nextGit]) => { setRemote(nextRemote); setGit(nextGit); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to read the repository.")).finally(() => setLoading(false));
  }, [project?.id]);
  const repositoryUrl = remote ? githubRepositoryUrl(remote.url) : null;
  const pullUrl = repositoryUrl ? `${repositoryUrl}/pulls${state === "closed" ? "?q=is%3Aclosed" : state === "all" ? "?q=is%3Aall" : "?q=is%3Aopen"}` : null;
  const searchUrl = pullUrl && query.trim() ? `${repositoryUrl}/pulls?q=${encodeURIComponent(`${state === "all" ? "" : `is:${state} `}${query.trim()}`)}` : pullUrl;
  return <section className="surface-page pull-requests-surface">
    <header className="surface-page-header"><div className="surface-page-heading"><span className="surface-eyebrow">SOURCE CONTROL</span><h1>Pull requests</h1>{project && <span className="surface-page-subtitle">{project.name}</span>}</div><div className="surface-page-actions">{repositoryUrl && <button type="button" className="surface-secondary-button" onClick={() => openUrl(repositoryUrl, setError)}><ExternalLink size={13} />Repository</button>}<button type="button" className="surface-icon-button" onClick={() => { if (!project) return; setLoading(true); void window.maximoDesktop.gitStatus(project.id).then(setGit).finally(() => setLoading(false)); }} title="Refresh repository"><RefreshCw size={14} className={loading ? "spin" : ""} /></button></div></header>
    <main className="pull-requests-content">
      <div className="pull-request-filters"><div className="pull-request-pills">{(["open", "closed", "all"] as PullRequestState[]).map((value) => <button type="button" aria-pressed={state === value} className={state === value ? "active" : ""} key={value} onClick={() => setState(value)}>{value === "open" ? "Open" : value === "closed" ? "Closed" : "All"}</button>)}</div><label className="pull-request-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pull requests" /></label></div>
      {error && <div className="pull-request-warning"><TriangleAlert size={14} />{error}</div>}
      {!project ? <div className="surface-empty"><GitPullRequest size={25} /><strong>Select a project first</strong><span>Pull requests are scoped to a local project repository.</span></div> : loading && !remote ? <div className="surface-empty"><RefreshCw size={20} className="spin" /><span>Reading repository…</span></div> : !remote ? <div className="pull-request-unavailable"><span className="pull-request-empty-icon"><GitPullRequest size={22} /></span><h2>No repository remote found</h2><p>Add a GitHub origin to {project.name} to view pull requests here.</p><div className="pull-request-command"><GitBranch size={13} /><code>git remote add origin git@github.com:owner/repository.git</code></div></div> : !repositoryUrl ? <div className="pull-request-unavailable"><span className="pull-request-empty-icon"><TriangleAlert size={22} /></span><h2>Pull requests are unavailable for this remote</h2><p>This desktop surface currently supports GitHub remotes. Open the configured remote to continue.</p><button type="button" className="surface-secondary-button" onClick={() => openUrl(remote.url, setError)}><ExternalLink size={13} />Open remote</button></div> : <div className="pull-request-unavailable"><span className="pull-request-empty-icon"><GitPullRequest size={22} /></span><h2>Pull requests are managed on GitHub</h2><p>Maximo Syntax has the local repository bridge, but it does not yet have a GitHub API/CLI adapter for PR lists, reviews, checks, or comments.</p><div className="pull-request-repository-card"><div><strong>{remote.url.replace(/^git@github\.com:/, "github.com/").replace(/\.git$/, "")}</strong><small>{git?.branch ? `Current branch: ${git.branch}` : "GitHub repository"}</small></div><Check size={15} /></div><div className="pull-request-actions"><button type="button" className="surface-primary-button" onClick={() => searchUrl && openUrl(searchUrl, setError)}><ExternalLink size={14} />Open {state === "all" ? "pull requests" : `${state} pull requests`}</button><button type="button" className="surface-secondary-button" onClick={() => openUrl(`${repositoryUrl}/compare`, setError)}><GitBranch size={13} />Compare branch</button></div></div>}
    </main>
  </section>;
}
