// Small inline retrying: auto retry 5× before surfacing failure.
// Shape-agnostic: Maximo AI API can throw errors as string, Error, {message},
// {error}, {detail}, {cause}, nested JSON, or numeric HTTP status.
export const DEFAULT_MAX_RETRIES = 5;
export const DEFAULT_BASE_DELAY_MS = 800;
export const DEFAULT_MAX_DELAY_MS = 5000;
export const DEFAULT_FACTOR = 2;

export type RetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  signal?: AbortSignal;
  isRetryable?: (error: unknown) => boolean;
  onRetry?: (attempt: number, max: number, error: unknown, delayMs: number) => void;
};

// Synara treats network / timeout / 5xx / transient as retryable, but not auth/validation.
// This mirrors ProviderHealth's single retry for transient false negatives and
// workLog "Provider request failed; retrying." classification.
// TRANSIENT_PATTERNS are hints, not a hard allowlist — unknown shapes are still retried
// unless they match NON_RETRYABLE, matching synara's "retry unless permanentFailure".
const TRANSIENT_PATTERNS = [
  /network/i,
  /fetch failed/i,
  /failed to fetch/i,
  /load failed/i,
  /connection/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /ENETUNREACH/i,
  /EHOSTUNREACH/i,
  /timeout/i,
  /timed out/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /gateway/i,
  /overloaded/i,
  /rate limit/i,
  /rate_limit/i,
  /token_limit_exceeded/i,
  /429/,
  /5\d\d/,
];

const NON_RETRYABLE_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /not found.*project/i,
  /chat not found/i,
  /message not found/i,
  /invalid.*branch/i,
  /already exists/i,
  /enter a valid/i,
  /validation/i,
  /auth/i,
  /credential/i,
];

function collectMessages(error: unknown, seen: Set<unknown>, out: string[]): void {
  if (error == null || seen.has(error)) return;
  seen.add(error);
  if (typeof error === "string") {
    if (error.trim()) out.push(error);
    return;
  }
  if (typeof error === "number") {
    out.push(String(error));
    return;
  }
  if (error instanceof Error) {
    if (error.message) out.push(error.message);
    const cause = (error as unknown as Record<string, unknown>).cause;
    if (cause != null) collectMessages(cause, seen, out);
    // also inspect stack for network hints without spamming full stack
    if (error.stack && /fetch|network|timeout|ECONN/i.test(error.stack)) out.push(error.stack.slice(0, 400));
    return;
  }
  if (typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const keys = ["message", "error", "detail", "msg", "reason", "cause", "data", "description", "title", "statusText", "err", "errorMessage"];
    for (const k of keys) {
      if (k in rec && rec[k] != null) collectMessages(rec[k], seen, out);
    }
    // numeric status/code fields — important for Maximo AI API throwing {status: 429} or {code: "ECONNRESET"}
    for (const k of ["status", "statusCode", "code", "errorCode"]) {
      if (k in rec && rec[k] != null) {
        const v = rec[k];
        if (typeof v === "number" || typeof v === "string") out.push(String(v));
      }
    }
    // if none of the known keys produced output, fallback to JSON, but truncate
    if (out.length === 0) {
      try {
        const j = JSON.stringify(error);
        if (j && j !== "{}" && j !== "[]") out.push(j.slice(0, 800));
        else out.push(String(error).slice(0, 800));
      } catch {
        out.push(String(error).slice(0, 800));
      }
    }
    return;
  }
  out.push(String(error).slice(0, 800));
}

function messageOf(error: unknown): string {
  const parts: string[] = [];
  collectMessages(error, new Set(), parts);
  // dedupe fragments while preserving order
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
  }
  if (uniq.length === 0) {
    try {
      return JSON.stringify(error).slice(0, 800);
    } catch {
      return String(error).slice(0, 800);
    }
  }
  return uniq.join(" | ");
}

export function isTransientMessage(message: string): boolean {
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

export function isNonRetryableMessage(message: string): boolean {
  return NON_RETRYABLE_PATTERNS.some((re) => re.test(message));
}

function hasRetryableStatus(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;
  const candidates: unknown[] = [rec.status, rec.statusCode, rec.code, rec.errorCode, rec["status_code"]];
  // also check nested error object
  if (rec.error && typeof rec.error === "object") {
    const nested = rec.error as Record<string, unknown>;
    candidates.push(nested.status, nested.statusCode, nested.code);
  }
  for (const v of candidates) {
    if (typeof v === "number") {
      if (v === 429 || (v >= 500 && v <= 599)) return true;
      if (v === 408) return true;
    }
    if (typeof v === "string") {
      if (/^429$/.test(v) || /^5\d\d$/.test(v) || v === "408") return true;
      if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/i.test(v)) return true;
    }
  }
  return false;
}

export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  // Explicit opt-out: synara marks wsTransport errors with retryable:false
  if (typeof error === "object" && error !== null && "retryable" in error && (error as Record<string, unknown>).retryable === false) return false;
  // Explicit opt-in: retryable:true always retried even if message looks non-retryable? No, respect non-retryable first.
  const msg = messageOf(error);
  if (isNonRetryableMessage(msg)) return false;
  if (hasRetryableStatus(error)) return true;
  if (isTransientMessage(msg)) return true;
  // Generically handle Maximo AI API throwing any shape:
  // - TypeError/fetch style network errors
  if (error instanceof TypeError) return true;
  // - DOMException AbortError should NOT be retried (user cancelled) — but network fetch abort is retryable
  if (error instanceof DOMException && error.name === "AbortError") return false;
  // - Plain object without non-retryable marker and with some message — treat as transient
  //   This is the core "do not hardcode" fix: any Maximo AI API error shape that isn't
  //   explicitly auth/validation is retried, mirroring synara's retry-unless-permanent.
  //   We only exclude empty/falsy errors already handled.
  if (typeof error === "object" || typeof error === "string") {
    // if we have any message content and it wasn't classified non-retryable, retry it
    if (msg.trim().length > 0) return true;
  }
  return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => { clearTimeout(id); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function jitteredBackoff(attempt: number, base: number, max: number, factor: number): number {
  const exp = Math.min(max, base * Math.pow(factor, attempt - 1));
  // ±15% jitter like synara's policy
  const jitter = exp * 0.15 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? DEFAULT_MAX_RETRIES;
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const factor = options.factor ?? DEFAULT_FACTOR;
  const isRetryable = options.isRetryable ?? isRetryableError;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLast = attempt > retries;
      if (isLast || !isRetryable(error) || options.signal?.aborted) throw error;
      const delayMs = jitteredBackoff(attempt, base, max, factor);
      options.onRetry?.(attempt, retries, error, delayMs);
      await delay(delayMs, options.signal);
    }
  }
  throw lastError;
}

// Convenience: wrap an async IPC/action so callers can show small "retrying 1/5" UI
// without stopping AI work.
export type RetryState = { attempt: number; max: number; message: string; delayMs: number } | null;

export function getRetryMessage(error: unknown): string {
  const msg = messageOf(error);
  if (!msg) return "Connection issue — retrying";
  if (/token_limit_exceeded|tokens per minute|rate_limit_error|rate limit/i.test(msg)) {
    return "Rate limit reached — retrying shortly";
  }
  if (/fetch failed|failed to fetch|network|ECONNRESET|ETIMEDOUT/i.test(msg)) {
    return "Connection issue — retrying";
  }
  return msg.slice(0, 140) || "Connection issue — retrying";
}
