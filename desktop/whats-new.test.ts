import { describe, expect, it } from "vitest";
import {
  bulletsToFeatures,
  mergeWhatsNewEntries,
  parseChangelogMarkdown,
  parseGithubReleaseNotes,
  resolveWhatsNewState,
  toWhatsNewSnapshot,
} from "./whats-new";

const sampleChangelog = `# Changelog

## [Unreleased]

- Not shipped yet.

## [0.1.2] - 2026-08-04

- Contained chat markdown so long AI replies no longer expand the conversation.
- Expanded Appearance theme presets with the Synara catalog.

## [0.1.1] - 2026-08-04

- Added desktop notifications.
- Added workspace keyboard shortcuts.

## [0.1.0] - 2026-08-04

- Initial release.
`;

describe("parseChangelogMarkdown", () => {
  it("parses Keep a Changelog sections and skips Unreleased", () => {
    const entries = parseChangelogMarkdown(sampleChangelog);
    expect(entries.map((entry) => entry.version)).toEqual(["0.1.2", "0.1.1", "0.1.0"]);
    expect(entries[0]?.features.length).toBe(2);
    expect(entries[0]?.features[0]?.title).toContain("Contained chat markdown");
    expect(entries[0]?.date).toContain("2026");
  });
});

describe("parseGithubReleaseNotes", () => {
  it("turns GitHub release bodies into feature cards", () => {
    const entry = parseGithubReleaseNotes({
      tag_name: "v0.1.1",
      name: "Maximo Syntax Desktop v0.1.1",
      html_url: "https://github.com/maximoai-co/maximo-syntax-desktop/releases/tag/v0.1.1",
      published_at: "2026-08-04T20:10:27Z",
      body: `## v0.1.1\n\nThis release turns Maximo Syntax into a personal workspace.\n\n### What's new\n\n- **Appearance customization** — independent Light and Dark theme packs.\n- **Desktop notifications** — click-through system alerts.\n`,
    });
    expect(entry?.version).toBe("0.1.1");
    expect(entry?.features[0]?.title).toBe("Appearance customization");
    expect(entry?.features[0]?.description).toContain("theme packs");
    expect(entry?.releaseUrl).toContain("/releases/tag/v0.1.1");
  });
});

describe("mergeWhatsNewEntries", () => {
  it("prefers GitHub features while keeping changelog-only versions", () => {
    const changelog = parseChangelogMarkdown(sampleChangelog);
    const github = [
      parseGithubReleaseNotes({
        tag_name: "v0.1.1",
        body: "- **From GitHub** — released notes win.\n",
        html_url: "https://example.com/r",
        published_at: "2026-08-04T00:00:00Z",
      })!,
    ];
    const merged = mergeWhatsNewEntries(changelog, github);
    const oneOne = merged.find((entry) => entry.version === "0.1.1");
    expect(oneOne?.features[0]?.title).toBe("From GitHub");
    expect(oneOne?.releaseUrl).toBe("https://example.com/r");
    expect(merged.some((entry) => entry.version === "0.1.2")).toBe(true);
  });
});

describe("resolveWhatsNewState", () => {
  const entries = parseChangelogMarkdown(sampleChangelog);

  it("silently bootstraps on first launch", () => {
    expect(resolveWhatsNewState({ entries, currentVersion: "0.1.2", lastSeenVersion: null })).toEqual({
      kind: "silent-bootstrap",
      nextLastSeenVersion: "0.1.2",
    });
  });

  it("shows notes after an upgrade when the current version has features", () => {
    const state = resolveWhatsNewState({ entries, currentVersion: "0.1.2", lastSeenVersion: "0.1.1" });
    expect(state.kind).toBe("show");
    if (state.kind === "show") {
      expect(state.currentEntry.version).toBe("0.1.2");
      expect(state.allEntries[0]?.version).toBe("0.1.2");
    }
  });

  it("noops when already seen", () => {
    expect(resolveWhatsNewState({ entries, currentVersion: "0.1.2", lastSeenVersion: "0.1.2" }).kind).toBe("noop");
  });

  it("silently advances when no notes exist for the installed version", () => {
    const state = resolveWhatsNewState({
      entries: entries.filter((entry) => entry.version !== "0.1.2"),
      currentVersion: "0.1.2",
      lastSeenVersion: "0.1.1",
    });
    expect(state).toEqual({ kind: "silent-bootstrap", nextLastSeenVersion: "0.1.2" });
  });
});

describe("bulletsToFeatures / snapshot", () => {
  it("splits bold titles from descriptions", () => {
    const features = bulletsToFeatures([
      "**Theme presets** — more appearance options.",
      "Plain bullet without separator",
    ], "1.0.0");
    expect(features[0]).toMatchObject({ title: "Theme presets", description: "more appearance options." });
    expect(features[1]?.title).toContain("Plain bullet");
  });

  it("builds a renderer-ready snapshot", () => {
    const snapshot = toWhatsNewSnapshot("0.1.2", "0.1.0", parseChangelogMarkdown(sampleChangelog));
    expect(snapshot.decision).toBe("show");
    expect(snapshot.currentEntry?.version).toBe("0.1.2");
    expect(snapshot.allEntries.length).toBeGreaterThan(1);
  });
});
