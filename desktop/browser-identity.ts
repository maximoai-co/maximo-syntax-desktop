// FILE: browser-identity.ts
// Purpose: Derive a vanilla desktop-Chrome identity (UA string, client hints,
// Accept-Language) so bot-managed sites cannot flag the embedded browser as
// Electron or as an automation client.
// Layer: Desktop browser infrastructure

const ELECTRON_UA_TOKEN_PATTERN = /\sElectron\/\S+/gi;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strips Electron + host-app product tokens from the base user agent so pages
 * see a vanilla desktop Chrome UA. Google (and others) reject the default
 * Electron UA with `disallowed_useragent`.
 */
export function deriveChromeUserAgent(
  baseUserAgent: string,
  appProductTokens: readonly string[] = [],
): string {
  let userAgent = baseUserAgent.replace(ELECTRON_UA_TOKEN_PATTERN, "");
  for (const token of appProductTokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    userAgent = userAgent.replace(new RegExp(`\\s${escapeRegExp(trimmed)}\\/\\S+`, "gi"), "");
  }
  return userAgent.replace(/\s{2,}/g, " ").trim();
}

export function chromeMajorVersionFromUserAgent(userAgent: string): string | null {
  return /Chrome\/(\d+)/i.exec(userAgent)?.[1] ?? null;
}

/** Maps a Node platform id to the value Chrome reports in `Sec-CH-UA-Platform`. */
export function chromeClientHintPlatform(platform: string): string {
  switch (platform) {
    case "darwin": return "macOS";
    case "win32": return "Windows";
    default: return "Linux";
  }
}

export interface ChromeClientHintHeaders {
  "sec-ch-ua": string;
  "sec-ch-ua-mobile": string;
  "sec-ch-ua-platform": string;
}

/**
 * `setUserAgent` only changes the UA *string*; the User-Agent Client Hints
 * (`sec-ch-ua*`) still expose the Electron brand. Anti-bot stacks read those
 * hints, so they must be rewritten to match a real desktop Chrome. Returns
 * null when the Chrome version cannot be parsed.
 */
export function buildChromeClientHints(
  userAgent: string,
  platform: string,
): ChromeClientHintHeaders | null {
  const major = chromeMajorVersionFromUserAgent(userAgent);
  if (major === null) return null;
  return {
    "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not=A?Brand";v="24"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"${chromeClientHintPlatform(platform)}"`,
  };
}

/** Mobile client hints for device emulation presets (Android Chrome profile). */
export function buildMobileChromeClientHints(userAgent: string): ChromeClientHintHeaders | null {
  const major = chromeMajorVersionFromUserAgent(userAgent);
  if (major === null) return null;
  return {
    "sec-ch-ua": `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not=A?Brand";v="24"`,
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
  };
}

/** Desktop Chrome UA rewritten into its Android Chrome counterpart. */
export function deriveAndroidChromeUserAgent(userAgent: string): string | null {
  const major = chromeMajorVersionFromUserAgent(userAgent);
  if (major === null) return null;
  const platformToken = /\(([^)]*)\)/.exec(userAgent)?.[1];
  if (!platformToken) return null;
  // Example: Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko)
  //          Chrome/<major>.0.0.0 Mobile Safari/537.36
  return userAgent
    .replace(/\(([^)]*)\)/, "(Linux; Android 10; K)")
    .replace(/Chrome\/(\d+)(?:\.\d+)* /i, `Chrome/${major}.0.0.0 Mobile `)
    .replace(/\sX11;\s|\sUbuntu;/g, "")
    .replace("Safari/537.36", "Safari/537.36");
}

/** Builds a Chrome-style Accept-Language header from preferred languages. */
export function buildAcceptLanguageHeader(languages: readonly string[]): string | null {
  const normalized = languages.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) return null;
  return normalized
    .map((language, index) => {
      const quality = Math.max(0.1, 1 - index * 0.1);
      return `${language};q=${quality.toFixed(1)}`;
    })
    .join(",");
}
