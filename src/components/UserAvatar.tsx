import { useEffect, useState } from "react";

function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? "M"}${words.at(-1)?.[0] ?? "X"}`.toUpperCase();
  return (words[0]?.slice(0, 2) || "MX").toUpperCase();
}

function hueFromName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = name.charCodeAt(index) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 42% 42%)`;
}

export default function UserAvatar({
  url,
  name,
  size = 28,
  className = "",
}: {
  url?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  const label = name.trim() || "Account";
  const showPhoto = Boolean(url) && !failed;
  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        maxWidth: size,
        maxHeight: size,
        fontSize: Math.max(8, Math.round(size * 0.38)),
        background: showPhoto ? "transparent" : hueFromName(label),
      }}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img src={url!} alt="" width={size} height={size} draggable={false} onError={() => setFailed(true)} />
      ) : (
        initialsFromName(label)
      )}
    </span>
  );
}
