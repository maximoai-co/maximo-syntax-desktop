import { memo, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Share2, ExternalLink, Copy, X, Maximize2, Check } from "lucide-react";

/** Guess filename from URL for download */
function filenameFromUrl(url: string, alt?: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "";
    if (last && last.includes(".")) return last;
  } catch {}
  const safeAlt = (alt || "generated-image").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "generated-image";
  return `${safeAlt}.png`;
}

async function downloadImage(url: string, alt?: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filenameFromUrl(url, alt);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    return true;
  } catch {
    // Fallback: open in new tab (still lets user save)
    try {
      window.open(url, "_blank", "noopener");
      return false;
    } catch { return false; }
  }
}

async function shareImage(url: string, alt?: string) {
  const title = alt || "Generated image";
  // Try native share with file if possible
  try {
    if (navigator.share) {
      // Try file share if we can fetch blob
      try {
        const res = await fetch(url, { mode: "cors" });
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], filenameFromUrl(url, alt), { type: blob.type || "image/png" });
          // @ts-ignore - canShare may not be typed with files
          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({ title, text: title, files: [file] });
            return true;
          }
        }
      } catch {}
      // fallback to url share
      await navigator.share({ title, text: title, url });
      return true;
    }
  } catch {}
  // Fallback: copy link
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch { return false; }
  }
}

function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // lock scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(src);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }, [src]);

  const onDownload = useCallback(async () => {
    setDownloading(true);
    await downloadImage(src, alt);
    setDownloading(false);
  }, [src, alt]);

  const onShare = useCallback(async () => {
    await shareImage(src, alt);
  }, [src, alt]);

  const onOpen = useCallback(() => {
    try {
      // Use Electron shell.openExternal via window.open fallback
      window.open(src, "_blank", "noopener");
    } catch {}
  }, [src]);

  return createPortal(
    <div className="md-img-lightbox" role="dialog" aria-modal="true" aria-label={alt || "Image preview"} onClick={onClose}>
      {/* backdrop */}
      <div className="md-img-lightbox-backdrop" />
      {/* glass glow behind image - 2026 liquid glass */}
      <div className="md-img-lightbox-glow" aria-hidden="true" />
      <button type="button" className="md-img-lightbox-close" onClick={onClose} aria-label="Close preview">
        <X size={18} />
      </button>

      <div className="md-img-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        <img
          className="md-img-lightbox-img"
          src={src}
          alt={alt || "Generated image"}
          draggable={false}
        />
        {/* Caption + actions — liquid glass pill */}
        <div className="md-img-lightbox-bar">
          <div className="md-img-lightbox-caption">
            <span className="md-img-lightbox-caption-title">{alt || "Generated image"}</span>
            <span className="md-img-lightbox-caption-hint">Click backdrop to close · Esc</span>
          </div>
          <div className="md-img-lightbox-actions">
            <button type="button" className="md-img-lightbox-action" onClick={onCopy} title={copied ? "Copied link" : "Copy link"}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" className="md-img-lightbox-action" onClick={onShare} title="Share">
              <Share2 size={16} />
              <span>Share</span>
            </button>
            <button type="button" className="md-img-lightbox-action primary" onClick={onDownload} title="Download" disabled={downloading}>
              <Download size={16} />
              <span>{downloading ? "…": "Download"}</span>
            </button>
            <button type="button" className="md-img-lightbox-action ghost" onClick={onOpen} title="Open in browser">
              <ExternalLink size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface MarkdownImageProps {
  src?: string;
  alt?: string;
  title?: string;
}

function MarkdownImage({ src, alt, title }: MarkdownImageProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1600);
  }, []);

  const onDownload = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!src) return;
    const ok = await downloadImage(src, alt);
    showToast(ok ? "Downloaded" : "Opened in browser");
  }, [src, alt, showToast]);

  const onShare = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!src) return;
    const ok = await shareImage(src, alt);
    showToast(ok ? "Shared / copied link" : "Copy failed");
  }, [src, alt, showToast]);

  const onCopy = useCallback(async (e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!src) return;
    try {
      await navigator.clipboard.writeText(src);
      showToast("Link copied");
    } catch {
      showToast("Copy failed");
    }
  }, [src, showToast]);

  const onOpen = useCallback((e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (!src) return;
    try { window.open(src, "_blank", "noopener"); } catch {}
  }, [src]);

  if (!src) return null;

  // Derive a nice caption from alt, fallback
  const caption = alt?.trim() || title?.trim() || "Generated image";
  // Short caption for the bar — prevents long prompts pushing buttons
  const barCaption = caption.length > 72 ? caption.slice(0, 72).trimEnd() + "…" : caption;

  return (
    <>
      <figure className="md-gen-image" data-loaded={loaded ? "true" : "false"} data-error={error ? "true" : "false"}>
        <div className="md-gen-image-frame" onClick={() => !error && setOpen(true)} role={error ? undefined : "button"} tabIndex={error ? -1 : 0} onKeyDown={(e) => { if ((e.key==="Enter"||e.key===" ") && !error) { e.preventDefault(); setOpen(true); } }} aria-label={error ? undefined : `Preview: ${caption}`}>
          {/* skeleton */}
          {!loaded && !error && <div className="md-gen-image-skeleton" aria-hidden="true" />}
          <img
            className="md-gen-image-el"
            src={src}
            alt={caption}
            title={title || caption}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            draggable={false}
          />
          {/* gradient scrim for text legibility */}
          <div className="md-gen-image-scrim" aria-hidden="true" />
          {/* bottom glass actions — hover/focus reveal, always visible on touch */}
          <div className="md-gen-image-actions" onClick={(e) => e.stopPropagation()}>
            <div className="md-gen-image-actions-left">
              <span className="md-gen-image-caption" title={caption}>{barCaption}</span>
            </div>
            <div className="md-gen-image-actions-right">
              <button type="button" className="md-gen-image-btn" onClick={() => setOpen(true)} aria-label="Preview" title="Preview">
                <Maximize2 size={14} />
              </button>
              <button type="button" className="md-gen-image-btn" onClick={onCopy} aria-label="Copy link" title="Copy link">
                <Copy size={14} />
              </button>
              <button type="button" className="md-gen-image-btn" onClick={onShare} aria-label="Share" title="Share">
                <Share2 size={14} />
              </button>
              <button type="button" className="md-gen-image-btn primary" onClick={onDownload} aria-label="Download" title="Download">
                <Download size={14} />
              </button>
              <button type="button" className="md-gen-image-btn ghost" onClick={onOpen} aria-label="Open externally" title="Open">
                <ExternalLink size={14} />
              </button>
            </div>
          </div>
          {/* centered preview cue */}
          <span className="md-gen-image-expand" aria-hidden="true">
            <Maximize2 size={16} /> Preview
          </span>
          {error && (
            <div className="md-gen-image-error">
              <span>Image failed to load</span>
              <a href={src} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Open original</a>
            </div>
          )}
        </div>
        {/* toast */}
        {toast && <figcaption className="md-gen-image-toast" role="status" aria-live="polite">{toast}</figcaption>}
      </figure>

      {open && <Lightbox src={src} alt={caption} onClose={() => setOpen(false)} />}
    </>
  );
}

export default memo(MarkdownImage);
