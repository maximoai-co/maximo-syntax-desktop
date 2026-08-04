import type { KeyboardEvent } from "react";
import { Sparkles, X } from "lucide-react";
import type { WhatsNewEntry } from "../../desktop/types";

export interface WhatsNewPopoutCardProps {
  entry: WhatsNewEntry;
  currentVersion: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * Synara-style bottom-left "New · vX" card. Body opens release notes;
 * the X dismisses without opening the dialog.
 */
export default function WhatsNewPopoutCard({ entry, currentVersion, onOpen, onDismiss }: WhatsNewPopoutCardProps) {
  const primary = entry.features[0]?.title ?? entry.title ?? `What's new in v${currentVersion}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <div className="whats-new-popout" role="complementary" aria-label={`What's new in v${currentVersion}`}>
      <div
        className="whats-new-popout-card"
        role="button"
        tabIndex={0}
        aria-label={`Open What's new in v${currentVersion}`}
        onClick={onOpen}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          className="whats-new-popout-dismiss"
          aria-label="Dismiss What's new"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
        >
          <X size={13} />
        </button>
        <div className="whats-new-popout-hero" aria-hidden="true">
          <Sparkles size={28} />
        </div>
        <div className="whats-new-popout-body">
          <p className="whats-new-popout-kicker">New · v{currentVersion}</p>
          <p className="whats-new-popout-title">{primary}</p>
          <p className="whats-new-popout-cta">Find out what&rsquo;s new →</p>
        </div>
      </div>
    </div>
  );
}
