import { useMemo, useState } from "react";
import { ArrowLeft, Check, Clipboard, Code2, FileCode2, RefreshCw, X } from "lucide-react";
import type { GitDiff, Project } from "../../desktop/types";
import { normalizeLegacyFullReplacementPatch, patchStats as rawPatchStats } from "../../desktop/unified-diff";
import { highlightCode } from "./MarkdownCodeBlock";

interface DiffLine { text: string; kind: "context" | "added" | "removed" | "meta" | "hunk"; oldNumber?: number; newNumber?: number; }

function parsePatch(patch: string): DiffLine[] {
  let oldNumber = 0;
  let newNumber = 0;
  return patch.split(/\r?\n/).filter((line, index, lines) => !(index === lines.length - 1 && line === "")).map((text) => {
    if (text.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (match) { oldNumber = Number(match[1]); newNumber = Number(match[2]); }
      return { text, kind: "hunk" };
    }
    if (text.startsWith("+++") || text.startsWith("---") || text.startsWith("diff ") || text.startsWith("index ")) return { text, kind: "meta" };
    if (text.startsWith("+")) return { text: text.slice(1), kind: "added", newNumber: newNumber++ };
    if (text.startsWith("-")) return { text: text.slice(1), kind: "removed", oldNumber: oldNumber++ };
    const line = text.startsWith(" ") ? text.slice(1) : text;
    return { text: line, kind: "context", oldNumber: oldNumber++, newNumber: newNumber++ };
  });
}

export function patchStats(patch: string): { additions: number; deletions: number } {
  return rawPatchStats(normalizeLegacyFullReplacementPatch(patch));
}

export function reviewPatch(patch: string, path?: string): string {
  return normalizeLegacyFullReplacementPatch(patch, path);
}

export function diffLanguageForPath(path?: string): string | undefined {
  const extension = path?.split(/[./\\]/).at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    c: "c",
    cc: "cpp",
    cpp: "cpp",
    cjs: "javascript",
    css: "css",
    dockerfile: "dockerfile",
    env: "ini",
    go: "go",
    gql: "graphql",
    graphql: "graphql",
    h: "c",
    hpp: "cpp",
    html: "xml",
    java: "java",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    kt: "kotlin",
    kotlin: "kotlin",
    md: "markdown",
    mjs: "javascript",
    php: "php",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    swift: "swift",
    ts: "typescript",
    tsx: "typescript",
    toml: "ini",
    vue: "xml",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return extension ? languages[extension] : undefined;
}

export function DiffCode({ patch, className, showMetadata = true, showHunks = true, language }: { patch: string; className?: string; showMetadata?: boolean; showHunks?: boolean; language?: string }) {
  const normalizedPatch = useMemo(() => reviewPatch(patch), [patch]);
  const lines = useMemo(() => parsePatch(normalizedPatch), [normalizedPatch]);
  const visibleLines = lines.filter((line) => (showMetadata || line.kind !== "meta") && (showHunks || line.kind !== "hunk"));
  return <pre className={["diff-code", className].filter(Boolean).join(" ")}>{visibleLines.map((line, index) => {
    const highlighted = line.kind === "added" || line.kind === "removed" || line.kind === "context" ? highlightCode(line.text || " ", language) : null;
    return <code className={`diff-line ${line.kind}`} key={`${index}-${line.text}`}><span className="diff-number">{line.oldNumber ?? ""}</span><span className="diff-number">{line.newNumber ?? ""}</span><span className="diff-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : line.kind === "hunk" ? "" : " "}</span>{highlighted ? <span className="diff-text" dangerouslySetInnerHTML={{ __html: highlighted.html }} /> : <span className="diff-text">{line.text || " "}</span>}</code>;
  })}</pre>;
}

export default function DiffReview({ project, diff, onBack, onOpenEditor }: { project: Project; diff: GitDiff | null; onBack: () => void; onOpenEditor: () => void }) {
  const [copied, setCopied] = useState(false);
  const normalizedPatch = useMemo(() => reviewPatch(diff?.patch ?? "", diff?.path), [diff?.patch, diff?.path]);
  const stats = useMemo(() => rawPatchStats(normalizedPatch), [normalizedPatch]);
  const copy = async () => {
    if (!normalizedPatch) return;
    await navigator.clipboard.writeText(normalizedPatch);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return <div className="review-stage">
     <header className="review-header"><button type="button" className="review-back" onPointerDown={(event) => event.stopPropagation()} onClick={onBack} title="Back to chat" aria-label="Back to chat"><ArrowLeft size={15} /><span className="review-back-label">Back to chat</span></button><div className="review-title"><span className="eyebrow">REVIEW</span><strong>{diff?.path ?? "Loading diff…"}</strong><small>{project.name}</small></div><div className="review-actions"><button type="button" onClick={() => void copy()} disabled={!normalizedPatch} title={copied ? "Copied" : "Copy patch"}>{copied ? <Check size={14} /> : <Clipboard size={14} />}<span className="review-action-label">{copied ? "Copied" : "Copy patch"}</span></button><button type="button" onClick={onOpenEditor} disabled={!diff} title="Open in editor"><Code2 size={14} /><span className="review-action-label">Open in editor</span></button></div></header>
    <div className="review-summary"><span><FileCode2 size={15} />{diff?.path ?? "Reading changed file"}</span><span className="diff-count"><b>+{stats.additions}</b><i>-{stats.deletions}</i></span><button type="button" onClick={onBack} title="Close review" aria-label="Close review"><X size={13} /></button></div>
     <section className="diff-surface" aria-label="Code diff">
       {!diff ? <div className="diff-empty"><RefreshCw size={18} className="spin" />Reading file diff…</div> : !normalizedPatch.trim() ? <div className="diff-empty"><FileCode2 size={18} />No textual diff is available for this file.</div> : <DiffCode patch={normalizedPatch} language={diffLanguageForPath(diff.path)} showMetadata={false} />}
    </section>
  </div>;
}
