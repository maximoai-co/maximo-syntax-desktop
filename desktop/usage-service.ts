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

    // Billing details (wallet balance etc.) may be in the same envelope or require the dedicated detailed-usage endpoint.
    // The CLI shows billing via /cli/usage/detailed-usage, and the desktop should mirror it so the Usage panel shows:
    // Billing Wallet Balance / Total Spent / Total Deposited even when limits are zero.
    let walletBalance: number | undefined = typeof data.walletBalance === "number" ? data.walletBalance : typeof (data as JsonObject).wallet_balance === "number" ? (data as JsonObject).wallet_balance as number : undefined;
    let totalSpent: number | undefined = typeof data.totalSpent === "number" ? data.totalSpent : typeof (data as JsonObject).total_spent === "number" ? (data as JsonObject).total_spent as number : undefined;
    let totalDeposited: number | undefined = typeof data.totalDeposited === "number" ? data.totalDeposited : typeof (data as JsonObject).total_deposited === "number" ? (data as JsonObject).total_deposited as number : undefined;
    let currency: string | undefined = typeof data.currency === "string" ? data.currency as string : undefined;
    // Also check nested billing object if present directly in the utilization payload.
    const billingInline = (data.billing as JsonObject | undefined) ?? (data.wallet as JsonObject | undefined);
    if (billingInline) {
      if (walletBalance === undefined && typeof billingInline.walletBalance === "number") walletBalance = billingInline.walletBalance;
      if (walletBalance === undefined && typeof (billingInline as JsonObject).wallet_balance === "number") walletBalance = (billingInline as JsonObject).wallet_balance as number;
      if (totalSpent === undefined && typeof billingInline.totalSpent === "number") totalSpent = billingInline.totalSpent;
      if (totalSpent === undefined && typeof (billingInline as JsonObject).total_spent === "number") totalSpent = (billingInline as JsonObject).total_spent as number;
      if (totalDeposited === undefined && typeof billingInline.totalDeposited === "number") totalDeposited = billingInline.totalDeposited;
      if (totalDeposited === undefined && typeof (billingInline as JsonObject).total_deposited === "number") totalDeposited = (billingInline as JsonObject).total_deposited as number;
      if (!currency && typeof billingInline.currency === "string") currency = billingInline.currency as string;
    }

    // If billing still missing, try the dedicated detailed-usage endpoint (best-effort, non-fatal).
    if (headers && (walletBalance === undefined || totalSpent === undefined || totalDeposited === undefined)) {
      try {
        const detailedEnvelope = await requestJson("https://api.maximoai.co/cli/usage/detailed-usage", headers);
        const detailedData = detailedEnvelope.success === true && detailedEnvelope.data && typeof detailedEnvelope.data === "object" ? detailedEnvelope.data as JsonObject : detailedEnvelope;
        const billing = (detailedData.billing as JsonObject | undefined) ?? (detailedData.wallet as JsonObject | undefined) ?? detailedData;
        if (billing) {
          if (walletBalance === undefined) {
            const wb = typeof billing.walletBalance === "number" ? billing.walletBalance : typeof (billing as JsonObject).wallet_balance === "number" ? (billing as JsonObject).wallet_balance as number : undefined;
            if (typeof wb === "number") walletBalance = wb;
            else if (typeof detailedData.walletBalance === "number") walletBalance = detailedData.walletBalance as number;
          }
          if (totalSpent === undefined) {
            const ts = typeof billing.totalSpent === "number" ? billing.totalSpent : typeof (billing as JsonObject).total_spent === "number" ? (billing as JsonObject).total_spent as number : undefined;
            if (typeof ts === "number") totalSpent = ts;
            else if (typeof detailedData.totalSpent === "number") totalSpent = detailedData.totalSpent as number;
          }
          if (totalDeposited === undefined) {
            const td = typeof billing.totalDeposited === "number" ? billing.totalDeposited : typeof (billing as JsonObject).total_deposited === "number" ? (billing as JsonObject).total_deposited as number : undefined;
            if (typeof td === "number") totalDeposited = td;
            else if (typeof detailedData.totalDeposited === "number") totalDeposited = detailedData.totalDeposited as number;
          }
          if (!currency && typeof billing.currency === "string") currency = billing.currency as string;
          else if (!currency && typeof detailedData.currency === "string") currency = detailedData.currency as string;
        }
      } catch {
        // Billing is optional - ignore failures and return limits only.
      }
    }

    // Currency fallback
    if (!currency) currency = "USD";

    return {
      available: true,
      provider: "maximoai",
      planName: typeof codingPlan?.name === "string" ? codingPlan.name : rawPlan ? `Maximo AI ${rawPlan.charAt(0).toUpperCase()}${rawPlan.slice(1)}` : "Maximo AI plan",
      concurrency: typeof codingPlan?.concurrency === "number" ? codingPlan.concurrency : null,
      balance: typeof data.balance === "number" ? data.balance : walletBalance,
      walletBalance,
      totalSpent,
      totalDeposited,
      currency,
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
