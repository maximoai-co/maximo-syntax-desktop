export type ModelProvider = "maximo" | "openai" | "openai-codex" | "claude" | "anthropic" | "google" | "grok" | "deepseek" | "mistral" | "meta" | "perplexity" | "ollama" | "kilo" | "unknown";

export function modelProvider(modelId: string | undefined | null): ModelProvider {
  const raw = (modelId ?? "").trim();
  const id = raw.toLowerCase();
  if (!id || id === "default" || id === "cli default" || id === "default (recommended)") return "maximo";
  // Exact early returns for well-known singular ids (cheap path before substring scan)
  if (id === "codex" || id === "gpt-codex" || id === "openai-codex") return "openai-codex";
  if (id === "chatgpt" || id === "openai" || id === "gpt") return "openai";
  if (id === "claude" || id === "anthropic") return "claude";
  if (id === "gemini" || id === "google") return "google";
  if (id === "grok" || id === "xai") return "grok";
  if (id === "deepseek") return "deepseek";
  if (id === "mistral" || id === "mixtral" || id === "codestral") return "mistral";
  if (id === "llama" || id === "meta" || id === "meta-ai" || id === "muse spark" || id === "muse") return "meta";
  if (id === "maximo" || id === "maximo ai") return "maximo";
  if (id === "perplexity" || id === "pplx") return "perplexity";
  if (id === "ollama") return "ollama";
  if (id === "kilo") return "kilo";

  // Robust substring checks: match anywhere, any delimiter (space, -, _, /, ., :) and case-insensitive.
  // This keeps new GPT/OpenAI model variants (e.g. "gpt-5.5", "GPT-5.6 Luna", "openai/gpt-5.5", "GPT 5.5")
  // correctly mapped without hardcoding each release.
  if (id.includes("maximo")) return "maximo";
  if (id.includes("kilo")) return "kilo";
  if (id.includes("codex")) return "openai-codex";
  // Any model whose id contains gpt / openai / chatgpt is an OpenAI model, regardless of prefix/delimiter.
  if (id.includes("gpt") || id.includes("openai") || id.includes("chatgpt")) return "openai";
  // OpenAI reasoning family o1, o3, o4-mini etc. - handle "o1", "o3-mini", "openai/o1-preview", "o4" appearing anywhere
  // after a delimiter so "ollama" (o + 'l') does not false-positive.
  if (/(^|[\s\/\-_:.])o\d(\b|[\s\/\-_:.]|$)/.test(id) || /^o\d/.test(id)) return "openai";
  if (id.includes("claude")) return "claude";
  if (id.includes("anthropic")) return "anthropic";
  if (id.includes("gemini") || id.includes("google")) return "google";
  if (id.includes("grok") || id.includes("xai")) return "grok";
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("mistral") || id.includes("mixtral") || id.includes("codestral")) return "mistral";
  // Check ollama before generic llama/meta so "ollama" does not become "meta" via "llama" substring.
  if (id.includes("ollama")) return "ollama";
  if (id.includes("llama") || id.includes("meta") || id.includes("muse")) return "meta";
  if (id.includes("perplexity") || id.includes("pplx")) return "perplexity";

  return "unknown";
}
