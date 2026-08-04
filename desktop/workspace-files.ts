import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import type { WorkspaceFileContent, WorkspaceFileEntry, WorkspaceFileKind } from "./types.js";

const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_ENTRIES = 1_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 12 * 1024 * 1024;
const MAX_SEARCH_DEPTH = 10;

const ignoredDirectoryNames = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".turbo",
  ".pnpm-store",
  ".yarn",
  "node_modules",
  "dist",
  "build",
  ".next",
  "target",
  "coverage",
  "release",
]);

interface ScoredWorkspaceFileEntry {
  entry: WorkspaceFileEntry;
  score: number;
}

const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".css": "text/css",
  ".csv": "text/csv",
  ".env": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".ini": "text/plain",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".json": "application/json",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".mjs": "text/javascript",
  ".py": "text/x-python",
  ".rs": "text/x-rust",
  ".scss": "text/css",
  ".sh": "text/x-shellscript",
  ".sql": "application/sql",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".toml": "text/plain",
  ".txt": "text/plain",
  ".vue": "text/html",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".zsh": "text/x-shellscript",
};

function isWithinPath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !path.includes(`..${sep}`) && !resolve(path).startsWith(".."));
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").replace(/(?:^|\/)\.\//g, "");
}

async function workspaceRoot(root: string): Promise<string> {
  return realpath(resolve(root));
}

async function resolveWorkspacePath(root: string, requestedPath: string): Promise<{ root: string; absolute: string; relativePath: string }> {
  const resolvedRoot = await workspaceRoot(root);
  const relativePath = normalizeRelativePath(requestedPath);
  const absolute = resolve(resolvedRoot, relativePath || ".");
  if (!isWithinPath(resolvedRoot, absolute)) throw new Error("That path is outside the project.");
  const target = await realpath(absolute).catch(() => absolute);
  if (!isWithinPath(resolvedRoot, target)) throw new Error("That path is outside the project.");
  return { root: resolvedRoot, absolute: target, relativePath: relative(resolvedRoot, target).split(sep).join("/") };
}

function entrySort(left: WorkspaceFileEntry, right: WorkspaceFileEntry): number {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

async function directoryEntries(root: string, directory: string): Promise<WorkspaceFileEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: WorkspaceFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const absolute = resolve(directory, entry.name);
    const relativePath = relative(root, absolute).split(sep).join("/");
    if (!isWithinPath(root, absolute)) continue;
    const details = await stat(absolute).catch(() => null);
    if (!details) continue;
    result.push({
      name: entry.name,
      path: relativePath,
      kind: entry.isDirectory() ? "directory" : "file",
      ...(entry.isFile() ? { size: details.size } : {}),
      modifiedAt: details.mtimeMs,
    });
    if (result.length >= MAX_LIST_ENTRIES) break;
  }
  return result.sort(entrySort);
}

function subsequenceScore(value: string, query: string): number | null {
  let queryIndex = 0;
  let firstMatch = -1;
  let previousMatch = -1;
  let gapPenalty = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue;
    if (firstMatch < 0) firstMatch = index;
    if (previousMatch >= 0) gapPenalty += index - previousMatch - 1;
    previousMatch = index;
    queryIndex += 1;
    if (queryIndex === query.length) {
      return 100 + firstMatch * 2 + gapPenalty * 3 + (index - firstMatch + 1 - query.length);
    }
  }
  return null;
}

function searchPathScore(path: string, query: string): number | null {
  const normalizedPath = path.toLowerCase();
  const name = normalizedPath.split("/").at(-1) ?? normalizedPath;
  if (name === query) return 0;
  if (normalizedPath === query) return 1;
  if (name.startsWith(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  if (normalizedPath.includes(`/${query}`)) return 4;
  if (name.includes(query)) return 5;
  if (normalizedPath.includes(query)) return 6;
  const nameFuzzy = subsequenceScore(name, query);
  if (nameFuzzy !== null) return nameFuzzy;
  const pathFuzzy = subsequenceScore(normalizedPath, query);
  return pathFuzzy === null ? null : 200 + pathFuzzy;
}

async function searchFiles(root: string, directory: string, query: string, depth: number, result: ScoredWorkspaceFileEntry[]): Promise<void> {
  if (depth > MAX_SEARCH_DEPTH || result.length >= MAX_SEARCH_ENTRIES) return;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (result.length >= MAX_SEARCH_ENTRIES) return;
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const absolute = resolve(directory, entry.name);
    if (!isWithinPath(root, absolute)) continue;
    const relativePath = relative(root, absolute).split(sep).join("/");
    if (entry.isFile()) {
      const score = searchPathScore(relativePath, query);
      if (score === null) continue;
      const details = await stat(absolute).catch(() => null);
      if (!details) continue;
      result.push({
        score,
        entry: { name: entry.name, path: relativePath, kind: "file", size: details.size, modifiedAt: details.mtimeMs },
      });
    } else {
      await searchFiles(root, absolute, query, depth + 1, result);
    }
  }
}

export async function listWorkspaceFiles(root: string, requestedPath = "", query = ""): Promise<WorkspaceFileEntry[]> {
  const resolved = await resolveWorkspacePath(root, requestedPath);
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return directoryEntries(resolved.root, resolved.absolute);
  const result: ScoredWorkspaceFileEntry[] = [];
  await searchFiles(resolved.root, resolved.absolute, normalizedQuery, 0, result);
  return result
    .sort((left, right) => left.score - right.score || left.entry.path.localeCompare(right.entry.path))
    .slice(0, MAX_SEARCH_ENTRIES)
    .map((candidate) => candidate.entry);
}

function mimeTypeFor(path: string): string {
  return mimeTypes[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function kindFor(mimeType: string): WorkspaceFileKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml" || mimeType === "application/sql") return "text";
  return "unsupported";
}

export async function readWorkspaceFile(root: string, requestedPath: string): Promise<WorkspaceFileContent> {
  const resolved = await resolveWorkspacePath(root, requestedPath);
  const details = await stat(resolved.absolute);
  if (!details.isFile()) throw new Error("That workspace entry is not a file.");
  const mimeType = mimeTypeFor(resolved.absolute);
  const kind = kindFor(mimeType);
  const name = basename(resolved.absolute);
  const base: WorkspaceFileContent = { name, path: resolved.relativePath, kind, mimeType, size: details.size, modifiedAt: details.mtimeMs };
  if (kind === "unsupported") return { ...base, reason: "This file type is not available in the built-in preview." };
  const limit = kind === "text" ? MAX_TEXT_BYTES : MAX_BINARY_BYTES;
  if (details.size > limit) return { ...base, reason: `This file is too large for an inline preview (${Math.round(limit / (1024 * 1024))} MB limit).` };
  const bytes = await readFile(resolved.absolute);
  if (kind === "text") {
    if (bytes.includes(0)) return { ...base, kind: "unsupported", reason: "Binary files are not shown as text." };
    return { ...base, content: bytes.toString("utf8"), ...(bytes.length > MAX_TEXT_BYTES ? { truncated: true } : {}) };
  }
  return { ...base, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
}

export async function writeWorkspaceFile(root: string, requestedPath: string, content: string, expectedModifiedAt?: number): Promise<WorkspaceFileContent> {
  const resolved = await resolveWorkspacePath(root, requestedPath);
  const details = await stat(resolved.absolute);
  if (!details.isFile()) throw new Error("That workspace entry is not a file.");
  if (expectedModifiedAt !== undefined && details.mtimeMs !== expectedModifiedAt) {
    throw new Error("The file changed outside Maximo Syntax. Reload it before saving.");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) throw new Error("Files larger than 2 MB cannot be saved in the built-in editor.");
  await writeFile(resolved.absolute, content, { encoding: "utf8" });
  return readWorkspaceFile(root, resolved.relativePath);
}
