import { describe, expect, it, vi } from "vitest";
import {
  AppUpdater,
  compareVersions,
  createInitialAppUpdateState,
  getAppUpdateButtonLabel,
  getAppUpdateButtonTooltip,
  isUpdateVersionNewer,
  normalizeVersion,
  parseGithubRelease,
  pickReleaseAsset,
  resolveUpdateStateFromRelease,
  shouldShowAppUpdateButton,
  type GithubRelease,
} from "./app-updater";

const sampleRelease = (overrides: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: "v0.2.0",
  name: "Maximo Syntax Desktop v0.2.0",
  html_url: "https://github.com/maximoai-co/maximo-syntax-desktop/releases/tag/v0.2.0",
  prerelease: false,
  draft: false,
  assets: [
    {
      name: "Maximo-Syntax-0.2.0-mac-arm64.zip",
      browser_download_url: "https://github.com/maximoai-co/maximo-syntax-desktop/releases/download/v0.2.0/Maximo-Syntax-0.2.0-mac-arm64.zip",
    },
    {
      name: "Maximo-Syntax-0.2.0-mac-arm64.dmg",
      browser_download_url: "https://github.com/maximoai-co/maximo-syntax-desktop/releases/download/v0.2.0/Maximo-Syntax-0.2.0-mac-arm64.dmg",
    },
    {
      name: "Maximo-Syntax-0.2.0-mac-x64.zip",
      browser_download_url: "https://github.com/maximoai-co/maximo-syntax-desktop/releases/download/v0.2.0/Maximo-Syntax-0.2.0-mac-x64.zip",
    },
    {
      name: "Maximo-Syntax-0.2.0-win-x64.exe",
      browser_download_url: "https://github.com/maximoai-co/maximo-syntax-desktop/releases/download/v0.2.0/Maximo-Syntax-0.2.0-win-x64.exe",
    },
  ],
  ...overrides,
});

describe("normalizeVersion / compareVersions", () => {
  it("strips leading v and compares dotted segments", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
    expect(compareVersions("1.2.0", "1.2.1")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.2", "0.1.2")).toBe(0);
  });

  it("treats stable releases as newer than prerelease labels of the same triple", () => {
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBeGreaterThan(0);
    expect(isUpdateVersionNewer("1.0.0-beta", "1.0.0")).toBe(true);
    expect(isUpdateVersionNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isUpdateVersionNewer("0.1.2", "0.1.1")).toBe(false);
    expect(isUpdateVersionNewer("0.1.1", "0.1.2")).toBe(true);
  });
});

describe("pickReleaseAsset", () => {
  it("prefers mac zip for the host architecture", () => {
    const asset = pickReleaseAsset(sampleRelease().assets!, "darwin", "arm64");
    expect(asset?.name).toBe("Maximo-Syntax-0.2.0-mac-arm64.zip");
  });

  it("selects Windows and Linux installers", () => {
    expect(pickReleaseAsset(sampleRelease().assets!, "win32", "x64")?.name).toContain("win-x64.exe");
    expect(pickReleaseAsset([
      { name: "Maximo-Syntax-0.2.0-linux-x64.AppImage", browser_download_url: "https://example.com/appimage" },
      { name: "Maximo-Syntax-0.2.0-linux-x64.deb", browser_download_url: "https://example.com/deb" },
    ], "linux", "x64")?.name).toContain("AppImage");
  });
});

describe("resolveUpdateStateFromRelease", () => {
  it("marks newer releases available with a platform download url", () => {
    const state = resolveUpdateStateFromRelease("0.1.2", sampleRelease(), {
      platform: "darwin",
      arch: "arm64",
      checkedAt: "2026-08-04T00:00:00.000Z",
    });
    expect(state.status).toBe("available");
    expect(state.availableVersion).toBe("0.2.0");
    expect(state.downloadUrl).toContain("mac-arm64.zip");
    expect(shouldShowAppUpdateButton(state)).toBe(true);
    expect(getAppUpdateButtonLabel(state)).toBe("Update");
    expect(getAppUpdateButtonTooltip(state)).toContain("0.2.0");
  });

  it("marks equal or older releases as up to date", () => {
    const state = resolveUpdateStateFromRelease("0.2.0", sampleRelease(), {
      platform: "darwin",
      arch: "arm64",
    });
    expect(state.status).toBe("up-to-date");
    expect(shouldShowAppUpdateButton(state)).toBe(false);
  });

  it("keeps release page url when assets are missing", () => {
    const state = resolveUpdateStateFromRelease("0.1.0", sampleRelease({ assets: [] }), {
      platform: "darwin",
      arch: "arm64",
    });
    expect(state.status).toBe("available");
    expect(state.downloadUrl).toBeNull();
    expect(state.releaseUrl).toContain("/releases/tag/v0.2.0");
    expect(shouldShowAppUpdateButton(state)).toBe(true);
  });
});

describe("parseGithubRelease", () => {
  it("rejects malformed payloads and accepts valid releases", () => {
    expect(parseGithubRelease(null)).toBeNull();
    expect(parseGithubRelease({ tag_name: "v1" })).toBeNull();
    const parsed = parseGithubRelease(sampleRelease());
    expect(parsed?.tag_name).toBe("v0.2.0");
    expect(parsed?.assets?.length).toBe(4);
  });
});

describe("AppUpdater", () => {
  it("checks GitHub, exposes available state, and opens the download url", async () => {
    const openExternal = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(sampleRelease()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const updater = new AppUpdater({
      currentVersion: "0.1.2",
      platform: "darwin",
      arch: "arm64",
      fetchImpl,
      openExternal,
      enableBackgroundChecks: false,
    });

    expect(createInitialAppUpdateState("0.1.2").status).toBe("idle");
    const checked = await updater.checkForUpdates("test");
    expect(checked.status).toBe("available");
    expect(checked.availableVersion).toBe("0.2.0");

    const opened = await updater.openDownload();
    expect(opened.opened).toBe(true);
    expect(openExternal).toHaveBeenCalledWith(checked.downloadUrl);
  });

  it("reports up-to-date when already on the latest tag", async () => {
    const updater = new AppUpdater({
      currentVersion: "0.2.0",
      platform: "darwin",
      arch: "arm64",
      fetchImpl: async () => new Response(JSON.stringify(sampleRelease()), { status: 200 }),
      openExternal: async () => undefined,
      enableBackgroundChecks: false,
    });

    const state = await updater.checkForUpdates("test");
    expect(state.status).toBe("up-to-date");
    expect(shouldShowAppUpdateButton(state)).toBe(false);
  });

  it("surfaces GitHub HTTP failures without throwing", async () => {
    const updater = new AppUpdater({
      currentVersion: "0.1.2",
      fetchImpl: async () => new Response("nope", { status: 500 }),
      openExternal: async () => undefined,
      enableBackgroundChecks: false,
    });

    const state = await updater.checkForUpdates("test");
    expect(state.status).toBe("error");
    expect(state.message).toContain("HTTP 500");
    expect(shouldShowAppUpdateButton(state)).toBe(false);
  });
});
