import type { GitDiff, GitFile, Project, Thread } from "../../desktop/types.js";
import { normalizeLegacyFullReplacementPatch, patchStats } from "../../desktop/unified-diff.js";

export type GitDiffScope = "working-tree" | "unstaged" | "staged";

export function gitFilesForScope(files: GitFile[], scope: GitDiffScope): GitFile[] {
  if (scope === "working-tree") return files;
  return files.filter((file) => scope === "staged" ? file.staged : (file.unstaged ?? !file.staged)).map((file) => ({
    ...file,
    additions: scope === "staged" ? file.stagedAdditions ?? file.additions : file.unstagedAdditions ?? file.additions,
    deletions: scope === "staged" ? file.stagedDeletions ?? file.deletions : file.unstagedDeletions ?? file.deletions,
  }));
}

export function relativeDiffPath(project: Project, path: string): string {
  const root = project.path.replace(/\\/g, "/").replace(/\/+$/, "");
  const candidate = path.replace(/\\/g, "/");
  return candidate.startsWith(`${root}/`) ? candidate.slice(root.length + 1) : candidate.replace(/^\.\//, "");
}

export function statusForSavedPatch(patch: string): string {
  if (/^@@ -0,0 \+\d+(?:,\d+)? @@/m.test(patch) || /^--- \/dev\/null$/m.test(patch)) return "A";
  if (/^@@ -\d+(?:,\d+)? \+0,0 @@/m.test(patch) || /^\+\+\+ \/dev\/null$/m.test(patch)) return "D";
  return "M";
}

export function savedTurnDiffs(project: Project, thread: Thread | undefined, reviewFile: string | null | undefined, reviewDiff: GitDiff | null): GitDiff[] {
  if (reviewDiff?.source !== "turn" || !reviewFile) return [];
  const owner = reviewDiff.turnId ? thread?.messages.find((message) => message.id === reviewDiff.turnId) : undefined;
  const siblingDiffs = (owner?.fileChanges ?? []).map((change) => ({
    path: relativeDiffPath(project, change.path),
    patch: normalizeLegacyFullReplacementPatch(change.patch, change.path),
    source: "turn" as const,
    ...(reviewDiff.turnId ? { turnId: reviewDiff.turnId } : {}),
  }));
  const selectedPath = relativeDiffPath(project, reviewFile);
  const selected = {
    ...reviewDiff,
    path: selectedPath,
    patch: normalizeLegacyFullReplacementPatch(reviewDiff.patch, selectedPath),
    source: "turn" as const,
  };
  if (siblingDiffs.length === 0) return [selected];
  const selectedIndex = siblingDiffs.findIndex((diff) => diff.path === selectedPath);
  if (selectedIndex >= 0) siblingDiffs[selectedIndex] = selected;
  else siblingDiffs.unshift(selected);
  return siblingDiffs;
}

export function savedTurnFiles(diffs: GitDiff[]): GitFile[] {
  return diffs.map((diff) => ({ path: diff.path, status: statusForSavedPatch(diff.patch), ...patchStats(diff.patch) }));
}
