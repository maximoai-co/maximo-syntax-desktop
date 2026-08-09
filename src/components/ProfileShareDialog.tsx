import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, Download, Linkedin, MessageCircle, RefreshCw, X } from "lucide-react";
import logoUrl from "../assets/maximoai-logo.svg";

export const PROFILE_SHARE_CARD_WIDTH = 860;
export const PROFILE_SHARE_CARD_HEIGHT = 440;

export interface ProfileShareData {
  name: string;
  handle: string;
  initials: string;
  avatarColor: string;
  lifetimeTokens: string;
  peakDay: string;
  currentStreak: string;
  longestStreak: string;
  topProvider: string;
  topProviderLogo: string | null;
  topProviderPercent: number | null;
  heatmap: ReadonlyArray<number | null>;
}

type ShareTarget = "x" | "linkedin" | "reddit";
type ShareAction = ShareTarget | "copy" | "save";

const SHARE_URL = "https://maximoai.co";
const SHARE_CARD_HEATMAP_COLORS = ["#f5f6f7", "#d8efe9", "#afe0d4", "#80cebd", "#4eb6a4"];

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function drawAvatar(context: CanvasRenderingContext2D, initials: string, color: string, x: number, y: number, radius: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `500 ${Math.max(12, Math.round(radius * 0.62))}px Manrope, -apple-system, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(initials, x, y + 1);
  context.textAlign = "left";
}

function fitCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (context.measureText(value).width <= maxWidth) return value;
  let result = value;
  while (result.length > 1 && context.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}

function loadImage(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

function loadLogo(): Promise<HTMLImageElement | null> {
  return loadImage(logoUrl);
}

async function renderProfileShareCard(data: ProfileShareData): Promise<Blob | null> {
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_SHARE_CARD_WIDTH * scale;
  canvas.height = PROFILE_SHARE_CARD_HEIGHT * scale;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PROFILE_SHARE_CARD_WIDTH, PROFILE_SHARE_CARD_HEIGHT);

  const padding = 48;
  drawAvatar(context, data.initials, data.avatarColor, padding + 28, 72, 28);
  context.fillStyle = "#172033";
  context.font = "500 23px Manrope, -apple-system, sans-serif";
  context.textBaseline = "alphabetic";
  context.fillText(fitCanvasText(context, data.name, 360), padding + 72, 69);
  context.fillStyle = "#94a3b8";
  context.font = "400 15px Manrope, -apple-system, sans-serif";
  context.fillText(fitCanvasText(context, data.handle, 360), padding + 72, 92);

  const logo = await loadLogo();
  if (logo) context.drawImage(logo, PROFILE_SHARE_CARD_WIDTH - padding - 126, 48, 30, 30);
  context.fillStyle = "#475569";
  context.font = "400 18px Manrope, -apple-system, sans-serif";
  context.fillText("Maximo Syntax", PROFILE_SHARE_CARD_WIDTH - padding - 88, 69);

  const cellSize = 16;
  const cellGap = 4;
  const heatmapX = padding;
  const heatmapY = 131;
  data.heatmap.forEach((level, index) => {
    if (level === null) return;
    const column = Math.floor(index / 7);
    const row = index % 7;
    roundedRect(context, heatmapX + column * (cellSize + cellGap), heatmapY + row * (cellSize + cellGap), cellSize, cellSize, 4);
    context.fillStyle = SHARE_CARD_HEATMAP_COLORS[Math.max(0, Math.min(4, level))] ?? SHARE_CARD_HEATMAP_COLORS[0]!;
    context.fill();
  });

  const statTop = 319;
  const statWidth = (PROFILE_SHARE_CARD_WIDTH - padding * 2) / 5;
  const providerLogo = data.topProviderLogo ? await loadImage(data.topProviderLogo) : null;
  const stats = [
    [data.lifetimeTokens, "lifetime tokens"],
    [data.peakDay, "peak day"],
    [data.currentStreak, "current streak"],
    [data.longestStreak, "longest streak"],
    [data.topProviderPercent === null ? "—" : `${data.topProviderPercent}%`, "top provider"],
  ] as const;
  stats.forEach(([value, label], index) => {
    const x = padding + statWidth * index;
    context.fillStyle = "#172033";
    context.font = "400 22px Manrope, -apple-system, sans-serif";
    const valueX = index === 4 && providerLogo ? x + 24 : x;
    if (index === 4 && providerLogo) context.drawImage(providerLogo, x, statTop - 18, 17, 17);
    context.fillText(fitCanvasText(context, value, statWidth - (valueX - x) - 14), valueX, statTop);
    context.fillStyle = "#94a3b8";
    context.font = "400 13px Manrope, -apple-system, sans-serif";
    context.fillText(label, x, statTop + 26);
  });

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (window.maximoDesktop?.copyImageToClipboard && await window.maximoDesktop.copyImageToClipboard(bytes)) return true;
  } catch {
    // Fall through to the browser clipboard path when the native bridge is unavailable.
  }
  try {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000);
}

function shareIntentUrl(target: ShareTarget, data: ProfileShareData): string {
  const text = `My Maximo Syntax activity: ${data.lifetimeTokens} lifetime tokens and ${data.currentStreak} current streak.`;
  if (target === "x") return `https://x.com/intent/tweet?text=${encodeURIComponent(`${text} ${SHARE_URL}`)}`;
  if (target === "linkedin") return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}`;
  return `https://www.reddit.com/submit?url=${encodeURIComponent(SHARE_URL)}&title=${encodeURIComponent("My Maximo Syntax activity")}`;
}

function ShareCard({ data }: { data: ProfileShareData }) {
  return <div className="profile-share-card">
    <div className="profile-share-card-header">
      <div className="profile-share-card-identity"><span className="profile-share-card-avatar" style={{ background: data.avatarColor }}>{data.initials}</span><span><strong>{data.name}</strong><small>{data.handle}</small></span></div>
      <div className="profile-share-card-brand"><img src={logoUrl} alt="" /><span>Maximo Syntax</span></div>
    </div>
    <div className="profile-share-card-heatmap">{data.heatmap.map((level, index) => <span className={level === null ? "empty" : `level-${Math.max(0, Math.min(4, level))}`} key={index} />)}</div>
    <div className="profile-share-card-stats">
      <ShareCardStat value={data.lifetimeTokens} label="lifetime tokens" />
      <ShareCardStat value={data.peakDay} label="peak day" />
      <ShareCardStat value={data.currentStreak} label="current streak" />
      <ShareCardStat value={data.longestStreak} label="longest streak" />
      <ShareCardStat value={data.topProviderPercent === null ? "—" : `${data.topProviderPercent}%`} label="top provider" icon={data.topProviderLogo ? <img className="profile-share-provider-logo" src={data.topProviderLogo} alt="" draggable={false} /> : undefined} />
    </div>
  </div>;
}

function ShareCardStat({ value, label, icon }: { value: string; label: string; icon?: ReactNode }) {
  return <div className="profile-share-card-stat"><strong>{icon}{value}</strong><span>{label}</span></div>;
}

export default function ProfileShareDialog({ open, data, onClose }: { open: boolean; data: ProfileShareData; onClose: () => void }) {
  const [busy, setBusy] = useState<ShareAction | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setStatus(null);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;

  const run = async (action: ShareAction, work: () => Promise<void>) => {
    setBusy(action);
    setStatus(null);
    try {
      await work();
    } catch {
      setStatus("Something went wrong. Please try again or use Save.");
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = () => void run("copy", async () => {
    const blob = await renderProfileShareCard(data);
    setStatus(blob && await copyImageToClipboard(blob) ? "Copied image to clipboard." : "Image copy unavailable. Use Save instead.");
  });

  const handleSocialShare = (target: ShareTarget) => void run(target, async () => {
    const blob = await renderProfileShareCard(data);
    const copied = blob ? await copyImageToClipboard(blob) : false;
    const error = await window.maximoDesktop.openPath(shareIntentUrl(target, data));
    if (error) throw new Error(error);
    setStatus(copied ? "Image copied to clipboard — paste it into your post." : "Composer opened. Use Save to attach the image.");
  });

  const handleSave = () => void run("save", async () => {
    const blob = await renderProfileShareCard(data);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    downloadBlob(blob, `maximo-syntax-stats-${new Date().toISOString().slice(0, 10)}.png`);
    setStatus("Saved PNG to your downloads.");
  });

  const disabled = busy !== null;
  return createPortal(
    <div className="profile-share-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="profile-share-modal glass-panel" role="dialog" aria-modal="true" aria-labelledby="profile-share-title">
        <header className="profile-share-header"><h2 id="profile-share-title">Share your activity</h2><button type="button" className="profile-share-close" onClick={onClose} disabled={disabled} aria-label="Close share dialog"><X size={17} /></button></header>
        <div className="profile-share-preview"><ShareCard data={data} /></div>
        <div className="profile-share-actions">
          <ShareActionButton label="Copy" ariaLabel="Copy stat card" disabled={disabled} busy={busy === "copy"} onClick={handleCopy}><Copy size={20} /></ShareActionButton>
          <ShareActionButton label="X" disabled={disabled} busy={busy === "x"} onClick={() => handleSocialShare("x")}><strong className="profile-share-x-icon">𝕏</strong></ShareActionButton>
          <ShareActionButton label="LinkedIn" disabled={disabled} busy={busy === "linkedin"} onClick={() => handleSocialShare("linkedin")}><Linkedin size={20} /></ShareActionButton>
          <ShareActionButton label="Reddit" disabled={disabled} busy={busy === "reddit"} onClick={() => handleSocialShare("reddit")}><MessageCircle size={20} /></ShareActionButton>
          <ShareActionButton label="Save" ariaLabel="Save stat card" disabled={disabled} busy={busy === "save"} onClick={handleSave}><Download size={20} /></ShareActionButton>
        </div>
        <p className="profile-share-status" role="status">{status ?? ""}</p>
      </section>
    </div>,
    document.body,
  );
}

function ShareActionButton({ label, ariaLabel, disabled, busy, onClick, children }: { label: string; ariaLabel?: string; disabled: boolean; busy: boolean; onClick: () => void; children: ReactNode }) {
  return <div className="profile-share-action"><button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel ?? `Share to ${label}`}>{busy ? <RefreshCw size={20} className="spin" /> : children}</button><span>{label}</span></div>;
}
