// GitHub Releases update checker for Maximo Syntax Desktop.
// Inspired by Synara's sidebar update button flow: poll for a newer release,
// surface a compact footer action only when an update is available, and open
// the matching installer download (or release page) on click.

export const GITHUB_UPDATE_OWNER = "maximoai-co";
export const GITHUB_UPDATE_REPO = "maximo-syntax-desktop";
export const GITHUB_RELEASES_LATEST_API =
  `https://api.github.com/repos/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest`;
export const GITHUB_RELEASES_PAGE_URL =
  `https://github.com/${GITHUB_UPDATE_OWNER}/${GITHUB_UPDATE_REPO}/releases/latest`;

export type AppUpdateStatus = "idle" | "checking" | "available" | "up-to-date" | "error";

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  downloadUrl: string | null;
  message: string | null;
  checkedAt: string | null;
}

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  content_type?: string;
  size?: number;
}

export interface GithubRelease {
  tag_name: string;
  name?: string | null;
  html_url: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GithubReleaseAsset[];
}

export function createInitialAppUpdateState(currentVersion: string): AppUpdateState {
  return {
    status: "idle",
    currentVersion: normalizeVersion(currentVersion),
    availableVersion: null,
    releaseName: null,
    releaseUrl: GITHUB_RELEASES_PAGE_URL,
    downloadUrl: null,
    message: null,
    checkedAt: null,
  };
}

/** Strip a leading `v`/`V` and trim whitespace for comparison. */
export function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

/**
 * Compare two dotted versions. Returns:
 * - negative if left < right
 * - 0 if equal
 * - positive if left > right
 *
 * Non-numeric tails (e.g. `1.0.0-beta`) are compared as plain strings after the
 * numeric segments so stable releases sort above prerelease labels of the same
 * triple when the left side is a clean stable version.
 */
export function compareVersions(left: string, right: string): number {
  const leftParts = splitVersion(normalizeVersion(left));
  const rightParts = splitVersion(normalizeVersion(right));
  const length = Math.max(leftParts.numbers.length, rightParts.numbers.length);

  for (let index = 0; index < length; index += 1) {
    const a = leftParts.numbers[index] ?? 0;
    const b = rightParts.numbers[index] ?? 0;
    if (a !== b) return a - b;
  }

  if (!leftParts.suffix && rightParts.suffix) return 1;
  if (leftParts.suffix && !rightParts.suffix) return -1;
  if (leftParts.suffix === rightParts.suffix) return 0;
  return leftParts.suffix < rightParts.suffix ? -1 : 1;
}

export function isUpdateVersionNewer(currentVersion: string, availableVersion: string): boolean {
  return compareVersions(availableVersion, currentVersion) > 0;
}

function splitVersion(version: string): { numbers: number[]; suffix: string } {
  const match = version.match(/^(\d+(?:\.\d+)*)(.*)$/u);
  if (!match) return { numbers: [0], suffix: version.toLowerCase() };
  const numbers = match[1].split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
  const suffix = match[2].replace(/^[-.+]/u, "").toLowerCase();
  return { numbers, suffix };
}

/**
 * Pick the best installer asset for the running platform/arch from a GitHub
 * release. Prefers zip on macOS (electron-builder update artifact), then dmg;
 * NSIS/exe on Windows; AppImage/deb on Linux.
 */
export function pickReleaseAsset(
  assets: readonly GithubReleaseAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): GithubReleaseAsset | null {
  if (!assets.length) return null;

  const normalizedArch = arch === "arm64" || arch === "aarch64" ? "arm64" : arch === "x64" || arch === "amd64" ? "x64" : arch;
  const lower = assets.map((asset) => ({ asset, name: asset.name.toLowerCase() }));

  const matchesArch = (name: string): boolean => {
    if (normalizedArch === "arm64") {
      if (/(x64|amd64|x86_64|intel)/u.test(name) && !/(arm64|aarch64)/u.test(name)) return false;
      return /(arm64|aarch64)/u.test(name) || !/(x64|amd64|x86_64|arm|aarch)/u.test(name);
    }
    if (normalizedArch === "x64") {
      if (/(arm64|aarch64)/u.test(name)) return false;
      return /(x64|amd64|x86_64|intel)/u.test(name) || !/(arm|aarch)/u.test(name);
    }
    return true;
  };

  const ranked = (predicate: (name: string) => boolean): GithubReleaseAsset | null => {
    const candidates = lower.filter(({ name }) => predicate(name) && matchesArch(name));
    return candidates[0]?.asset ?? null;
  };

  if (platform === "darwin") {
    return ranked((name) => name.endsWith(".zip") && !name.includes("blockmap"))
      ?? ranked((name) => name.endsWith(".dmg"))
      ?? null;
  }

  if (platform === "win32") {
    return ranked((name) => name.endsWith(".exe"))
      ?? ranked((name) => name.endsWith(".msi"))
      ?? null;
  }

  if (platform === "linux") {
    return ranked((name) => name.endsWith(".appimage"))
      ?? ranked((name) => name.endsWith(".deb"))
      ?? ranked((name) => name.endsWith(".rpm"))
      ?? null;
  }

  return null;
}

export function shouldShowAppUpdateButton(state: AppUpdateState | null): boolean {
  return Boolean(state && state.status === "available" && (state.downloadUrl || state.releaseUrl));
}

export function getAppUpdateButtonLabel(state: AppUpdateState | null): string {
  if (!state) return "Update";
  if (state.status === "checking") return "Checking…";
  if (state.status === "available") return "Update";
  if (state.status === "error") return "Retry update";
  return "Update";
}

export function getAppUpdateButtonTooltip(state: AppUpdateState | null): string {
  if (!state) return "Check for updates";
  if (state.status === "checking") return "Checking for updates…";
  if (state.status === "available") {
    const version = state.availableVersion ?? "a newer version";
    return state.downloadUrl
      ? `Version ${version} is available. Click to download the installer.`
      : `Version ${version} is available. Click to open the release page.`;
  }
  if (state.status === "up-to-date") {
    return `You're up to date on ${state.currentVersion}.`;
  }
  if (state.status === "error") {
    return state.message ? `${state.message}. Click to try again.` : "Update check failed. Click to try again.";
  }
  return "Check for updates";
}

export function parseGithubRelease(payload: unknown): GithubRelease | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.tag_name !== "string" || !value.tag_name.trim()) return null;
  if (typeof value.html_url !== "string" || !value.html_url.trim()) return null;

  const assets: GithubReleaseAsset[] = [];
  if (Array.isArray(value.assets)) {
    for (const item of value.assets) {
      if (!item || typeof item !== "object") continue;
      const asset = item as Record<string, unknown>;
      if (typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") continue;
      if (!asset.name.trim() || !asset.browser_download_url.trim()) continue;
      assets.push({
        name: asset.name,
        browser_download_url: asset.browser_download_url,
        content_type: typeof asset.content_type === "string" ? asset.content_type : undefined,
        size: typeof asset.size === "number" ? asset.size : undefined,
      });
    }
  }

  return {
    tag_name: value.tag_name,
    name: typeof value.name === "string" ? value.name : null,
    html_url: value.html_url,
    prerelease: value.prerelease === true,
    draft: value.draft === true,
    assets,
  };
}

export function resolveUpdateStateFromRelease(
  currentVersion: string,
  release: GithubRelease,
  options?: { platform?: NodeJS.Platform; arch?: string; checkedAt?: string },
): AppUpdateState {
  const checkedAt = options?.checkedAt ?? new Date().toISOString();
  const availableVersion = normalizeVersion(release.tag_name);
  const current = normalizeVersion(currentVersion);
  const asset = pickReleaseAsset(release.assets ?? [], options?.platform, options?.arch);
  const releaseUrl = release.html_url || GITHUB_RELEASES_PAGE_URL;

  if (!isUpdateVersionNewer(current, availableVersion)) {
    return {
      status: "up-to-date",
      currentVersion: current,
      availableVersion: null,
      releaseName: null,
      releaseUrl,
      downloadUrl: null,
      message: `You're up to date on ${current}.`,
      checkedAt,
    };
  }

  return {
    status: "available",
    currentVersion: current,
    availableVersion,
    releaseName: typeof release.name === "string" && release.name.trim() ? release.name.trim() : `v${availableVersion}`,
    releaseUrl,
    downloadUrl: asset?.browser_download_url ?? null,
    message: asset
      ? `Version ${availableVersion} is ready to download.`
      : `Version ${availableVersion} is available on GitHub Releases.`,
    checkedAt,
  };
}

export type AppUpdateFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface AppUpdaterOptions {
  currentVersion: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: AppUpdateFetch;
  openExternal: (url: string) => Promise<void> | void;
  onStateChange?: (state: AppUpdateState) => void;
  startupDelayMs?: number;
  pollIntervalMs?: number;
  /** When false, automatic startup/poll checks are skipped (manual checks still work). */
  enableBackgroundChecks?: boolean;
}

const DEFAULT_STARTUP_DELAY_MS = 12_000;
const DEFAULT_POLL_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;

export class AppUpdater {
  private state: AppUpdateState;
  private readonly currentVersion: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fetchImpl: AppUpdateFetch;
  private readonly openExternal: (url: string) => Promise<void> | void;
  private readonly onStateChange?: (state: AppUpdateState) => void;
  private readonly startupDelayMs: number;
  private readonly pollIntervalMs: number;
  private readonly enableBackgroundChecks: boolean;
  private checkInFlight: Promise<AppUpdateState> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: AppUpdaterOptions) {
    this.currentVersion = normalizeVersion(options.currentVersion);
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openExternal = options.openExternal;
    this.onStateChange = options.onStateChange;
    this.startupDelayMs = options.startupDelayMs ?? DEFAULT_STARTUP_DELAY_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.enableBackgroundChecks = options.enableBackgroundChecks !== false;
    this.state = createInitialAppUpdateState(this.currentVersion);
  }

  getState(): AppUpdateState {
    return this.state;
  }

  start(): void {
    if (this.disposed || !this.enableBackgroundChecks) return;
    this.clearTimers();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.checkForUpdates("startup");
    }, this.startupDelayMs);
    this.startupTimer.unref?.();

    this.pollTimer = setInterval(() => {
      void this.checkForUpdates("poll");
    }, this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
  }

  async checkForUpdates(_reason: string = "manual"): Promise<AppUpdateState> {
    if (this.disposed) return this.state;
    if (this.checkInFlight) return this.checkInFlight;

    this.checkInFlight = this.runCheck();
    try {
      return await this.checkInFlight;
    } finally {
      this.checkInFlight = null;
    }
  }

  async openDownload(): Promise<{ opened: boolean; url: string | null; state: AppUpdateState }> {
    const state = this.state.status === "available"
      ? this.state
      : await this.checkForUpdates("download");

    if (state.status !== "available") {
      return { opened: false, url: null, state };
    }

    const url = state.downloadUrl || state.releaseUrl;
    if (!url) {
      this.setState({
        ...state,
        status: "error",
        message: "No download URL is available for this release.",
      });
      return { opened: false, url: null, state: this.state };
    }

    try {
      await this.openExternal(url);
      return { opened: true, url, state: this.state };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open the download.";
      this.setState({
        ...this.state,
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
      });
      return { opened: false, url, state: this.state };
    }
  }

  private async runCheck(): Promise<AppUpdateState> {
    this.setState({
      ...this.state,
      status: "checking",
      message: null,
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timeout.unref?.();

      let response: Response;
      try {
        response = await this.fetchImpl(GITHUB_RELEASES_LATEST_API, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `Maximo-Syntax-Desktop/${this.currentVersion}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const detail = response.status === 404
          ? "No published releases were found."
          : `GitHub returned HTTP ${response.status}.`;
        this.setState({
          ...createInitialAppUpdateState(this.currentVersion),
          status: "error",
          message: detail,
          checkedAt: new Date().toISOString(),
        });
        return this.state;
      }

      const payload = await response.json() as unknown;
      const release = parseGithubRelease(payload);
      if (!release || release.draft) {
        this.setState({
          ...createInitialAppUpdateState(this.currentVersion),
          status: "error",
          message: "The latest GitHub release could not be read.",
          checkedAt: new Date().toISOString(),
        });
        return this.state;
      }

      // Skip prereleases for automatic updates; only stable tags count.
      if (release.prerelease) {
        this.setState({
          ...createInitialAppUpdateState(this.currentVersion),
          status: "up-to-date",
          message: `You're up to date on ${this.currentVersion}.`,
          checkedAt: new Date().toISOString(),
        });
        return this.state;
      }

      this.setState(resolveUpdateStateFromRelease(this.currentVersion, release, {
        platform: this.platform,
        arch: this.arch,
        checkedAt: new Date().toISOString(),
      }));
      return this.state;
    } catch (error) {
      const message = error instanceof Error
        ? (error.name === "AbortError" ? "Update check timed out." : error.message)
        : "Update check failed.";
      this.setState({
        ...this.state,
        status: "error",
        message,
        checkedAt: new Date().toISOString(),
      });
      return this.state;
    }
  }

  private setState(next: AppUpdateState): void {
    this.state = next;
    this.onStateChange?.(next);
  }

  private clearTimers(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
