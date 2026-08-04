import { createConnection } from "node:net";
import { browserToolDefinitions } from "./browser-automation.js";

const pipePath = process.env.MAXIMO_BROWSER_HOST_PIPE?.trim();
const capability = process.env.MAXIMO_BROWSER_HOST_CAPABILITY?.trim();
const threadId = process.env.MAXIMO_BROWSER_THREAD_ID?.trim();
const workspaceRoot = process.env.MAXIMO_BROWSER_WORKSPACE_ROOT?.trim();

interface McpMessage {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}

interface HostResponse {
  id?: string | number;
  result?: unknown;
  error?: { code?: string; message?: string };
}

let nextHostRequestId = 1;

function writeMessage(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function callHost(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!pipePath || !capability || !threadId) return Promise.reject(new Error("The Maximo browser host is unavailable."));
  const id = nextHostRequestId++;
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(pipePath);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("The Maximo browser host did not respond."));
    }, 35_000);
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      socket.destroy();
      callback();
    };
    socket.once("error", (error) => finish(() => reject(error)));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      if (!line) return;
      let response: HostResponse;
      try {
        response = JSON.parse(line) as HostResponse;
      } catch {
        finish(() => reject(new Error("The Maximo browser host returned malformed data.")));
        return;
      }
      if (response.id !== id) return;
      if (response.error) finish(() => reject(new Error(`${response.error?.code ? `${response.error.code}: ` : ""}${response.error?.message ?? "Browser request failed."}`)));
      else finish(() => resolvePromise(response.result));
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id, capability, sessionId: process.env.MAXIMO_BROWSER_SESSION_ID ?? `session-${process.pid}`, provider: "maximo-syntax", threadId, name, arguments: args, ...(workspaceRoot ? { workspaceRoot } : {}) })}\n`);
    });
  });
}

function mcpToolResult(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const image = record?.image && typeof record.image === "object" ? record.image as Record<string, unknown> : null;
  const content: Array<Record<string, unknown>> = [{ type: "text", text: JSON.stringify(image ? { ...record, image: { ...image, data: "[PNG attached]" } } : value) }];
  if (typeof image?.data === "string" && image.data.length > 0) content.push({ type: "image", data: image.data, mimeType: typeof image.mimeType === "string" ? image.mimeType : "image/png" });
  return { content, structuredContent: value };
}

async function handle(message: McpMessage): Promise<void> {
  if (message.method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "Maximo Browser", version: "1.0.0" },
        instructions: "These tools control the shared Maximo Syntax browser. Human input may interrupt an action; use browser_snapshot after navigation or human changes.",
      },
    });
    return;
  }
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  if (message.method === "ping") {
    writeMessage({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "tools/list") {
    writeMessage({ jsonrpc: "2.0", id: message.id, result: { tools: browserToolDefinitions() } });
    return;
  }
  if (message.method === "tools/call") {
    const name = typeof message.params?.name === "string" ? message.params.name : "";
    const args = message.params?.arguments && typeof message.params.arguments === "object" && !Array.isArray(message.params.arguments)
      ? message.params.arguments as Record<string, unknown>
      : {};
    try {
      const result = await callHost(name, args);
      writeMessage({ jsonrpc: "2.0", id: message.id, result: mcpToolResult(result) });
    } catch (error) {
      writeMessage({ jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Browser request failed." }] } });
    }
    return;
  }
  if (message.id !== undefined) writeMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found." } });
}

let inputBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  let newline = inputBuffer.indexOf("\n");
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    newline = inputBuffer.indexOf("\n");
    if (!line) continue;
    try {
      const message = JSON.parse(line) as McpMessage;
      void handle(message).catch((error) => process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`));
    } catch {
      process.stderr.write("Malformed MCP message.\n");
    }
  }
});
process.stdin.resume();
