// What's New post-update surface for Maximo Syntax Desktop.
// Mirrors Synara's rules: silent first launch, popout after upgrade when notes
// exist, dismiss persists last-seen version. Notes come from GitHub Releases
// (preferred) and the local CHANGELOG.md (offline fallback / unreleased tags).

import { normalizeVersion, compareVersions as compareAppVersions } from "./app-updater.js";

export interface WhatsNewFeature {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface WhatsNewEntry {
  readonly version: string;
  readonly date: string;
  readonly title: string | null;
  readonly summary: string | null;
  readonly releaseUrl: string | null;
  readonly features: readonly WhatsNewFeature[];
}

export interface WhatsNewInputs {
  readonly entries: readonly WhatsNewEntry[];
  readonly currentVersion: string;
  readonly lastSeenVersion: string | null;
}

export type WhatsNewDecision =
  | {
      readonly kind: "show";
      readonly currentEntry: WhatsNewEntry;
      readonly allEntries: readonly WhatsNewEntry[];
      readonly nextLastSeenVersion: string;
    }
  | {
      readonly kind: "silent-bootstrap";
      readonly nextLastSeenVersion: string;
    }
  | { readonly kind: "noop" };

export interface WhatsNewSnapshot {
  readonly currentVersion: string;
  readonly lastSeenVersion: string | null;
  readonly decision: WhatsNewDecision["kind"];
  readonly currentEntry: WhatsNewEntry | null;
  readonly allEntries: readonly WhatsNewEntry[];
  readonly nextLastSeenVersion: string | null;
}

export function compareVersions(left: string, right: string): number {
  return compareAppVersions(left, right);
}

export function sortEntriesByVersionDesc(entries: readonly WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries].sort((left, right) => compareVersions(right.version, left.version));
}

/**
 * Decide whether to show the post-update popout/dialog.
 * Same rules as Synara's resolveWhatsNewState.
 */
export function resolveWhatsNewState(inputs: WhatsNewInputs): WhatsNewDecision {
  const currentVersion = normalizeVersion(inputs.currentVersion);
  const lastSeenVersion = inputs.lastSeenVersion === null ? null : normalizeVersion(inputs.lastSeenVersion);
  const entries = sortEntriesByVersionDesc(inputs.entries);

  if (lastSeenVersion === null) {
    return { kind: "silent-bootstrap", nextLastSeenVersion: currentVersion };
  }

  if (compareVersions(currentVersion, lastSeenVersion) <= 0) {
    return { kind: "noop" };
  }

  const currentEntry = entries.find((entry) => compareVersions(entry.version, currentVersion) === 0) ?? null;
  if (!currentEntry || currentEntry.features.length === 0) {
    return { kind: "silent-bootstrap", nextLastSeenVersion: currentVersion };
  }

  return {
    kind: "show",
    currentEntry,
    allEntries: entries,
    nextLastSeenVersion: currentVersion,
  };
}

export function toWhatsNewSnapshot(
  currentVersion: string,
  lastSeenVersion: string | null,
  entries: readonly WhatsNewEntry[],
): WhatsNewSnapshot {
  const decision = resolveWhatsNewState({ currentVersion, lastSeenVersion, entries });
  if (decision.kind === "show") {
    return {
      currentVersion: normalizeVersion(currentVersion),
      lastSeenVersion,
      decision: "show",
      currentEntry: decision.currentEntry,
      allEntries: decision.allEntries,
      nextLastSeenVersion: decision.nextLastSeenVersion,
    };
  }
  if (decision.kind === "silent-bootstrap") {
    return {
      currentVersion: normalizeVersion(currentVersion),
      lastSeenVersion,
      decision: "silent-bootstrap",
      currentEntry: null,
      allEntries: sortEntriesByVersionDesc(entries),
      nextLastSeenVersion: decision.nextLastSeenVersion,
    };
  }
  return {
    currentVersion: normalizeVersion(currentVersion),
    lastSeenVersion,
    decision: "noop",
    currentEntry: null,
    allEntries: sortEntriesByVersionDesc(entries),
    nextLastSeenVersion: null,
  };
}

/** Parse Keep-a-Changelog style sections into What's New entries. */
export function parseChangelogMarkdown(markdown: string): WhatsNewEntry[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries: WhatsNewEntry[] = [];
  let current: { version: string; date: string; bullets: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const features = bulletsToFeatures(current.bullets, current.version);
    if (features.length > 0) {
      entries.push({
        version: current.version,
        date: current.date,
        title: null,
        summary: null,
        releaseUrl: null,
        features,
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const heading = rawLine.match(/^##\s+\[([^\]]+)\](?:\s*-\s*(.+))?\s*$/u);
    if (heading) {
      flush();
      const label = heading[1].trim();
      if (/^unreleased$/iu.test(label)) {
        current = null;
        continue;
      }
      current = {
        version: normalizeVersion(label),
        date: formatReleaseDate(heading[2]?.trim() ?? ""),
        bullets: [],
      };
      continue;
    }
    if (!current) continue;
    const bullet = rawLine.match(/^\s*[-*+]\s+(.+)\s*$/u);
    if (bullet) current.bullets.push(bullet[1].trim());
  }
  flush();
  return sortEntriesByVersionDesc(entries);
}

export interface GithubReleaseNotes {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  html_url?: string | null;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

/** Convert a GitHub release payload into a What's New entry. */
export function parseGithubReleaseNotes(release: GithubReleaseNotes): WhatsNewEntry | null {
  if (release.draft || release.prerelease) return null;
  if (typeof release.tag_name !== "string" || !release.tag_name.trim()) return null;
  const version = normalizeVersion(release.tag_name);
  const body = typeof release.body === "string" ? release.body : "";
  const features = bulletsToFeatures(extractMarkdownBullets(body), version);
  if (features.length === 0 && !body.trim()) return null;

  // If there are no bullets, use the first non-heading paragraph as a single feature.
  const resolvedFeatures = features.length > 0
    ? features
    : [{
        id: `${version}-summary`,
        title: typeof release.name === "string" && release.name.trim() ? release.name.trim() : `Version ${version}`,
        description: firstParagraph(body) || `Maximo Syntax ${version} is now installed.`,
      }];

  return {
    version,
    date: formatReleaseDate(release.published_at ? release.published_at.slice(0, 10) : ""),
    title: typeof release.name === "string" && release.name.trim() ? release.name.trim() : null,
    summary: firstParagraph(body),
    releaseUrl: typeof release.html_url === "string" ? release.html_url : null,
    features: resolvedFeatures,
  };
}

/**
 * Merge CHANGELOG + GitHub releases by version.
 * GitHub notes win for title/summary/url and replace features when present.
 */
export function mergeWhatsNewEntries(
  changelogEntries: readonly WhatsNewEntry[],
  githubEntries: readonly WhatsNewEntry[],
): WhatsNewEntry[] {
  const byVersion = new Map<string, WhatsNewEntry>();
  for (const entry of changelogEntries) {
    byVersion.set(normalizeVersion(entry.version), entry);
  }
  for (const entry of githubEntries) {
    const version = normalizeVersion(entry.version);
    const existing = byVersion.get(version);
    if (!existing) {
      byVersion.set(version, entry);
      continue;
    }
    byVersion.set(version, {
      version,
      date: entry.date || existing.date,
      title: entry.title ?? existing.title,
      summary: entry.summary ?? existing.summary,
      releaseUrl: entry.releaseUrl ?? existing.releaseUrl,
      features: entry.features.length > 0 ? entry.features : existing.features,
    });
  }
  return sortEntriesByVersionDesc([...byVersion.values()]);
}

export function extractMarkdownBullets(markdown: string): string[] {
  const bullets: string[] = [];
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const match = rawLine.match(/^\s*[-*+]\s+(.+)\s*$/u);
    if (match) bullets.push(match[1].trim());
  }
  return bullets;
}

export function bulletsToFeatures(bullets: readonly string[], version: string): WhatsNewFeature[] {
  return bullets
    .map((bullet, index) => splitBullet(bullet, `${version}-${index + 1}`))
    .filter((feature): feature is WhatsNewFeature => feature !== null)
    .slice(0, 40);
}

function splitBullet(bullet: string, id: string): WhatsNewFeature | null {
  const cleaned = stripMarkdownInline(bullet).replace(/\s+/gu, " ").trim();
  if (!cleaned) return null;

  // Patterns: **Title** — description | Title — description | Title: description
  const bold = cleaned.match(/^\*\*(.+?)\*\*\s*[—–\-:]\s*(.+)$/u)
    ?? cleaned.match(/^(.+?)\s+[—–]\s+(.+)$/u)
    ?? cleaned.match(/^([^:]{3,80}):\s+(.+)$/u);

  if (bold) {
    return {
      id,
      title: stripMarkdownInline(bold[1]).trim().slice(0, 120),
      description: stripMarkdownInline(bold[2]).trim().slice(0, 600),
    };
  }

  // Use first sentence-ish chunk as title when long.
  if (cleaned.length > 90) {
    const breakAt = cleaned.search(/[.!?]\s/u);
    if (breakAt > 20 && breakAt < 100) {
      return {
        id,
        title: cleaned.slice(0, breakAt + 1).trim(),
        description: cleaned.slice(breakAt + 1).trim(),
      };
    }
  }

  return {
    id,
    title: cleaned.slice(0, 100),
    description: cleaned.length > 100 ? cleaned : cleaned,
  };
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/gu, "$1")
    .replace(/__(.+?)__/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim();
}

function firstParagraph(markdown: string): string | null {
  const blocks = markdown.replace(/\r\n/g, "\n").split(/\n{2,}/u);
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^#{1,6}\s/u.test(line) && !/^[-*+]\s/u.test(line) && !/^---+$/u.test(line));
    if (lines.length === 0) continue;
    const text = stripMarkdownInline(lines.join(" "));
    if (text) return text.slice(0, 400);
  }
  return null;
}

function formatReleaseDate(value: string): string {
  if (!value) return "";
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!iso) return value;
  const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const GITHUB_RELEASES_LIST_API =
  "https://api.github.com/repos/maximoai-co/maximo-syntax-desktop/releases?per_page=20";

export type WhatsNewFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchGithubReleaseEntries(
  fetchImpl: WhatsNewFetch = fetch,
  currentVersion = "0.0.0",
): Promise<WhatsNewEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  timeout.unref?.();
  try {
    const response = await fetchImpl(GITHUB_RELEASES_LIST_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Maximo-Syntax-Desktop/${normalizeVersion(currentVersion)}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) return [];
    return payload
      .map((item) => parseGithubReleaseNotes(item as GithubReleaseNotes))
      .filter((entry): entry is WhatsNewEntry => entry !== null);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
