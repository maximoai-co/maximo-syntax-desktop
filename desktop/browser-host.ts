import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { BrowserAutomationHost, BrowserHostError, isBrowserToolName, type BrowserHostCall } from "./browser-automation.js";
import type { BrowserManager } from "./browser-manager.js";

const MAX_LINE_BYTES = 12 * 1024 * 1024;
const PIPE_PREFIX = "maximo-browser-host";

export interface BrowserBridgeLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface BrowserHostRequest {
  id?: string | number;
  capability?: string;
  sessionId?: string;
  provider?: string;
  threadId?: string;
  name?: string;
  arguments?: unknown;
  workspaceRoot?: string;
}

interface BrowserHostErrorResponse {
  code?: string;
  message: string;
}

function defaultPipePath(): string {
  const uid = process.getuid?.() ?? "user";
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\${PIPE_PREFIX}-${process.pid}-${randomBytes(8).toString("hex")}`;
  }
  const privateDirectory = join("/tmp", `${PIPE_PREFIX}-${uid}-${process.pid}`);
  return join(privateDirectory, `${randomBytes(8).toString("hex")}.sock`);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Browser request failed.";
}

function launchForBridge(bridgePath: string): { command: string; args: string[]; env: Record<string, string> } {
  let command = process.execPath;
  if (process.platform === "darwin" && process.versions.electron) {
    const contentsPath = resolve(dirname(process.execPath), "..");
    const appName = resolve(contentsPath, "..").replace(/\.app$/u, "").split(/[\\/]/u).at(-1) ?? "Electron";
    const helperName = `${appName} Helper`;
    const helperPath = join(contentsPath, "Frameworks", `${helperName}.app`, "Contents", "MacOS", helperName);
    command = helperPath;
  }
  return {
    command,
    args: [bridgePath],
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
}

export class BrowserHostServer {
  private readonly pipePath: string;
  private readonly capability: string;
  private readonly automation: BrowserAutomationHost;
  private readonly sockets = new Set<Socket>();
  private server: Server | null = null;
  private started = false;

  constructor(
    private readonly manager: BrowserManager,
    private readonly bridgePath: string,
    options: { pipePath?: string; capability?: string; onRequestOpenPanel?: (threadId: string) => void } = {},
  ) {
    this.pipePath = options.pipePath?.trim() || defaultPipePath();
    this.capability = options.capability?.trim() || randomBytes(32).toString("hex");
    this.automation = new BrowserAutomationHost(manager, {
      onRequestOpenPanel: options.onRequestOpenPanel,
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (process.platform !== "win32") {
      await mkdir(dirname(this.pipePath), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.pipePath), 0o700);
      await unlink(this.pipePath).catch(() => undefined);
    }
    const server = createServer((socket) => this.handleConnection(socket));
    this.server = server;
    await new Promise<void>((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(this.pipePath, () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
    if (process.platform !== "win32") await chmod(this.pipePath, 0o600);
    this.started = true;
  }

  bridgeLaunch(threadId: string, workspaceRoot: string): BrowserBridgeLaunch {
    const launch = launchForBridge(this.bridgePath);
    return {
      command: launch.command,
      args: launch.args,
      env: {
        ...launch.env,
        MAXIMO_BROWSER_HOST_PIPE: this.pipePath,
        MAXIMO_BROWSER_HOST_CAPABILITY: this.capability,
        MAXIMO_BROWSER_THREAD_ID: threadId,
        MAXIMO_BROWSER_WORKSPACE_ROOT: workspaceRoot,
      },
    };
  }

  async dispose(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (server && this.started) {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
    this.started = false;
    if (process.platform !== "win32") await unlink(this.pipePath).catch(() => undefined);
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket);
    let buffer = "";
    const release = () => {
      this.sockets.delete(socket);
    };
    socket.on("close", release);
    socket.on("error", release);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (Buffer.byteLength(buffer, "utf8") > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (line) void this.handleRequest(socket, line);
      }
    });
  }

  private async handleRequest(socket: Socket, line: string): Promise<void> {
    let request: BrowserHostRequest;
    try {
      request = JSON.parse(line) as BrowserHostRequest;
    } catch {
      return;
    }
    const id = request.id;
    try {
      if (id === undefined || typeof request.capability !== "string") throw new Error("Malformed browser request.");
      const expected = Buffer.from(this.capability, "utf8");
      const supplied = Buffer.from(request.capability, "utf8");
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Browser authorization failed.");
      const name = String(request.name ?? "");
      if (typeof request.sessionId !== "string" || typeof request.provider !== "string" || typeof request.threadId !== "string" || !isBrowserToolName(name)) throw new Error("Malformed browser request.");
      const result = await this.automation.execute({
        capability: request.capability,
        sessionId: request.sessionId,
        provider: request.provider,
        threadId: request.threadId,
        name,
        arguments: request.arguments && typeof request.arguments === "object" && !Array.isArray(request.arguments) ? request.arguments as Record<string, unknown> : {},
        ...(typeof request.workspaceRoot === "string" ? { workspaceRoot: request.workspaceRoot } : {}),
      } satisfies BrowserHostCall);
      this.write(socket, { id, result });
    } catch (error) {
      this.write(socket, {
        id,
        error: {
          code: error instanceof BrowserHostError ? error.code : "BrowserActionFailed",
          message: safeError(error),
        } satisfies BrowserHostErrorResponse,
      });
    }
  }

  private write(socket: Socket, message: unknown): void {
    if (socket.destroyed || socket.writableEnded) return;
    socket.write(`${JSON.stringify(message)}\n`);
  }
}
