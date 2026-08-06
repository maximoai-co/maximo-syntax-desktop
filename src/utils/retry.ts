// Synara-style retry: small inline retrying, auto retry 3× before surfacing failure.
// Mirrors synara's HttpClient.retryTransient({ times: 3 }) and workLog "OpenCode retrying" collapse.
export const DEFAULT_MAX_RETRIES = 3;
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

function messageOf(error: unknown): string {
  if (error instanceof Error) return `${error.message} ${String((error as unknown as Record<string, unknown>).cause ?? "")}`;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export function isTransientMessage(message: string): boolean {
  return TRANSIENT_PATTERNS.some((re) => re.test(message));
}

export function isNonRetryableMessage(message: string): boolean {
  return NON_RETRYABLE_PATTERNS.some((re) => re.test(message));
}

export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  // Explicit opt-out: synara marks wsTransport errors with retryable:false
  if (typeof error === "object" && error !== null && "retryable" in error && (error as Record<string, unknown>).retryable === false) return false;
  const msg = messageOf(error);
  if (isNonRetryableMessage(msg)) return false;
  if (isTransientMessage(msg)) return true;
  // Unknown errors are not retried by default to avoid hiding validation bugs.
  // Allow retry for TypeError: Failed to fetch style network errors where message may be empty but stack hints network.
  if (error instanceof TypeError && /fetch/i.test(msg)) return true;
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

// Convenience: wrap an async IPC/action so callers can show small "retrying 1/3" UI
// without stopping AI work, matching synara's workLog retry collapse.
export type RetryState = { attempt: number; max: number; message: string; delayMs: number } | null;
