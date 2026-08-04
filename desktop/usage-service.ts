import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import type { UsageLimit, UsageSnapshot } from "./types.js";

type JsonObject = Record<string, unknown>;

async function readJson(path: string): Promise<JsonObject | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as JsonObject;
  } catch {
    return null;
  }
}

async function readKeychainCredentials(): Promise<JsonObject | null> {
  if (process.platform !== "darwin") return readJson(join(homedir(), ".maximo", ".credentials.json"));
  const username = process.env.USER || userInfo().username || "maximo-syntax-user";
  return new Promise((resolve) => {
    const child = spawn("security", ["find-generic-password", "-a", username, "-w", "-s", "Maximo Syntax-credentials"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(output) as JsonObject); } catch { resolve(null); }
    });
  });
}

function limit(id: string, label: string, value: unknown): UsageLimit | null {
  if (!value || typeof value !== "object") return null;
  const source = value as JsonObject;
  const raw = typeof source.utilization === "number" ? source.utilization : typeof source.usedPercent === "number" ? source.usedPercent : null;
  return {
    id,
    label,
    utilization: raw === null ? null : Math.max(0, Math.min(100, raw)),
    resetsAt: typeof source.resets_at === "string" ? source.resets_at : typeof source.resetAt === "string" ? source.resetAt : null,
  };
}

function allocationLimit(id: string, label: string, value: unknown): UsageLimit | null {
  if (!value || typeof value !== "object") return null;
  const source = value as JsonObject;
  const remaining = typeof source.percentRemaining === "number" ? source.percentRemaining : null;
  const used = typeof source.used === "number" ? source.used : undefined;
  const maximum = typeof source.limit === "number" ? source.limit : undefined;
  return {
    id,
    label,
    utilization: remaining === null ? (used !== undefined && maximum ? Math.min(100, (used / maximum) * 100) : null) : Math.max(0, Math.min(100, 100 - remaining)),
    resetsAt: typeof source.resetAt === "string" ? source.resetAt : null,
    used,
    limit: maximum,
  };
}

async function requestJson(url: string, headers: Record<string, string>): Promise<JsonObject> {
  const response = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(12_000) });
  const data = await response.json().catch(() => null) as JsonObject | null;
  if (!response.ok || !data) {
    const error = data?.error as JsonObject | string | undefined;
    const message = typeof error === "string" ? error : typeof error?.message === "string" ? error.message : `Usage request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export async function fetchAccountUsage(): Promise<UsageSnapshot> {
  const config = await readJson(join(homedir(), ".maximo.json")) ?? {};
  const baseUrl = typeof config.openAIBaseUrl === "string" ? config.openAIBaseUrl.replace(/\/+$/, "") : "";
  const apiKey = typeof config.maximoApiKey === "string" ? config.maximoApiKey : "";
  try {
    if (baseUrl.includes("openrouter.ai/api/v1")) {
      return {
        available: false,
        provider: "openrouter",
        limits: [],
        message: "OpenRouter usage and billing are managed at openrouter.ai.",
        fetchedAt: Date.now(),
      };
    }
    if (baseUrl.includes("opencode.ai/zen/")) {
      return {
        available: false,
        provider: "opencode",
        limits: [],
        message: "OpenCode usage and billing are managed at opencode.ai/auth.",
        fetchedAt: Date.now(),
      };
    }
    if (baseUrl.includes("api.mytabulon.com") && apiKey) {
      const data = await requestJson(`${baseUrl}/coding-plan/usage`, { Authorization: `Bearer ${apiKey}` });
      const limits = [limit("window", "Current window", data.window), limit("weekly", "Weekly", data.weekly)].filter((item): item is UsageLimit => Boolean(item));
      return {
        available: true,
        provider: "mytabulon",
        planName: typeof data.name === "string" ? data.name : typeof data.tier === "string" ? `Coding ${data.tier}` : "MyTabulon Coding Plan",
        concurrency: typeof data.concurrency === "number" ? data.concurrency : null,
        limits,
        fetchedAt: Date.now(),
      };
    }

    let headers: Record<string, string> | null = apiKey ? { "x-api-key": apiKey } : null;
    if (!headers) {
      const secure = await readKeychainCredentials();
      const oauth = secure?.claudeAiOauth as JsonObject | undefined;
      if (typeof oauth?.accessToken === "string") headers = { Authorization: `Bearer ${oauth.accessToken}` };
    }
    if (!headers) return { available: false, provider: "unknown", limits: [], message: "Sign in with a Maximo AI or MyTabulon plan to view usage.", fetchedAt: Date.now() };

    const envelope = await requestJson("https://api.maximoai.co/cli/oauth/usage", headers);
    const data = envelope.success === true && envelope.data && typeof envelope.data === "object" ? envelope.data as JsonObject : envelope;
    const limits = [
      allocationLimit("five-hour", "Current window", data.fiveHour) ?? limit("five-hour", "Current window", data.five_hour),
      allocationLimit("daily", "Daily", data.daily),
      allocationLimit("seven-day", "Weekly", data.weekly) ?? limit("seven-day", "Weekly", data.seven_day),
      limit("seven-day-opus", "Opus weekly", data.seven_day_opus),
      limit("seven-day-sonnet", "Sonnet weekly", data.seven_day_sonnet),
    ].filter((item): item is UsageLimit => Boolean(item));
    const codingPlan = data.coding_plan as JsonObject | undefined;
    const rawPlan = typeof data.plan === "string" ? data.plan : undefined;
    const fairUsage = data.fairUsageStatus as JsonObject | undefined;
    return {
      available: true,
      provider: "maximoai",
      planName: typeof codingPlan?.name === "string" ? codingPlan.name : rawPlan ? `Maximo AI ${rawPlan.charAt(0).toUpperCase()}${rawPlan.slice(1)}` : "Maximo AI plan",
      concurrency: typeof codingPlan?.concurrency === "number" ? codingPlan.concurrency : null,
      balance: typeof data.balance === "number" ? data.balance : undefined,
      limits,
      message: typeof fairUsage?.message === "string" ? fairUsage.message : limits.length === 0 ? "Your plan is active. No rate-limit windows were reported." : undefined,
      fetchedAt: Date.now(),
    };
  } catch (error) {
    return {
      available: false,
      provider: baseUrl.includes("mytabulon.com") ? "mytabulon" : "maximoai",
      limits: [],
      message: error instanceof Error ? error.message : "Unable to load usage right now.",
      fetchedAt: Date.now(),
    };
  }
}
