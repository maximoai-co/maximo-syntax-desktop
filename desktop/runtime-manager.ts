import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fetchProviderModels } from "./model-service.js";
import type { EngineModel, EngineSource, EngineStatus } from "./types.js";

export interface EngineLaunch {
  source: EngineSource;
  entryPath: string;
  command: string;
  argsPrefix: string[];
  environment: NodeJS.ProcessEnv;
  version?: string;
}

interface RuntimeManagerOptions {
  appPath: string;
  userDataPath: string;
  isPackaged: boolean;
  configuredPath: () => string;
  onStatus?: (status: EngineStatus) => void;
}

const CLI_PACKAGE = "@maximoai/maximo-syntax-cli";
const CLI_LATEST_URL = `https://registry.npmjs.org/${CLI_PACKAGE}/latest`;
const LATEST_VERSION_RECHECK_MS = 30 * 60_000;

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseVersion(value: string): ParsedSemver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** Returns > 0 when `left` is newer than `right`, < 0 when older, 0 when equal or unparseable. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const part of ["major", "minor", "patch"] as const) {
    if (a[part] !== b[part]) return a[part] > b[part] ? 1 : -1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const leftIsNumber = Number.isInteger(leftNumber);
    const rightIsNumber = Number.isInteger(rightNumber);
    if (leftIsNumber && rightIsNumber) return leftNumber > rightNumber ? 1 : -1;
    if (leftIsNumber) return -1;
    if (rightIsNumber) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function electronNodeLaunch(entryPath: string): Pick<EngineLaunch, "command" | "argsPrefix" | "environment"> {
  const environment = { ...process.env };
  if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = "1";
  let command = process.execPath;
  if (process.platform === "darwin" && process.versions.electron) {
    const contentsPath = resolve(dirname(process.execPath), "..");
    const appName = basename(resolve(contentsPath, ".."), ".app");
    const helperName = `${appName} Helper`;
    const helperPath = join(contentsPath, "Frameworks", `${helperName}.app`, "Contents", "MacOS", helperName);
    if (existsSync(helperPath)) command = helperPath;
  }
  return {
    command,
    argsPrefix: [entryPath],
    environment,
  };
}

type CaptureResult = { code: number | null; stdout: string; stderr: string; cancelled: boolean };

async function capture(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  cwd?: string,
  timeout = 15_000,
  onSpawn?: (child: ChildProcess) => void,
): Promise<CaptureResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let cancelled = false;
    onSpawn?.(child);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, stdout, stderr: error.message, cancelled });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, cancelled });
    });
    // Allow external cancel to mark the run before kill.
    (child as ChildProcess & { markCancelled?: () => void }).markCancelled = () => {
      cancelled = true;
    };
  });
}

export class RuntimeManager {
  private status: EngineStatus = {
    phase: "checking",
    available: false,
    message: "Checking the Maximo Syntax engine…",
    checkedAt: Date.now(),
  };
  private launch: EngineLaunch | null = null;
  private activeChild: (ChildProcess & { markCancelled?: () => void }) | null = null;
  private ensurePromise: Promise<EngineStatus> | null = null;
  private latestVersion: string | null = null;
  private latestVersionCheckedAt = 0;

  constructor(private readonly options: RuntimeManagerOptions) {}

  currentStatus(): EngineStatus {
    return {
      ...this.status,
      ...(this.latestVersion && this.status.available ? { latestVersion: this.latestVersion } : {}),
    };
  }

  currentLaunch(): EngineLaunch | null {
    return this.launch ? { ...this.launch, argsPrefix: [...this.launch.argsPrefix], environment: { ...this.launch.environment } } : null;
  }

  /** Kill the currently tracked long-running execute (e.g. browser auth login). */
  cancelActiveExecute(): boolean {
    if (!this.activeChild || this.activeChild.killed) return false;
    this.activeChild.markCancelled?.();
    this.activeChild.kill("SIGTERM");
    return true;
  }

  async execute(args: string[], timeout = 30_000): Promise<CaptureResult> {
    await this.ensure();
    if (!this.launch) return { code: -1, stdout: "", stderr: "The Maximo Syntax engine is unavailable.", cancelled: false };
    try {
      return await capture(
        this.launch.command,
        [...this.launch.argsPrefix, ...args],
        this.launch.environment,
        undefined,
        timeout,
        (child) => {
          this.activeChild = child as ChildProcess & { markCancelled?: () => void };
        },
      );
    } finally {
      this.activeChild = null;
    }
  }

  async discoverModels(): Promise<EngineModel[]> {
    await this.ensure();
    if (!this.launch) return [];
    try {
      return await fetchProviderModels();
    } catch {
      // A recognized provider failure must not be replaced by an unrelated,
      // generic compatibility catalog. The renderer will show CLI default.
      return [];
    }
  }

  async ensure(forceRepair = false): Promise<EngineStatus> {
    if (this.ensurePromise) {
      if (!forceRepair) return this.ensurePromise;
      await this.ensurePromise;
    }
    if (this.launch && !forceRepair) return this.currentStatus();

    const operation = this.ensureUncached(forceRepair);
    this.ensurePromise = operation;
    try {
      return await operation;
    } finally {
      if (this.ensurePromise === operation) this.ensurePromise = null;
    }
  }

  private async ensureUncached(forceRepair: boolean): Promise<EngineStatus> {
    this.setStatus({ phase: "checking", available: false, message: "Checking the Maximo Syntax engine…" });

    const candidates = await this.getCandidates();
    for (const candidate of candidates) {
      const launch = await this.resolveCandidate(candidate.path, candidate.source);
      if (!launch) continue;
      const version = await this.validate(launch);
      if (!version) continue;
      this.launch = { ...launch, version };
      this.setStatus({
        phase: "ready",
        available: true,
        source: candidate.source,
        entryPath: launch.entryPath,
        version,
        message: candidate.source === "bundled" ? "The included Maximo Syntax engine is ready." : `Maximo Syntax ${version} is ready.`,
      });
      const ready = this.currentStatus();
      // Runtime availability and the authenticated model catalog must never
      // wait behind a best-effort npm version check. That check can consume
      // four network timeouts while offline, making model pickers look stuck.
      void this.autoUpdateIfNeeded().catch(() => undefined);
      return ready;
    }

    return this.installManagedRuntime();
  }

  /** Automatically fetch the newest published CLI version and, when the app is
   * managing the engine (bundled/managed/system), install it if the current
   * version is older. Explicit user configurations and development checkouts
   * are left untouched. */
  private async autoUpdateIfNeeded(): Promise<void> {
    const current = this.launch;
    if (!current?.version || current.version === "installed") return;
    // The workspace-vendored standalone engine is the exact artifact tested
    // with this desktop build. Never replace it with a registry version.
    if (current.entryPath.includes(join("vendor", "maximo-syntax-cli"))) return;
    if (current.source !== "bundled" && current.source !== "managed" && current.source !== "system") return;
    const latest = await this.fetchLatestVersion();
    if (!latest || compareVersions(latest, current.version) <= 0) return;
    const previousStatus = this.currentStatus();
    const updated = await this.installManagedRuntime();
    if (!updated.available || !this.launch) {
      // A failed auto-update (e.g. offline) must not strand the app: fall back
      // to the previously resolved engine.
      this.launch = current;
      this.setStatus(previousStatus);
    }
  }

  /** The newest CLI version published to the npm registry, or null when it
   * could not be determined (offline, registry unreachable). Results are cached
   * for the session and only re-checked after a cooldown. Retries 3× on
   * transient network failures before falling back, matching synara's
   * retryTransient times:3 policy. */
  private async fetchLatestVersion(): Promise<string | null> {
    if (this.latestVersion) return this.latestVersion;
    const now = Date.now();
    if (now - this.latestVersionCheckedAt < LATEST_VERSION_RECHECK_MS) return this.latestVersion;
    this.latestVersionCheckedAt = now;
    // Retry 3× with backoff for transient network hiccups
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(CLI_LATEST_URL, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          // 5xx is retryable, 4xx is not
          if (response.status >= 500 && response.status < 600 && attempt < 4) {
            const backoff = Math.min(4000, 700 * Math.pow(2, attempt - 1) + Math.random() * 200);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return null;
        }
        const data = (await response.json()) as { version?: unknown };
        if (typeof data.version === "string" && parseVersion(data.version)) {
          this.latestVersion = data.version;
          return data.version;
        }
        return null;
      } catch {
        if (attempt < 4) {
          const backoff = Math.min(4000, 700 * Math.pow(2, attempt - 1) + Math.random() * 200);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        // Offline or registry unreachable: keep using the current engine.
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  async update(): Promise<EngineStatus> {
    this.latestVersionCheckedAt = 0;
    await this.installManagedRuntime();
    await this.fetchLatestVersion();
    return this.currentStatus();
  }

  private async getCandidates(): Promise<Array<{ path: string; source: EngineSource }>> {
    const candidates: Array<{ path: string; source: EngineSource }> = [];
    const configured = this.options.configuredPath().trim();
    if (configured) candidates.push({ path: configured, source: "configured" });

    // Desktop packages built from a local CLI checkout vendor the exact tested
    // engine here. Prefer it over sibling, managed, and npm installations so
    // development and packaged tests use the same immutable artifact.
    const localBundle = join(this.options.appPath, "vendor", "maximo-syntax-cli");
    candidates.push({ path: localBundle, source: "bundled" });

    if (!this.options.isPackaged) {
      const sibling = resolve(this.options.appPath, "..", "maximo-syntax-cli");
      candidates.push({ path: sibling, source: "development" });
    }

    const managed = join(this.options.userDataPath, "runtime", "node_modules", "@maximoai", "maximo-syntax-cli");
    candidates.push({ path: managed, source: "managed" });

    const bundled = join(this.options.appPath, "node_modules", "@maximoai", "maximo-syntax-cli");
    candidates.push({ path: bundled, source: "bundled" });

    const systemPath = await this.findSystemCli();
    if (systemPath) candidates.push({ path: systemPath, source: "system" });
    return candidates;
  }

  private async resolveCandidate(inputPath: string, source: EngineSource): Promise<EngineLaunch | null> {
    let candidate = resolve(inputPath);
    // electron-builder unpacks native/runtime dependencies outside app.asar.
    // Resolve that location before checking the candidate directory; the asar
    // virtual path may not contain the unpacked package directory at all.
    if (candidate.includes(".asar/") && !candidate.includes(".asar.unpacked/")) {
      const unpacked = candidate.replace(".asar/", ".asar.unpacked/");
      if (await exists(unpacked)) candidate = unpacked;
    }
    if (!(await exists(candidate))) return null;

    const directoryEntries = [
      join(candidate, "dist", "cli.mjs"),
      join(candidate, "node_modules", "@maximoai", "maximo-syntax-cli", "dist", "cli.mjs"),
    ];
    for (const entry of directoryEntries) {
      if (await exists(entry)) {
        candidate = entry;
        break;
      }
    }

    if (candidate.endsWith(".mjs") || candidate.endsWith(".js")) {
      return { source, entryPath: candidate, ...electronNodeLaunch(candidate) };
    }
    return { source, entryPath: candidate, command: candidate, argsPrefix: [], environment: { ...process.env } };
  }

  private async validate(launch: EngineLaunch): Promise<string | null> {
    const result = await capture(launch.command, [...launch.argsPrefix, "--version"], launch.environment);
    if (result.code !== 0) return null;
    const match = `${result.stdout}\n${result.stderr}`.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/);
    return match?.[0] ?? "installed";
  }

  private async findSystemCli(): Promise<string | null> {
    const pathEntries = (process.env.PATH ?? "").split(delimiter);
    const names = process.platform === "win32"
      ? ["maximo-syntax-cli.cmd", "maximo-syntax.cmd", "maximo.cmd", "syntax.cmd"]
      : ["maximo-syntax-cli", "maximo-syntax", "maximo", "syntax"];
    for (const folder of pathEntries) {
      for (const name of names) {
        const candidate = join(folder, name);
        if (await exists(candidate)) return candidate;
      }
    }
    return null;
  }

  private async installManagedRuntime(): Promise<EngineStatus> {
    this.setStatus({ phase: "installing", available: false, message: "Installing the Maximo Syntax engine…" });
    const npmPath = await this.findNpm();
    if (!npmPath) {
      this.setStatus({
        phase: "error",
        available: false,
        message: "The bundled engine could not be found. Reinstall Maximo Syntax Desktop or install Maximo Syntax CLI manually.",
      });
      return this.currentStatus();
    }

    const runtimeDirectory = join(this.options.userDataPath, "runtime");
    await mkdir(runtimeDirectory, { recursive: true });
    const result = await capture(
      npmPath,
      ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", runtimeDirectory, `${CLI_PACKAGE}@latest`],
      { ...process.env },
      dirname(runtimeDirectory),
      180_000,
    );
    if (result.code !== 0) {
      this.setStatus({ phase: "error", available: false, message: result.stderr.trim() || "The engine installation failed. Check your internet connection and try again." });
      return this.currentStatus();
    }
    const managedPath = join(runtimeDirectory, "node_modules", "@maximoai", "maximo-syntax-cli");
    const launch = await this.resolveCandidate(managedPath, "managed");
    const version = launch ? await this.validate(launch) : null;
    if (!launch || !version) {
      this.setStatus({ phase: "error", available: false, message: "The engine installed but could not be started." });
      return this.currentStatus();
    }
    this.launch = { ...launch, version };
    this.setStatus({ phase: "ready", available: true, source: "managed", entryPath: launch.entryPath, version, message: `Maximo Syntax ${version} was installed and is ready.` });
    return this.currentStatus();
  }

  private async findNpm(): Promise<string | null> {
    const names = process.platform === "win32" ? ["npm.cmd", "npm.exe"] : ["npm"];
    for (const folder of (process.env.PATH ?? "").split(delimiter)) {
      for (const name of names) {
        const candidate = join(folder, name);
        if (await exists(candidate)) return candidate;
      }
    }
    return null;
  }

  private setStatus(patch: Omit<EngineStatus, "checkedAt">): void {
    this.status = { ...patch, checkedAt: Date.now() };
    this.options.onStatus?.(this.currentStatus());
  }
}
