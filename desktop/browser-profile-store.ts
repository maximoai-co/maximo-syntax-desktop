import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  BrowserHistoryEntry,
  BrowserProfileSettings,
  BrowserProfileSettingsInput,
} from "./types.js";

const PROFILE_VERSION = 1;
const MAX_HISTORY_ENTRIES = 1_500;
const MAX_CREDENTIALS = 250;
const MAX_NEVER_SAVE_ORIGINS = 500;
const MAX_PERMISSION_ORIGINS = 500;

export interface BrowserCredentialEncryption {
  available(): Promise<boolean>;
  encrypt(plainText: string): Promise<Buffer>;
  decrypt(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt?: boolean }>;
}

interface StoredCredential {
  id: string;
  origin: string;
  username: string;
  encryptedPassword: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

interface BrowserProfileData {
  version: 1;
  settings: BrowserProfileSettings;
  history: BrowserHistoryEntry[];
  credentials: StoredCredential[];
  neverSaveOrigins: string[];
  permissions: Record<string, Record<string, "allow" | "block">>;
}

export interface DecryptedBrowserCredential {
  id: string;
  origin: string;
  username: string;
  password: string;
}

const DEFAULT_PROFILE_SETTINGS: BrowserProfileSettings = {
  savePasswords: true,
  askWhereToSaveDownloads: false,
  downloadDirectory: null,
};

function finiteTimestamp(value: unknown, fallback = Date.now()): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeFavicon(value: unknown): string | null {
  const text = cleanText(value, 64 * 1024);
  if (!text) return null;
  if (/^data:image\//i.test(text)) return text;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeBrowserOrigin(value: unknown): string | null {
  const text = cleanText(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeHistory(value: unknown): BrowserHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: BrowserHistoryEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Partial<BrowserHistoryEntry>;
    const url = cleanText(source.url, 8_192);
    if (!url || seen.has(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    } catch {
      continue;
    }
    seen.add(url);
    entries.push({
      url,
      title: cleanText(source.title, 512),
      faviconUrl: normalizeFavicon(source.faviconUrl),
      lastVisitedAt: finiteTimestamp(source.lastVisitedAt),
      visitCount: typeof source.visitCount === "number" && Number.isFinite(source.visitCount)
        ? Math.max(1, Math.min(1_000_000, Math.round(source.visitCount)))
        : 1,
    });
  }
  return entries.sort((left, right) => right.lastVisitedAt - left.lastVisitedAt).slice(0, MAX_HISTORY_ENTRIES);
}

function normalizeCredentials(value: unknown): StoredCredential[] {
  if (!Array.isArray(value)) return [];
  const entries: StoredCredential[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Partial<StoredCredential>;
    const origin = normalizeBrowserOrigin(source.origin);
    const username = cleanText(source.username, 512);
    const encryptedPassword = cleanText(source.encryptedPassword, 64 * 1024);
    if (!origin || !username || !encryptedPassword) continue;
    const key = `${origin}\n${username.toLocaleLowerCase("en-US")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const createdAt = finiteTimestamp(source.createdAt);
    entries.push({
      id: cleanText(source.id, 200) || randomUUID(),
      origin,
      username,
      encryptedPassword,
      createdAt,
      updatedAt: finiteTimestamp(source.updatedAt, createdAt),
      lastUsedAt: finiteTimestamp(source.lastUsedAt, createdAt),
    });
  }
  return entries.sort((left, right) => right.lastUsedAt - left.lastUsedAt).slice(0, MAX_CREDENTIALS);
}

function normalizePermissions(value: unknown): BrowserProfileData["permissions"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: BrowserProfileData["permissions"] = {};
  for (const [rawOrigin, rawPermissions] of Object.entries(value).slice(0, MAX_PERMISSION_ORIGINS)) {
    const origin = normalizeBrowserOrigin(rawOrigin);
    if (!origin || !rawPermissions || typeof rawPermissions !== "object" || Array.isArray(rawPermissions)) continue;
    const decisions: Record<string, "allow" | "block"> = {};
    for (const [permission, decision] of Object.entries(rawPermissions).slice(0, 100)) {
      const name = cleanText(permission, 100);
      if (name && (decision === "allow" || decision === "block")) decisions[name] = decision;
    }
    if (Object.keys(decisions).length > 0) output[origin] = decisions;
  }
  return output;
}

function normalizeProfile(value: unknown): BrowserProfileData {
  const source = value && typeof value === "object" ? value as Partial<BrowserProfileData> : {};
  const settings = source.settings && typeof source.settings === "object" ? source.settings : DEFAULT_PROFILE_SETTINGS;
  const neverSaveOrigins = Array.isArray(source.neverSaveOrigins)
    ? [...new Set(source.neverSaveOrigins.map(normalizeBrowserOrigin).filter((origin): origin is string => Boolean(origin)))].slice(0, MAX_NEVER_SAVE_ORIGINS)
    : [];
  const downloadDirectory = cleanText(settings.downloadDirectory, 4_096);
  return {
    version: PROFILE_VERSION,
    settings: {
      savePasswords: typeof settings.savePasswords === "boolean" ? settings.savePasswords : DEFAULT_PROFILE_SETTINGS.savePasswords,
      askWhereToSaveDownloads: typeof settings.askWhereToSaveDownloads === "boolean" ? settings.askWhereToSaveDownloads : DEFAULT_PROFILE_SETTINGS.askWhereToSaveDownloads,
      downloadDirectory: downloadDirectory ? resolve(downloadDirectory) : null,
    },
    history: normalizeHistory(source.history),
    credentials: normalizeCredentials(source.credentials),
    neverSaveOrigins,
    permissions: normalizePermissions(source.permissions),
  };
}

function emptyProfile(): BrowserProfileData {
  return normalizeProfile(null);
}

function historyScore(entry: BrowserHistoryEntry, query: string): number {
  const needle = query.toLocaleLowerCase("en-US");
  if (!needle) return entry.lastVisitedAt;
  let host = "";
  try { host = new URL(entry.url).hostname.toLocaleLowerCase("en-US"); } catch { /* Normalization already validated the URL. */ }
  const title = entry.title.toLocaleLowerCase("en-US");
  const url = entry.url.toLocaleLowerCase("en-US");
  const index = Math.min(...[host.indexOf(needle), title.indexOf(needle), url.indexOf(needle)].filter((value) => value >= 0));
  if (!Number.isFinite(index)) return Number.NEGATIVE_INFINITY;
  const prefix = host.startsWith(needle) ? 4_000 : title.startsWith(needle) ? 2_000 : url.startsWith(needle) ? 1_000 : 0;
  const recency = Math.max(0, 1_000 - (Date.now() - entry.lastVisitedAt) / 86_400_000);
  return prefix + recency + Math.min(500, entry.visitCount * 5) - index;
}

export class BrowserProfileStore {
  private readonly profilePath: string;
  private readonly temporaryPath: string;
  private data: BrowserProfileData = emptyProfile();
  private passwordStorageAvailable = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string, private readonly encryption: BrowserCredentialEncryption) {
    this.profilePath = join(userDataPath, "browser", "profile.json");
    this.temporaryPath = `${this.profilePath}.tmp`;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.profilePath), { recursive: true, mode: 0o700 });
    try {
      this.data = normalizeProfile(JSON.parse(await readFile(this.profilePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        const backup = `${this.profilePath}.corrupt-${Date.now()}`;
        await rename(this.profilePath, backup).catch(() => undefined);
      }
      this.data = emptyProfile();
      await this.persist();
    }
    this.passwordStorageAvailable = await this.encryption.available().catch(() => false);
    if (!this.passwordStorageAvailable && this.data.settings.savePasswords) {
      this.data.settings.savePasswords = false;
      await this.persist();
    }
  }

  settings(): BrowserProfileSettings {
    return { ...this.data.settings };
  }

  isPasswordStorageAvailable(): boolean {
    return this.passwordStorageAvailable;
  }

  historyCount(): number {
    return this.data.history.length;
  }

  credentialCount(): number {
    return this.data.credentials.length;
  }

  permissionCount(): number {
    return Object.values(this.data.permissions).reduce((total, permissions) => total + Object.keys(permissions).length, 0);
  }

  async updateSettings(input: BrowserProfileSettingsInput): Promise<void> {
    if (typeof input.savePasswords === "boolean") {
      this.data.settings.savePasswords = input.savePasswords && this.passwordStorageAvailable;
    }
    if (typeof input.askWhereToSaveDownloads === "boolean") {
      this.data.settings.askWhereToSaveDownloads = input.askWhereToSaveDownloads;
    }
    if (input.downloadDirectory === null) this.data.settings.downloadDirectory = null;
    else if (typeof input.downloadDirectory === "string" && input.downloadDirectory.trim()) {
      this.data.settings.downloadDirectory = resolve(input.downloadDirectory.trim().slice(0, 4_096));
    }
    await this.persist();
  }

  searchHistory(query: string, limit = 8): BrowserHistoryEntry[] {
    const boundedLimit = Math.max(1, Math.min(50, Math.round(limit)));
    return this.data.history
      .map((entry) => ({ entry, score: historyScore(entry, query.trim()) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => right.score - left.score || right.entry.lastVisitedAt - left.entry.lastVisitedAt)
      .slice(0, boundedLimit)
      .map(({ entry }) => ({ ...entry }));
  }

  async recordVisit(url: string, title: string, faviconUrl?: string | null): Promise<void> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
    parsed.hash = "";
    const normalizedUrl = parsed.toString();
    const existingIndex = this.data.history.findIndex((entry) => entry.url === normalizedUrl);
    const existing = existingIndex >= 0 ? this.data.history.splice(existingIndex, 1)[0] : undefined;
    const nextFavicon = faviconUrl === undefined ? existing?.faviconUrl ?? null : normalizeFavicon(faviconUrl);
    this.data.history.unshift({
      url: normalizedUrl,
      title: cleanText(title, 512) || existing?.title || parsed.hostname,
      faviconUrl: nextFavicon,
      lastVisitedAt: Date.now(),
      visitCount: Math.min(1_000_000, (existing?.visitCount ?? 0) + 1),
    });
    this.data.history = this.data.history.slice(0, MAX_HISTORY_ENTRIES);
    await this.persist();
  }

  async updateHistoryTitle(url: string, title: string): Promise<void> {
    const normalizedTitle = cleanText(title, 512);
    if (!normalizedTitle) return;
    let normalizedUrl = url;
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      normalizedUrl = parsed.toString();
    } catch { return; }
    const entry = this.data.history.find((candidate) => candidate.url === normalizedUrl);
    if (!entry || entry.title === normalizedTitle) return;
    entry.title = normalizedTitle;
    await this.persist();
  }

  async updateHistoryFavicon(url: string, faviconUrl: string): Promise<void> {
    const favicon = normalizeFavicon(faviconUrl);
    if (!favicon) return;
    let normalizedUrl = url;
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      normalizedUrl = parsed.toString();
    } catch { return; }
    const entry = this.data.history.find((candidate) => candidate.url === normalizedUrl);
    if (!entry || entry.faviconUrl === favicon) return;
    entry.faviconUrl = favicon;
    await this.persist();
  }

  shouldOfferPasswordSave(origin: string): boolean {
    const normalized = normalizeBrowserOrigin(origin);
    return Boolean(normalized && this.passwordStorageAvailable && this.data.settings.savePasswords && !this.data.neverSaveOrigins.includes(normalized));
  }

  credentialMetadata(origin: string, username: string): Omit<StoredCredential, "encryptedPassword"> | null {
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    const normalizedUsername = cleanText(username, 512).toLocaleLowerCase("en-US");
    if (!normalizedOrigin || !normalizedUsername) return null;
    const credential = this.data.credentials.find((entry) => entry.origin === normalizedOrigin && entry.username.toLocaleLowerCase("en-US") === normalizedUsername);
    if (!credential) return null;
    const { encryptedPassword: _encryptedPassword, ...metadata } = credential;
    return { ...metadata };
  }

  async lookupCredential(origin: string, username?: string): Promise<DecryptedBrowserCredential | null> {
    if (!this.passwordStorageAvailable || !this.data.settings.savePasswords) return null;
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    if (!normalizedOrigin) return null;
    const normalizedUsername = cleanText(username, 512).toLocaleLowerCase("en-US");
    const candidates = this.data.credentials
      .filter((entry) => entry.origin === normalizedOrigin && (!normalizedUsername || entry.username.toLocaleLowerCase("en-US") === normalizedUsername))
      .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
    const credential = candidates[0];
    if (!credential) return null;
    try {
      const decrypted = await this.encryption.decrypt(Buffer.from(credential.encryptedPassword, "base64"));
      if (decrypted.shouldReEncrypt) {
        credential.encryptedPassword = (await this.encryption.encrypt(decrypted.result)).toString("base64");
        credential.updatedAt = Date.now();
        await this.persist();
      }
      return {
        id: credential.id,
        origin: credential.origin,
        username: credential.username,
        password: decrypted.result,
      };
    } catch {
      this.data.credentials = this.data.credentials.filter((entry) => entry.id !== credential.id);
      await this.persist();
      return null;
    }
  }

  async saveCredential(origin: string, username: string, password: string): Promise<void> {
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    const normalizedUsername = cleanText(username, 512);
    if (!normalizedOrigin || !normalizedUsername || !password || password.length > 16_384 || !this.passwordStorageAvailable) {
      throw new Error("This credential cannot be saved securely.");
    }
    const now = Date.now();
    const encryptedPassword = (await this.encryption.encrypt(password)).toString("base64");
    const existing = this.data.credentials.find((entry) => entry.origin === normalizedOrigin && entry.username.toLocaleLowerCase("en-US") === normalizedUsername.toLocaleLowerCase("en-US"));
    if (existing) {
      existing.username = normalizedUsername;
      existing.encryptedPassword = encryptedPassword;
      existing.updatedAt = now;
      existing.lastUsedAt = now;
    } else {
      this.data.credentials.unshift({
        id: randomUUID(),
        origin: normalizedOrigin,
        username: normalizedUsername,
        encryptedPassword,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
      });
      this.data.credentials = this.data.credentials.slice(0, MAX_CREDENTIALS);
    }
    this.data.neverSaveOrigins = this.data.neverSaveOrigins.filter((entry) => entry !== normalizedOrigin);
    await this.persist();
  }

  async markCredentialUsed(id: string): Promise<void> {
    const credential = this.data.credentials.find((entry) => entry.id === id);
    if (!credential) return;
    credential.lastUsedAt = Date.now();
    await this.persist();
  }

  async neverSavePasswordsFor(origin: string): Promise<void> {
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    if (!normalizedOrigin) return;
    this.data.neverSaveOrigins = [normalizedOrigin, ...this.data.neverSaveOrigins.filter((entry) => entry !== normalizedOrigin)].slice(0, MAX_NEVER_SAVE_ORIGINS);
    await this.persist();
  }

  permission(origin: string, name: string): "allow" | "block" | null {
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    if (!normalizedOrigin) return null;
    return this.data.permissions[normalizedOrigin]?.[cleanText(name, 100)] ?? null;
  }

  async setPermission(origin: string, name: string, decision: "allow" | "block"): Promise<void> {
    const normalizedOrigin = normalizeBrowserOrigin(origin);
    const normalizedName = cleanText(name, 100);
    if (!normalizedOrigin || !normalizedName) return;
    this.data.permissions[normalizedOrigin] = {
      ...(this.data.permissions[normalizedOrigin] ?? {}),
      [normalizedName]: decision,
    };
    await this.persist();
  }

  async clear(input: { history?: boolean; passwords?: boolean; permissions?: boolean }): Promise<void> {
    if (input.history) this.data.history = [];
    if (input.passwords) {
      this.data.credentials = [];
      this.data.neverSaveOrigins = [];
    }
    if (input.permissions) this.data.permissions = {};
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private persist(): Promise<void> {
    const payload = `${JSON.stringify(this.data)}\n`;
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await writeFile(this.temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
      await rename(this.temporaryPath, this.profilePath);
    });
    return this.writeQueue;
  }
}
