import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import type { EngineModel, OpenCodePlan } from "./types.js";

type JsonObject = Record<string, unknown>;

interface ActiveModelSelection {
  model?: string;
  effort?: string;
}

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

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function contextWindowFromModel(source: JsonObject): number | undefined {
  for (const key of ["context_window", "contextWindow", "context_length", "contextLength", "max_input_tokens"]) {
    const value = positiveNumber(source[key]);
    if (value !== undefined) return Math.round(value);
  }
  return undefined;
}

function normalizeEffort(value: string): string {
  return value.trim().toLowerCase().replace(/[-_\s]+/g, "").replace(/^extrahigh$/, "xhigh");
}

const MAXIMO_REASONING_EFFORTS = ["low", "medium", "high"];
// OpenAI-style gateways normalize effort across providers: xAI/GPT models
// accept xhigh, Anthropic-style models accept max. Keep the full engine range
// when the catalog omits reasoning metadata instead of downgrading to high.
const THIRD_PARTY_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
// The OpenCode catalog also contains Responses and Anthropic Messages models;
// keep the desktop picker aligned with the Chat Completions model tables in
// https://opencode.ai/docs/zen/ and https://opencode.ai/docs/go/.
const OPENCODE_CHAT_COMPLETION_MODELS: Record<OpenCodePlan, ReadonlySet<string>> = {
  zen: new Set([
    "deepseek-v4-pro", "deepseek-v4-flash", "minimax-m3", "minimax-m2.7", "minimax-m2.5",
    "glm-5.2", "glm-5.1", "glm-5", "kimi-k2.5", "kimi-k2.6", "kimi-k2.7-code", "kimi-k3",
    "big-pickle", "mimo-v2.5-free", "laguna-s-2.1-free", "ling-3.0-flash-free",
    "north-mini-code-free", "nemotron-3-ultra-free", "deepseek-v4-flash-free",
  ]),
  go: new Set([
    "grok-4.5", "glm-5.2", "glm-5.1", "kimi-k3", "kimi-k2.7-code", "kimi-k2.6",
    "deepseek-v4-pro", "deepseek-v4-flash", "mimo-v2.5", "mimo-v2.5-pro", "hy3",
  ]),
};

export function isOpenCodeChatCompletionModel(plan: OpenCodePlan, modelId: string): boolean {
  return OPENCODE_CHAT_COMPLETION_MODELS[plan].has(modelId);
}

function openCodePlanForBaseUrl(baseUrl: string): OpenCodePlan | undefined {
  if (baseUrl === OPENCODE_GO_BASE_URL) return "go";
  if (baseUrl === OPENCODE_ZEN_BASE_URL) return "zen";
  return undefined;
}

function includesString(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim().toLowerCase() === expected);
}

function isMaximoReasoningModel(id: string): boolean {
  return /^maximo-(?:pandora|atlas)(?:-|$)/i.test(id);
}

async function readActiveModelSelection(config: JsonObject): Promise<ActiveModelSelection> {
  const configDirectory = process.env.MAXIMO_CONFIG_DIR?.trim() || join(homedir(), ".maximo");
  const settings = await readJson(join(configDirectory, "settings.json")) ?? {};
  const model = text(settings.model) ?? text(config.openAIModel) ?? text(config.mytabulonDefaultModel);
  const settingsEnvironment = settings.env && typeof settings.env === "object" ? settings.env as JsonObject : undefined;
  const rawEffort = text(process.env.MAXIMO_SYNTAX_EFFORT_LEVEL) ?? text(settingsEnvironment?.MAXIMO_SYNTAX_EFFORT_LEVEL) ?? text(settings.effortLevel);
  const normalizedEffort = rawEffort && !["auto", "unset"].includes(normalizeEffort(rawEffort)) ? normalizeEffort(rawEffort) : undefined;
  return {
    ...(model ? { model } : {}),
    ...(normalizedEffort ? { effort: normalizedEffort } : {}),
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map(normalizeEffort).filter(Boolean))];
}

export function parseModel(item: unknown, options: { fallbackEffort?: boolean } = {}): EngineModel | null {
  if (!item || typeof item !== "object") return null;
  const source = item as JsonObject;
  const id = text(source.id);
  if (!id) return null;
  const reasoning = source.reasoning && typeof source.reasoning === "object" ? source.reasoning as JsonObject : undefined;
  const advertisedEfforts = uniqueStrings(reasoning?.supported_efforts);
  const efforts = advertisedEfforts.length > 0 ? advertisedEfforts : uniqueStrings(source.reasoning_efforts);
  // OpenAI-compatible gateways do not consistently expose reasoning metadata.
  // The runner explicitly enables effort forwarding for these providers, so
  // offer the standard choices when the catalog has no explicit effort list.
  const supportsReasoning = efforts.length > 0 || includesString(reasoning?.capabilities, "reasoning") || includesString(source.capabilities, "reasoning") || includesString(source.supported_features, "reasoning") || includesString(source.supported_parameters, "reasoning") || isMaximoReasoningModel(id) || (options.fallbackEffort === true && efforts.length === 0);
  const supportedEffortLevels = efforts.length > 0
    ? efforts
    : supportsReasoning
      ? [...(options.fallbackEffort ? THIRD_PARTY_REASONING_EFFORTS : MAXIMO_REASONING_EFFORTS)]
      : [];
  const defaultEffort = text(reasoning?.default_effort);
  return {
    value: id,
    displayName: text(source.name) ?? id,
    description: text(source.recommendation) ?? text(source.description) ?? "Available with the active account",
    ...(contextWindowFromModel(source) !== undefined ? { contextWindow: contextWindowFromModel(source) } : {}),
    supportsEffort: supportedEffortLevels.length > 0,
    supportedEffortLevels,
    defaultEffort: defaultEffort ? normalizeEffort(defaultEffort) : undefined,
    supportsAutoMode: Array.isArray(source.supported_features) ? source.supported_features.includes("auto") : undefined,
  };
}

function uniqueModels(models: EngineModel[]): EngineModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.value)) return false;
    seen.add(model.value);
    return true;
  });
}

function currentModelOption(models: EngineModel[], active: ActiveModelSelection, providerLabel?: string, options: { fallbackEffort?: boolean } = {}): EngineModel | null {
  const activeId = active.model;
  if (!activeId) return null;
  const matched = models.find((model) => model.value === activeId);
  // A model remembered by the previous provider must not become the new
  // provider's apparent default just because the catalog was refreshed.
  if (!matched && models.length > 0) return null;
  const supportedEffortLevels = matched?.supportedEffortLevels ?? (active.effort ? [active.effort] : options.fallbackEffort ? THIRD_PARTY_REASONING_EFFORTS : []);
  const supportsEffort = matched?.supportsEffort ?? supportedEffortLevels.length > 0;
  const activeEffort = active.effort ?? matched?.defaultEffort ?? (supportsEffort ? options.fallbackEffort ? "medium" : "high" : undefined);
  return {
    value: "default",
    displayName: matched?.displayName ?? activeId,
    description: matched?.description ?? `Current active model · ${activeId}`,
    isCurrent: true,
    supportsEffort,
    supportedEffortLevels,
    defaultEffort: matched?.defaultEffort,
    activeEffort,
    supportsAutoMode: matched?.supportsAutoMode,
    ...(matched?.contextWindow !== undefined ? { contextWindow: matched.contextWindow } : {}),
    ...(providerLabel && !matched ? { description: `Current ${providerLabel} model · ${activeId}` } : {}),
  };
}

function providerFor(baseUrl: string): "maximoai" | "mytabulon" | "cencori" | "openrouter" | "opencode" | null {
  if (/api\.mytabulon\.com/i.test(baseUrl)) return "mytabulon";
  if (/api\.cencori\.com/i.test(baseUrl)) return "cencori";
  if (/maximoai?\.co/i.test(baseUrl)) return "maximoai";
  if (baseUrl === OPENROUTER_BASE_URL) return "openrouter";
  if (openCodePlanForBaseUrl(baseUrl)) return "opencode";
  return null;
}

export async function fetchProviderModels(): Promise<EngineModel[]> {
  const config = await readJson(join(homedir(), ".maximo.json")) ?? {};
  const active = await readActiveModelSelection(config);
  const baseUrl = text(config.openAIBaseUrl)?.replace(/\/+$/, "") ?? "";
  const provider = providerFor(baseUrl);
  const providerLabel = provider === "mytabulon"
    ? "MyTabulon"
    : provider === "cencori"
      ? "Cencori"
      : provider === "openrouter"
        ? "OpenRouter"
        : provider === "opencode"
          ? `OpenCode ${openCodePlanForBaseUrl(baseUrl) === "go" ? "Go" : "Zen"}`
          : "Maximo AI";
  if (!provider) return active.model ? [currentModelOption([], active)!] : [];

  let credential = provider === "cencori" ? text(config.cencoriApiKey) ?? text(config.maximoApiKey) : text(config.maximoApiKey);
  if (!credential && provider === "maximoai") {
    const secure = await readKeychainCredentials();
    const oauth = secure?.claudeAiOauth && typeof secure.claudeAiOauth === "object" ? secure.claudeAiOauth as JsonObject : undefined;
    credential = text(oauth?.accessToken);
  }
  if (!credential) return active.model ? [currentModelOption([], active, providerLabel)!] : [];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return active.model ? [currentModelOption([], active, providerLabel)!] : [];
  }
  if (!response.ok) return active.model ? [currentModelOption([], active, providerLabel)!] : [];
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    return active.model ? [currentModelOption([], active, providerLabel)!] : [];
  }
  const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" && Array.isArray((payload as JsonObject).data) ? (payload as JsonObject).data as unknown[] : [];
  const openCodePlan = openCodePlanForBaseUrl(baseUrl);
  const fallbackEffort = provider === "openrouter" || provider === "opencode" || provider === "cencori";
  const catalogRows = provider === "opencode" && openCodePlan
    ? rows.filter((item) => {
        const id = item && typeof item === "object" ? text((item as JsonObject).id) : undefined;
        return Boolean(id && isOpenCodeChatCompletionModel(openCodePlan, id));
      })
    : rows;
  const models = uniqueModels(catalogRows.map((item) => parseModel(item, { fallbackEffort })).filter((model): model is EngineModel => Boolean(model)));
  const current = currentModelOption(models, active, providerLabel, { fallbackEffort });
  const catalog = active.model && models.some((model) => model.value === active.model)
    ? models.filter((model) => model.value !== active.model)
    : models;
  return [
    ...(current ? [current] : [{
      value: "default",
      displayName: "Default (recommended)",
      description: `Use your ${providerLabel} account default`,
      supportsEffort: false,
    } satisfies EngineModel]),
    ...catalog,
  ];
}
