import type { FileChange } from "./types.js";

// diff v7 ships JavaScript without TypeScript declarations. Keep the small
// surface we use typed locally so both the Electron and renderer builds can
// share the same proven large-file diff implementation.
// @ts-expect-error -- diff@7 has no bundled declaration file.
import { diffArrays } from "diff";

type DiffOperation = { type: "equal" | "added" | "removed"; text: string };
type DiffArrayPart = { added?: boolean; removed?: boolean; value: string[] };

const LEGACY_MATRIX_CELL_LIMIT = 2_000_000;
const MAX_SYNC_DIFF_TIME_MS = 300;

export function splitDiffLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized) return [];
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

function diffOperations(before: string[], after: string[]): DiffOperation[] {
  // Strip the easy shared edges first. Besides reducing work, this makes the
  // common large-file case (a block inserted at the start or end) linear even
  // when the complete snapshots contain thousands of lines.
  let prefixLength = 0;
  while (prefixLength < before.length && prefixLength < after.length && before[prefixLength] === after[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength
    && suffixLength < after.length - prefixLength
    && before[before.length - suffixLength - 1] === after[after.length - suffixLength - 1]
  ) suffixLength += 1;

  const beforeMiddle = before.slice(prefixLength, before.length - suffixLength);
  const afterMiddle = after.slice(prefixLength, after.length - suffixLength);
  const parts = diffArrays(beforeMiddle, afterMiddle, { timeout: MAX_SYNC_DIFF_TIME_MS }) as DiffArrayPart[] | undefined;
  // A pathological rewrite should not freeze Electron's main process. If the
  // bounded Myers pass times out, the remaining unmatched middle really is the
  // only region we cannot align; shared prefix/suffix lines remain preserved.
  const middle = (parts ?? [
    ...(beforeMiddle.length ? [{ removed: true, value: beforeMiddle }] : []),
    ...(afterMiddle.length ? [{ added: true, value: afterMiddle }] : []),
  ]).flatMap((part) => {
    const type: DiffOperation["type"] = part.added ? "added" : part.removed ? "removed" : "equal";
    return part.value.map((text) => ({ type, text }));
  });
  return [
    ...before.slice(0, prefixLength).map((text) => ({ type: "equal" as const, text })),
    ...middle,
    ...(suffixLength ? before.slice(before.length - suffixLength).map((text) => ({ type: "equal" as const, text })) : []),
  ];
}

function diffRangeStart(start: number, count: number): string {
  if (count === 0) return `${Math.max(0, start - 1)},0`;
  return count === 1 ? String(start) : `${start},${count}`;
}

/**
 * Build a focused unified patch for a complete before/after text snapshot.
 *
 * This deliberately uses a Myers-style array diff instead of the desktop's
 * former O(n*m) matrix. The old safety fallback represented a small edit to a
 * large file as deletion and recreation of the entire file, which produced
 * false totals such as +5175/-5101 in task history.
 */
export function buildUnifiedPatch(path: string, beforeContent: string, afterContent: string): FileChange {
  const operations = diffOperations(splitDiffLines(beforeContent), splitDiffLines(afterContent));
  const changedIndexes = operations.flatMap((operation, index) => operation.type === "equal" ? [] : [index]);
  if (changedIndexes.length === 0) return { path, patch: "", additions: 0, deletions: 0 };

  const context = 4;
  const hunks: Array<{ start: number; end: number }> = [];
  for (const changedIndex of changedIndexes) {
    const nextStart = Math.max(0, changedIndex - context);
    const nextEnd = Math.min(operations.length, changedIndex + context + 1);
    const previous = hunks.at(-1);
    if (previous && nextStart <= previous.end + context) previous.end = Math.max(previous.end, nextEnd);
    else hunks.push({ start: nextStart, end: nextEnd });
  }

  let oldLine = 1;
  let newLine = 1;
  const oldLineAt: number[] = [];
  const newLineAt: number[] = [];
  for (let index = 0; index <= operations.length; index += 1) {
    oldLineAt[index] = oldLine;
    newLineAt[index] = newLine;
    const operation = operations[index];
    if (!operation) continue;
    if (operation.type !== "added") oldLine += 1;
    if (operation.type !== "removed") newLine += 1;
  }

  const patchLines = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    let oldCount = 0;
    let newCount = 0;
    for (const operation of operations.slice(hunk.start, hunk.end)) {
      if (operation.type !== "added") oldCount += 1;
      if (operation.type !== "removed") newCount += 1;
    }
    patchLines.push(`@@ -${diffRangeStart(oldLineAt[hunk.start]!, oldCount)} +${diffRangeStart(newLineAt[hunk.start]!, newCount)} @@`);
    for (const operation of operations.slice(hunk.start, hunk.end)) {
      patchLines.push(`${operation.type === "added" ? "+" : operation.type === "removed" ? "-" : " "}${operation.text}`);
    }
  }
  return {
    path,
    patch: `${patchLines.join("\n")}\n`,
    additions: operations.filter((operation) => operation.type === "added").length,
    deletions: operations.filter((operation) => operation.type === "removed").length,
  };
}

export function patchStats(patch: string): { additions: number; deletions: number } {
  return patch.split(/\r?\n/).reduce((stats, line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) stats.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) stats.deletions += 1;
    return stats;
  }, { additions: 0, deletions: 0 });
}

function rangeCount(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const [, count] = token.split(",");
  const parsed = Number(count ?? "1");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function patchPath(patch: string, fallback: string): string {
  const match = /^diff --git a\/(.+) b\/(.+)$/m.exec(patch);
  return match?.[2] || fallback;
}

/**
 * Repairs patches persisted by older desktop releases when their large-file
 * fallback encoded every old line as removed followed by every new line as
 * added. The patch contains both complete snapshots, so it can be losslessly
 * rebuilt for display without consulting the current Git working tree.
 */
export function normalizeLegacyFullReplacementPatch(patch: string, path = "changed-file"): string {
  if (!patch.trim()) return patch;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const hunkIndexes = lines.flatMap((line, index) => line.startsWith("@@ ") ? [index] : []);
  if (hunkIndexes.length !== 1) return patch;
  const hunkIndex = hunkIndexes[0]!;
  const range = /^@@ -(\d+(?:,\d+)?) \+(\d+(?:,\d+)?) @@/.exec(lines[hunkIndex]!);
  const oldCount = rangeCount(range?.[1]);
  const newCount = rangeCount(range?.[2]);
  if (oldCount === undefined || newCount === undefined || oldCount * newCount <= LEGACY_MATRIX_CELL_LIMIT) return patch;

  const removed: string[] = [];
  const added: string[] = [];
  let adding = false;
  for (const line of lines.slice(hunkIndex + 1)) {
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("-") && !adding) {
      removed.push(line.slice(1));
      continue;
    }
    if (line.startsWith("+")) {
      adding = true;
      added.push(line.slice(1));
      continue;
    }
    return patch;
  }
  if (removed.length !== oldCount || added.length !== newCount) return patch;

  const rebuilt = buildUnifiedPatch(
    patchPath(patch, path),
    removed.length ? `${removed.join("\n")}\n` : "",
    added.length ? `${added.join("\n")}\n` : "",
  ).patch;
  return rebuilt.length < patch.length ? rebuilt : patch;
}

export function normalizeFileChange(change: FileChange): FileChange {
  const patch = normalizeLegacyFullReplacementPatch(change.patch, change.path);
  if (patch === change.patch) return change;
  return { ...change, patch, ...patchStats(patch) };
}
