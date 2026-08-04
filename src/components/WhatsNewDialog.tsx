import { useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import type { WhatsNewEntry } from "../../desktop/types";

export interface WhatsNewDialogProps {
  open: boolean;
  currentVersion: string;
  currentEntry: WhatsNewEntry | null;
  allEntries: readonly WhatsNewEntry[];
  onClose: () => void;
  onOpenReleaseUrl?: (url: string) => void;
}

type View = "current" | "changelog";

export default function WhatsNewDialog({
  open,
  currentVersion,
  currentEntry,
  allEntries,
  onClose,
  onOpenReleaseUrl,
}: WhatsNewDialogProps) {
  const [view, setView] = useState<View>("current");
  const [expanded, setExpanded] = useState<string | null>(currentEntry?.version ?? null);

  if (!open || !currentEntry) return null;

  return (
    <div className="modal-backdrop whats-new-backdrop" role="presentation" onClick={onClose}>
      <div
        className="whats-new-dialog glass-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="whats-new-dialog-header">
          {view === "current" ? (
            <div className="whats-new-dialog-heading">
              <span className="whats-new-dialog-mark" aria-hidden="true"><Sparkles size={18} /></span>
              <div>
                <h2 id="whats-new-title">What&rsquo;s new?</h2>
                <p>
                  v{currentVersion}
                  {currentEntry.date ? <> · {currentEntry.date}</> : null}
                </p>
              </div>
            </div>
          ) : (
            <div className="whats-new-dialog-heading">
              <button type="button" className="whats-new-icon-button" onClick={() => setView("current")} aria-label="Back to What's new">
                <ArrowLeft size={15} />
              </button>
              <div>
                <h2 id="whats-new-title">Complete changelog</h2>
                <p>Every release, newest first.</p>
              </div>
            </div>
          )}
        </header>

        <div className="whats-new-dialog-body">
          {view === "current" ? (
            <div className="whats-new-feature-list">
              {currentEntry.summary && <p className="whats-new-summary">{currentEntry.summary}</p>}
              {currentEntry.features.map((feature) => (
                <article className="whats-new-feature" key={feature.id}>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="whats-new-changelog">
              {allEntries.map((entry) => {
                const isOpen = expanded === entry.version;
                return (
                  <section className={`whats-new-changelog-item ${isOpen ? "open" : ""}`} key={entry.version}>
                    <button
                      type="button"
                      className="whats-new-changelog-toggle"
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : entry.version)}
                    >
                      <span>
                        <strong>v{entry.version}</strong>
                        {entry.date ? <small>{entry.date}</small> : null}
                      </span>
                      <ChevronDown size={14} />
                    </button>
                    {isOpen && (
                      <div className="whats-new-changelog-body">
                        {entry.features.map((feature) => (
                          <article key={feature.id}>
                            <strong>{feature.title}</strong>
                            <p>{feature.description}</p>
                          </article>
                        ))}
                        {entry.releaseUrl && onOpenReleaseUrl && (
                          <button type="button" className="whats-new-link-button" onClick={() => onOpenReleaseUrl(entry.releaseUrl!)}>
                            View on GitHub
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {view === "current" && (
          <footer className="whats-new-dialog-footer">
            <button type="button" className="secondary-button" onClick={() => { setExpanded(currentEntry.version); setView("changelog"); }}>
              View changelog <ArrowRight size={13} />
            </button>
            <div className="whats-new-dialog-footer-actions">
              {currentEntry.releaseUrl && onOpenReleaseUrl && (
                <button type="button" className="secondary-button" onClick={() => onOpenReleaseUrl(currentEntry.releaseUrl!)}>
                  GitHub release
                </button>
              )}
              <button type="button" className="primary-button compact" onClick={onClose}>
                Got it
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
