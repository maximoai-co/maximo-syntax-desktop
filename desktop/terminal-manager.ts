import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import type { TerminalEvent, TerminalSession } from "./types.js";

const MAX_INPUT_LENGTH = 20_000;
const MAX_CHUNK_LENGTH = 32_000;

interface ManagedTerminal {
  session: TerminalSession;
  process: IPty;
}

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedTerminal>();

  constructor(private readonly emit: (event: TerminalEvent) => void) {}

  start(cwd: string): TerminalSession {
    const shell = process.platform === "win32"
      ? (process.env.ComSpec || "cmd.exe")
      : (process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : "/bin/zsh");
    const args = process.platform === "win32" ? [] : ["-i"];
    const session: TerminalSession = { sessionId: randomUUID(), cwd, shell };
    const terminalProcess = spawn(shell, args, {
      name: "xterm-256color",
      cols: 120,
      rows: 32,
      cwd,
      env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>,
    });
    const managed = { session, process: terminalProcess } satisfies ManagedTerminal;
    this.sessions.set(session.sessionId, managed);
    const emitOutput = (text: string) => {
      if (text) this.emit({ type: "output", sessionId: session.sessionId, text: text.slice(0, MAX_CHUNK_LENGTH), timestamp: Date.now() });
    };
    terminalProcess.onData(emitOutput);
    terminalProcess.onExit(({ exitCode, signal }) => {
      this.sessions.delete(session.sessionId);
      this.emit({ type: "exit", sessionId: session.sessionId, code: exitCode, ...(signal ? { signal: String(signal) } : {}), timestamp: Date.now() });
    });
    this.emit({ type: "started", sessionId: session.sessionId, cwd, shell, timestamp: Date.now() });
    return session;
  }

  input(sessionId: string, value: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;
    managed.process.write(value.slice(0, MAX_INPUT_LENGTH));
    return true;
  }

  resize(sessionId: string, columns: number, rows: number): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;
    managed.process.resize(Math.max(20, Math.min(400, Math.round(columns))), Math.max(5, Math.min(200, Math.round(rows))));
    return true;
  }

  stop(sessionId: string): boolean {
    const managed = this.sessions.get(sessionId);
    if (!managed) return false;
    managed.process.kill();
    this.sessions.delete(sessionId);
    return true;
  }

  stopAll(): void {
    for (const sessionId of this.sessions.keys()) this.stop(sessionId);
  }
}
