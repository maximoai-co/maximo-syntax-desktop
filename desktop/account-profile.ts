import { readGlobalConfig, readLocalAccountStatus, updateGlobalConfig } from "./auth-service.js";
import type { AccountProfile, AccountProfileActionResult, AccountProfileUpdate, AccountStatus } from "./types.js";

type JsonObject = Record<string, unknown>;

const MAXIMO_PROFILE_URL = "https://api.maximoai.co/syntax/auth/profile";
const MAXIMO_PHOTO_URL = "https://api.maximoai.co/syntax/auth/profile/photo";
const MYTABULON_PROFILE_URL = "https://api.mytabulon.com/v1/profile";
const MYTABULON_PHOTO_URL = "https://api.mytabulon.com/v1/profile/photo";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function localProfile(status: AccountStatus | null): AccountProfile {
  return {
    provider: "local",
    editable: false,
    email: status?.email,
    displayName: status?.displayName,
    username: status?.username,
    photoUrl: status?.photoUrl,
  };
}

async function credentials(): Promise<{
  provider: "maximoai" | "mytabulon" | null;
  apiKey?: string;
  config: JsonObject;
}> {
  const config = await readGlobalConfig();
  const apiKey = text(config.maximoApiKey);
  const provider = text(config.openAIProvider);
  if (provider === "mytabulon" && apiKey) return { provider: "mytabulon", apiKey, config };
  if ((provider === "maximoai" || /maximoai?\.co/i.test(text(config.openAIBaseUrl) ?? "")) && apiKey) {
    return { provider: "maximoai", apiKey, config };
  }
  return { provider: null, config };
}

function profileFromPayload(provider: "maximoai" | "mytabulon", payload: JsonObject): AccountProfile {
  const user = asObject(payload.user) ?? asObject(payload.profile) ?? payload;
  const firstName = text(user.first_name) ?? text(user.firstName);
  const lastName = text(user.last_name) ?? text(user.lastName);
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const displayName =
    text(user.display_name) ??
    text(user.displayName) ??
    text(user.full_name) ??
    (joinedName || undefined) ??
    text(user.username);
  return {
    provider,
    editable: true,
    id: text(user.id),
    email: text(user.email),
    username: text(user.username),
    displayName,
    firstName,
    lastName,
    photoUrl: text(user.profile_photo_url) ?? text(user.profilePhotoUrl),
    phone: text(user.phone),
    bio: text(user.bio),
    twitterUsername: text(user.twitter_username) ?? text(user.twitterUsername),
    telegramUsername: text(user.telegram_username) ?? text(user.telegramUsername),
    socialLinkedin: text(user.social_linkedin) ?? text(user.socialLinkedin),
    socialTwitter: text(user.social_twitter) ?? text(user.socialTwitter),
    socialFacebook: text(user.social_facebook) ?? text(user.socialFacebook),
    socialInstagram: text(user.social_instagram) ?? text(user.socialInstagram),
    socialYoutube: text(user.social_youtube) ?? text(user.socialYoutube),
    socialTiktok: text(user.social_tiktok) ?? text(user.socialTiktok),
  };
}

async function persistIdentity(provider: "maximoai" | "mytabulon", profile: AccountProfile): Promise<void> {
  await updateGlobalConfig((current) => {
    const next = { ...current };
    if (provider === "mytabulon") {
      const previous = asObject(current.mytabulonAccount) ?? {};
      next.mytabulonAccount = {
        ...previous,
        emailAddress: profile.email ?? previous.emailAddress,
        displayName: profile.displayName ?? previous.displayName,
        username: profile.username ?? previous.username,
        firstName: profile.firstName ?? previous.firstName,
        lastName: profile.lastName ?? previous.lastName,
        profilePhotoUrl: profile.photoUrl ?? null,
        phone: profile.phone ?? previous.phone,
        bio: profile.bio ?? previous.bio,
        socialLinkedin: profile.socialLinkedin ?? previous.socialLinkedin,
        socialTwitter: profile.socialTwitter ?? previous.socialTwitter,
        socialFacebook: profile.socialFacebook ?? previous.socialFacebook,
        socialInstagram: profile.socialInstagram ?? previous.socialInstagram,
        socialYoutube: profile.socialYoutube ?? previous.socialYoutube,
        socialTiktok: profile.socialTiktok ?? previous.socialTiktok,
        updatedAt: new Date().toISOString(),
      };
    } else {
      const oauth = asObject(current.oauthAccount);
      const maximo = asObject(current.maximoAccount) ?? {};
      const identity = {
        emailAddress: profile.email,
        displayName: profile.displayName,
        username: profile.username,
        profilePhotoUrl: profile.photoUrl ?? null,
        bio: profile.bio,
        twitterUsername: profile.twitterUsername,
        telegramUsername: profile.telegramUsername,
        updatedAt: new Date().toISOString(),
      };
      next.maximoAccount = { ...maximo, ...identity };
      if (oauth) next.oauthAccount = { ...oauth, ...identity };
    }
    return next;
  });
}

function errorMessageFromPayload(data: JsonObject | null, status: number): string {
  const error = data?.error;
  const description = text(data?.error_description) ?? text(data?.message);
  if (typeof error === "string") return description ? `${error}: ${description}` : error;
  if (error && typeof error === "object") {
    const object = error as JsonObject;
    return text(object.message) ?? text(object.code) ?? `Request failed (${status}).`;
  }
  return description ?? `Request failed (${status}).`;
}

async function requestJson(url: string, apiKey: string, init?: RequestInit): Promise<JsonObject> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => null)) as JsonObject | null;
  if (!response.ok || !data) throw new Error(errorMessageFromPayload(data, response.status));
  return data;
}

async function resultFromProfile(profile: AccountProfile, message: string): Promise<AccountProfileActionResult> {
  const status = (await readLocalAccountStatus()) ?? {
    loggedIn: false,
    authMethod: "none",
  };
  return { ok: true, message, profile, status };
}

export async function fetchAccountProfile(): Promise<AccountProfile> {
  const status = await readLocalAccountStatus();
  const { provider, apiKey } = await credentials();
  if (!provider || !apiKey) return localProfile(status);
  try {
    const url = provider === "mytabulon" ? MYTABULON_PROFILE_URL : MAXIMO_PROFILE_URL;
    const payload = await requestJson(url, apiKey);
    const profile = profileFromPayload(provider, payload);
    await persistIdentity(provider, profile);
    return profile;
  } catch {
    if (provider === "mytabulon") {
      const account = asObject((await readGlobalConfig()).mytabulonAccount);
      return {
        provider,
        editable: true,
        email: text(account?.emailAddress) ?? status?.email,
        displayName: text(account?.displayName) ?? status?.displayName,
        username: text(account?.username) ?? status?.username,
        firstName: text(account?.firstName),
        lastName: text(account?.lastName),
        photoUrl: text(account?.profilePhotoUrl) ?? status?.photoUrl,
        phone: text(account?.phone),
        bio: text(account?.bio),
        socialLinkedin: text(account?.socialLinkedin),
        socialTwitter: text(account?.socialTwitter),
        socialFacebook: text(account?.socialFacebook),
        socialInstagram: text(account?.socialInstagram),
        socialYoutube: text(account?.socialYoutube),
        socialTiktok: text(account?.socialTiktok),
      };
    }
    return {
      provider,
      editable: true,
      email: status?.email,
      displayName: status?.displayName,
      username: status?.username,
      photoUrl: status?.photoUrl,
    };
  }
}

export async function updateAccountProfile(patch: AccountProfileUpdate): Promise<AccountProfileActionResult> {
  const { provider, apiKey } = await credentials();
  if (!provider || !apiKey) {
    return {
      ok: false,
      message: "Sign in with Maximo AI or MyTabulon to edit your account profile.",
      profile: await fetchAccountProfile(),
      status: (await readLocalAccountStatus()) ?? { loggedIn: false, authMethod: "none" },
    };
  }
  const body: JsonObject = {};
  if (patch.username !== undefined) body.username = patch.username;
  if (patch.displayName !== undefined) {
    body.display_name = patch.displayName;
    body.full_name = patch.displayName;
  }
  if (patch.firstName !== undefined) body.first_name = patch.firstName;
  if (patch.lastName !== undefined) body.last_name = patch.lastName;
  if (patch.phone !== undefined) body.phone = patch.phone;
  if (patch.bio !== undefined) body.bio = patch.bio;
  if (patch.twitterUsername !== undefined) body.twitter_username = patch.twitterUsername;
  if (patch.telegramUsername !== undefined) body.telegram_username = patch.telegramUsername;
  if (patch.socialLinkedin !== undefined) body.social_linkedin = patch.socialLinkedin;
  if (patch.socialTwitter !== undefined) body.social_twitter = patch.socialTwitter;
  if (patch.socialFacebook !== undefined) body.social_facebook = patch.socialFacebook;
  if (patch.socialInstagram !== undefined) body.social_instagram = patch.socialInstagram;
  if (patch.socialYoutube !== undefined) body.social_youtube = patch.socialYoutube;
  if (patch.socialTiktok !== undefined) body.social_tiktok = patch.socialTiktok;

  const url = provider === "mytabulon" ? MYTABULON_PROFILE_URL : MAXIMO_PROFILE_URL;
  const payload = await requestJson(url, apiKey, { method: "PATCH", body: JSON.stringify(body) });
  const profile = profileFromPayload(provider, payload);
  await persistIdentity(provider, profile);
  return resultFromProfile(profile, "Profile saved.");
}

export async function uploadAccountPhoto(name: string, mimeType: string, bytes: Uint8Array): Promise<AccountProfileActionResult> {
  const { provider, apiKey } = await credentials();
  if (!provider || !apiKey) {
    return {
      ok: false,
      message: "Sign in with Maximo AI or MyTabulon to change your profile photo.",
      profile: await fetchAccountProfile(),
      status: (await readLocalAccountStatus()) ?? { loggedIn: false, authMethod: "none" },
    };
  }
  const form = new FormData();
  form.append("profilePhoto", new Blob([Buffer.from(bytes)], { type: mimeType || "image/png" }), name || "profile.png");
  const url = provider === "mytabulon" ? MYTABULON_PHOTO_URL : MAXIMO_PHOTO_URL;
  const payload = await requestJson(url, apiKey, { method: "POST", body: form });
  const profile = profileFromPayload(provider, payload);
  await persistIdentity(provider, profile);
  return resultFromProfile(profile, "Profile photo updated.");
}

export async function deleteAccountPhoto(): Promise<AccountProfileActionResult> {
  const { provider, apiKey } = await credentials();
  if (!provider || !apiKey) {
    return {
      ok: false,
      message: "Sign in with Maximo AI or MyTabulon to change your profile photo.",
      profile: await fetchAccountProfile(),
      status: (await readLocalAccountStatus()) ?? { loggedIn: false, authMethod: "none" },
    };
  }
  const url = provider === "mytabulon" ? MYTABULON_PHOTO_URL : MAXIMO_PHOTO_URL;
  const payload = await requestJson(url, apiKey, { method: "DELETE" });
  const profile = profileFromPayload(provider, payload);
  await persistIdentity(provider, profile);
  return resultFromProfile(profile, "Profile photo removed.");
}
