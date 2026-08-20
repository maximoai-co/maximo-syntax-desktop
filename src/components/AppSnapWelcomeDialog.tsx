import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

const APP_SNAP_WELCOME_STORAGE_KEY = "maximo-syntax:appsnap-welcome:v1";

function readAcknowledged(): boolean {
  try {
    const raw = window.localStorage.getItem(APP_SNAP_WELCOME_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { acknowledged?: unknown };
    return parsed.acknowledged === true;
  } catch {
    return false;
  }
}

export default function AppSnapWelcomeDialog({ onSetup }: { onSetup: () => void }) {
  const [acknowledged, setAcknowledged] = useState(readAcknowledged);
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (acknowledged) return;
    const bridge = window.maximoDesktop?.appSnap;
    if (!bridge) return;
    let disposed = false;
    void bridge
      .getState()
      .then((state) => {
        if (!disposed && state.supported) setOpen(true);
      })
      .catch((error) => {
        console.warn("[appsnap] Could not check welcome-dialog support", error);
      });
    return () => {
      disposed = true;
    };
  }, [acknowledged]);

  const acknowledge = () => {
    setOpen(false);
    setAcknowledged(true);
    try {
      window.localStorage.setItem(APP_SNAP_WELCOME_STORAGE_KEY, JSON.stringify({ acknowledged: true }));
    } catch {
      // Ignore quota or private-mode failures; the sheet can return next launch.
    }
  };

  const openSettings = () => {
    acknowledge();
    onSetup();
  };

  if (!open || acknowledged) return null;

  return (
    <div className="modal-backdrop appsnap-welcome-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) acknowledge(); }}>
      <section
        ref={sheetRef}
        className="glass-panel appsnap-welcome-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appsnap-welcome-title"
        tabIndex={-1}
      >
        <span className="appsnap-welcome-hero" aria-hidden>
          <Camera size={28} />
        </span>
        <h2 id="appsnap-welcome-title">Maximo Syntax AppSnaps are live!</h2>
        <p>
          Press both Option keys (⌥&thinsp;⌥) to snap any app&rsquo;s window into the chat
          you&rsquo;re working in.
        </p>
        <div className="appsnap-welcome-actions">
          <button type="button" className="secondary-button" onClick={acknowledge}>Not now</button>
          <button type="button" className="primary-button compact" onClick={openSettings}>Set up AppSnap</button>
        </div>
      </section>
    </div>
  );
}
