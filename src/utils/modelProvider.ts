export type ModelProvider = "maximo" | "openai" | "openai-codex" | "claude" | "anthropic" | "google" | "grok" | "deepseek" | "mistral" | "meta" | "perplexity" | "ollama" | "unknown";

export function modelProvider(modelId: string | undefined | null): ModelProvider {
  const raw = (modelId ?? "").trim();
  const id = raw.toLowerCase();
  if (!id || id === "default" || id === "cli default" || id === "default (recommended)") return "maximo";
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
  if (/^maximo-(pandora|atlas|astra|alpha)/.test(id) || /(^|[\s-_])maximo/.test(id)) return "maximo";
  if (/^gpt-?/.test(id) || /^o[0-9](-|$)/.test(id) || /^chatgpt/.test(id) || /(^|[\s-_])gpt-?[0-9]/.test(id)) return "openai";
  if (/codex/.test(id)) return "openai-codex";
  if (/^claude/.test(id) || /(^|[\s-_])claude/.test(id)) return "claude";
  if (/^anthropic/.test(id) || /(^|[\s-_])anthropic/.test(id)) return "anthropic";
  if (/^gemini/.test(id) || /^google/.test(id) || /(^|[\s-_])gemini/.test(id)) return "google";
  if (/^grok/.test(id) || /^xai/.test(id) || /(^|[\s-_])grok/.test(id)) return "grok";
  if (/^deepseek/.test(id) || /(^|[\s-_])deepseek/.test(id)) return "deepseek";
  if (/^(mistral|mixtral|codestral)/.test(id) || /(^|[\s-_])mistral/.test(id)) return "mistral";
  if (/^(llama|meta|muse)/.test(id) || /(^|[\s-_])llama/.test(id) || /(^|[\s-_])meta/.test(id) || /(^|[\s-_])muse/.test(id)) return "meta";
  if (/^perplexity|^pplx/.test(id) || /(^|[\s-_])perplexity/.test(id)) return "perplexity";
  if (/^ollama/.test(id) || /(^|[\s-_])ollama/.test(id)) return "ollama";
  return "unknown";
}
