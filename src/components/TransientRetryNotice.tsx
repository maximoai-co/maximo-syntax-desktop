import { RefreshCw } from "lucide-react";

export type TransientRetryState = {
  attempt: number;
  max: number;
  message?: string;
} | null;

export type ProviderRetryState = NonNullable<TransientRetryState> & { threadId: string };

// Provider retries belong to a specific chat turn. Only surface that pill while
// that session is selected; background IPC retries remain app-wide.
export function visibleRetryNotice(
  providerRetry: ProviderRetryState | null,
  transientRetry: TransientRetryState,
  selectedThreadId: string | undefined | null,
): TransientRetryState {
  if (providerRetry && providerRetry.threadId === selectedThreadId) return providerRetry;
  return transientRetry;
}

export function TransientRetryNotice({ state, onDismiss }: { state: TransientRetryState; onDismiss?: () => void }) {
  if (!state) return null;
  const label = `Retrying ${state.attempt}/${state.max}`;
  const detail = state.message ? state.message.slice(0, 120) : "Connection issue — retrying";
  return (
    <div className="transient-retry-notice" role="status" aria-live="polite">
      <RefreshCw size={13} className="spin" aria-hidden="true" />
      <span className="transient-retry-label">{label}</span>
      <small className="transient-retry-detail" title={detail}>{detail}</small>
      {onDismiss && (
        <button type="button" className="transient-retry-dismiss" onClick={onDismiss} aria-label="Dismiss retry notice">×</button>
      )}
    </div>
  );
}
