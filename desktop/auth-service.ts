import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AccountStatus, LoginMethod, OpenCodePlan } from "./types.js";
import { chooseMytabulonDefaultModel } from "./model-defaults.js";

type JsonObject = Record<string, unknown>;

const MAXIMO_BASE_URL = "https://api.maximoai.co/v1";
const MYTABULON_BASE_URL = "https://api.mytabulon.com/v1";
const CENCORI_BASE_URL = "https://api.cencori.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";
const MYTABULON_OAUTH_BASE =
  process.env.MYTABULON_OAUTH_BASE_URL || "https://api.mytabulon.com/api/syntax/oauth";
const MYTABULON_SUCCESS_URL = "https://platform.mytabulon.com/syntax/authorize?complete=1";
const GLOBAL_CONFIG_PATH = () => join(homedir(), ".maximo.json");

const API_KEY_METHODS = new Set<LoginMethod>([
  "maximoai_api",
  "mytabulon_api",
  "cencori",
  "openrouter",
  "opencode",
]);

export function loginMethodNeedsApiKey(method: LoginMethod): boolean {
  return API_KEY_METHODS.has(method);
}

export function isLoginMethod(value: unknown): value is LoginMethod {
  return value === "maximoai" || value === "maximoai_api" || value === "mytabulon" || value === "mytabulon_api" || value === "cencori" || value === "openrouter" || value === "opencode";
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function base64URLEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64URLEncode(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  return base64URLEncode(createHash("sha256").update(verifier).digest());
}

function generateState(): string {
  return base64URLEncode(randomBytes(32));
}

export async function readGlobalConfig(): Promise<JsonObject> {
  try {
    return JSON.parse(await readFile(GLOBAL_CONFIG_PATH(), "utf8")) as JsonObject;
  } catch {
    return {};
  }
}

export async function updateGlobalConfig(mutator: (current: JsonObject) => JsonObject): Promise<void> {
  const current = await readGlobalConfig();
  const next = mutator(current);
  await writeFile(GLOBAL_CONFIG_PATH(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

/** Clear provider fields the CLI logout path may leave behind (e.g. Cencori). */
export async function clearExtraProviderCredentials(): Promise<void> {
  await updateGlobalConfig((current) => {
    const next = { ...current };
    delete next.cencoriApiKey;
    delete next.openAIModel;
    delete next.openAIProvider;
    delete next.openCodePlan;
    delete next.maximoApiKey;
    delete next.openAIBaseUrl;
    delete next.mytabulonDefaultModel;
    delete next.mytabulonAccount;
    delete next.maximoAccount;
    delete next.oauthAccount;
    return next;
  });
}

function codingPlanName(tier: string): string {
  switch (tier.toLowerCase()) {
    case "max":
      return "Coding Max";
    case "pro":
      return "Coding Pro";
    case "plus":
      return "Coding Plus";
    default:
      return "Coding Free";
  }
}

async function requestJson(url: string, headers: Record<string, string>): Promise<JsonObject> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => null)) as JsonObject | null;
  if (!response.ok || !data) {
    const error = data?.error;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && typeof (error as JsonObject).message === "string"
          ? String((error as JsonObject).message)
          : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

async function persistMaximoApiKey(apiKey: string, account?: JsonObject): Promise<void> {
  await updateGlobalConfig((current) => {
    const next = { ...current };
    next.maximoApiKey = apiKey;
    next.openAIBaseUrl = MAXIMO_BASE_URL;
    next.openAIProvider = "maximoai";
    if (account) next.maximoAccount = account;
    else delete next.maximoAccount;
    delete next.openAIModel;
    delete next.openCodePlan;
    delete next.mytabulonDefaultModel;
    delete next.mytabulonAccount;
    delete next.cencoriApiKey;
    delete next.oauthAccount;
    return next;
  });
}

async function persistMyTabulon(apiKey: string, account: JsonObject, defaultModel: string): Promise<void> {
  await updateGlobalConfig((current) => {
    const next = { ...current };
    next.maximoApiKey = apiKey;
    next.openAIBaseUrl = MYTABULON_BASE_URL;
    next.openAIProvider = "mytabulon";
    next.mytabulonDefaultModel = defaultModel;
    next.mytabulonAccount = account;
    delete next.cencoriApiKey;
    delete next.oauthAccount;
    delete next.maximoAccount;
    delete next.openAIModel;
    delete next.openCodePlan;
    return next;
  });
}

async function persistCencori(apiKey: string, defaultModel?: string): Promise<void> {
  await updateGlobalConfig((current) => {
    const next = { ...current };
    next.cencoriApiKey = apiKey;
    next.maximoApiKey = apiKey;
    next.openAIBaseUrl = CENCORI_BASE_URL;
    next.openAIProvider = "cencori";
    if (defaultModel) next.openAIModel = defaultModel;
    else delete next.openAIModel;
    delete next.openCodePlan;
    delete next.mytabulonDefaultModel;
    delete next.mytabulonAccount;
    delete next.maximoAccount;
    delete next.oauthAccount;
    return next;
  });
}

async function requestModels(url: string, apiKey: string): Promise<JsonObject[]> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = payload && typeof payload === "object" ? (payload as JsonObject).error : undefined;
    const message =
      typeof error === "string"
        ? error
        : error && typeof error === "object" && typeof (error as JsonObject).message === "string"
          ? String((error as JsonObject).message)
          : `Request failed (${response.status}).`;
    const requestError = new Error(message) as Error & { status?: number };
    requestError.status = response.status;
    throw requestError;
  }
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as JsonObject).data)
      ? (payload as JsonObject).data as unknown[]
      : [];
  const models = rows.filter((item): item is JsonObject => Boolean(item && typeof item === "object" && text((item as JsonObject).id)));
  if (models.length === 0) throw new Error("The provider returned no models.");
  return models;
}

async function persistExternalProvider(
  apiKey: string,
  baseUrl: string,
  provider: "openrouter" | "opencode",
  plan: OpenCodePlan | undefined,
  defaultModel: string,
): Promise<void> {
  await updateGlobalConfig((current) => {
    const next = { ...current };
    next.maximoApiKey = apiKey;
    next.openAIBaseUrl = baseUrl;
    next.openAIProvider = provider;
    next.openAIModel = defaultModel;
    if (provider === "opencode") next.openCodePlan = plan;
    else delete next.openCodePlan;
    delete next.cencoriApiKey;
    delete next.mytabulonDefaultModel;
    delete next.mytabulonAccount;
    delete next.maximoAccount;
    delete next.oauthAccount;
    return next;
  });
}

async function configureMyTabulonApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith("mtb_live_")) {
    throw new Error("MyTabulon Coding Plan requires a live API key beginning with mtb_live_.");
  }

  const modelsResponse = await requestJson(`${MYTABULON_BASE_URL}/models`, {
    Authorization: `Bearer ${trimmed}`,
  });
  const rows = Array.isArray(modelsResponse)
    ? modelsResponse
    : Array.isArray(modelsResponse.data)
      ? (modelsResponse.data as unknown[])
      : [];
  if (rows.length === 0) {
    throw new Error("No models are available for this MyTabulon Coding Plan.");
  }

  let context: JsonObject | undefined;
  let usage: JsonObject | undefined;
  try {
    context = await requestJson(`${MYTABULON_BASE_URL}/me`, { Authorization: `Bearer ${trimmed}` });
  } catch {
    context = undefined;
  }
  try {
    usage = await requestJson(`${MYTABULON_BASE_URL}/coding-plan/usage`, { Authorization: `Bearer ${trimmed}` });
  } catch {
    usage = undefined;
  }

  const previous = (await readGlobalConfig()).mytabulonAccount as JsonObject | undefined;
  const modelsPlan =
    !Array.isArray(modelsResponse) && modelsResponse.coding_plan && typeof modelsResponse.coding_plan === "object"
      ? (modelsResponse.coding_plan as JsonObject)
      : {};
  const planSource =
    (context?.coding_plan && typeof context.coding_plan === "object" ? (context.coding_plan as JsonObject) : undefined) ||
    usage ||
    modelsPlan;
  const user = context?.user && typeof context.user === "object" ? (context.user as JsonObject) : undefined;
  const workspace = context?.workspace && typeof context.workspace === "object" ? (context.workspace as JsonObject) : undefined;
  const tier = String(planSource.tier || previous?.codingPlanTier || "free").toLowerCase();
  const scopes = Array.isArray(context?.scopes)
    ? (context.scopes as unknown[]).filter((item): item is string => typeof item === "string")
    : Array.isArray(previous?.scopes)
      ? (previous.scopes as unknown[]).filter((item): item is string => typeof item === "string")
      : [];

  if (!scopes.includes("ai.coding")) {
    throw new Error(
      "This MyTabulon API key is missing the ai.coding scope. Enable Coding Plan access for the key in the API Platform dashboard.",
    );
  }

  const modelIds = rows
    .map((item) => item && typeof item === "object" ? text((item as JsonObject).id) : undefined)
    .filter((id): id is string => Boolean(id));
  const defaultModel = chooseMytabulonDefaultModel(modelIds);

  const account: JsonObject = {
    userId: text(user?.id) ?? previous?.userId,
    emailAddress: text(user?.email) ?? previous?.emailAddress,
    displayName: text(user?.display_name) ?? previous?.displayName,
    username: text(user?.username) ?? previous?.username,
    firstName: text(user?.first_name) ?? previous?.firstName,
    lastName: text(user?.last_name) ?? previous?.lastName,
    profilePhotoUrl: text(user?.profile_photo_url) ?? previous?.profilePhotoUrl,
    phone: text(user?.phone) ?? previous?.phone,
    bio: text(user?.bio) ?? previous?.bio,
    socialLinkedin: text(user?.social_linkedin) ?? previous?.socialLinkedin,
    socialTwitter: text(user?.social_twitter) ?? previous?.socialTwitter,
    socialFacebook: text(user?.social_facebook) ?? previous?.socialFacebook,
    socialInstagram: text(user?.social_instagram) ?? previous?.socialInstagram,
    socialYoutube: text(user?.social_youtube) ?? previous?.socialYoutube,
    socialTiktok: text(user?.social_tiktok) ?? previous?.socialTiktok,
    workspaceId: text(workspace?.id) ?? previous?.workspaceId,
    workspaceName: text(workspace?.name) ?? previous?.workspaceName,
    codingPlanActive: typeof planSource.active === "boolean" ? planSource.active : (previous?.codingPlanActive ?? true),
    codingPlanTier: tier,
    codingPlanId: String(planSource.plan_id || previous?.codingPlanId || `coding_${tier}_v1`),
    codingPlanName: String(planSource.name || previous?.codingPlanName || codingPlanName(tier)),
    scopes,
    updatedAt: new Date().toISOString(),
  };

  await persistMyTabulon(trimmed, account, defaultModel);
}

async function configureMaximoApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.length < 32) {
    throw new Error("Invalid API key format. Maximo AI API keys should be at least 32 characters.");
  }
  let account: JsonObject | undefined;
  try {
    const payload = await requestJson(`${MAXIMO_BASE_URL.replace(/\/v1$/, "")}/syntax/auth/apikey-user`, {
      Authorization: `Bearer ${trimmed}`,
      "x-api-key": trimmed,
    });
    const user = payload.user && typeof payload.user === "object" ? (payload.user as JsonObject) : payload;
    account = {
      userId: text(user.id),
      emailAddress: text(user.email),
      displayName: text(user.display_name) ?? text(user.username),
      username: text(user.username),
      profilePhotoUrl: text(user.profile_photo_url),
      bio: text(user.bio),
      twitterUsername: text(user.twitter_username),
      telegramUsername: text(user.telegram_username),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    account = undefined;
  }
  await persistMaximoApiKey(trimmed, account);
}

async function configureCencoriApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("Enter your Cencori API key.");
  if (!trimmed.startsWith("csk_")) {
    throw new Error("Cencori API keys begin with csk_. Check you copied the right key from api.cencori.com.");
  }

  try {
    const payload = await requestJson(`${CENCORI_BASE_URL}/models`, { Authorization: `Bearer ${trimmed}` });
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.data)
        ? (payload.data as unknown[])
        : [];
    const first = rows.find((item) => item && typeof item === "object" && text((item as JsonObject).id));
    const defaultModel = first ? text((first as JsonObject).id) : undefined;
    await persistCencori(trimmed, defaultModel);
  } catch {
    // Match CLI: key may still work for chat even if /models fails.
    await persistCencori(trimmed);
  }
}

async function configureOpenRouterApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("Enter your OpenRouter API key.");
  try {
    const models = await requestModels(`${OPENROUTER_BASE_URL}/models`, trimmed);
    const defaultModel = text(models.find((model) => text(model.id) === "openai/gpt-5.4")?.id) ?? text(models[0]?.id) ?? "openai/gpt-5.4";
    await persistExternalProvider(trimmed, OPENROUTER_BASE_URL, "openrouter", undefined, defaultModel);
  } catch (error) {
    if (error instanceof Error && [401, 403].includes((error as Error & { status?: number }).status ?? 0)) throw error;
    // Keep sign-in usable if the catalog endpoint is temporarily unavailable.
    await persistExternalProvider(trimmed, OPENROUTER_BASE_URL, "openrouter", undefined, "openai/gpt-5.4");
  }
}

async function configureOpenCodeApiKey(apiKey: string, plan: OpenCodePlan): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error(`Enter your OpenCode ${plan === "go" ? "Go" : "Zen"} API key.`);
  const baseUrl = plan === "go" ? OPENCODE_GO_BASE_URL : OPENCODE_ZEN_BASE_URL;
  try {
    await requestModels(`${baseUrl}/models`, trimmed);
    await persistExternalProvider(trimmed, baseUrl, "opencode", plan, "deepseek-v4-flash");
  } catch (error) {
    if (error instanceof Error && [401, 403].includes((error as Error & { status?: number }).status ?? 0)) throw error;
    // Keep sign-in usable if the catalog endpoint is temporarily unavailable.
    await persistExternalProvider(trimmed, baseUrl, "opencode", plan, "deepseek-v4-flash");
  }
}

export class SignInCancelledError extends Error {
  constructor(message = "Sign-in cancelled.") {
    super(message);
    this.name = "SignInCancelledError";
  }
}

export function isSignInCancelled(error: unknown): boolean {
  return error instanceof SignInCancelledError || (error instanceof Error && /sign-in cancelled/i.test(error.message));
}

class LocalCallbackServer {
  private server: Server | null = null;
  private pendingResponse: ServerResponse | null = null;
  private resolveCode: ((code: string) => void) | null = null;
  private rejectCode: ((error: Error) => void) | null = null;
  private expectedState: string | null = null;
  private closed = false;

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.once("error", (error) => reject(error));
      this.server.listen(0, "localhost", () => {
        const address = this.server?.address() as AddressInfo | null;
        if (!address) {
          reject(new Error("Failed to start sign-in callback server."));
          return;
        }
        resolve(address.port);
      });
    });
  }

  waitForCode(state: string, timeoutMs: number): Promise<string> {
    this.expectedState = state;
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new SignInCancelledError());
        return;
      }
      const timer = setTimeout(() => {
        this.rejectCode = null;
        this.resolveCode = null;
        reject(new Error("Sign-in timed out. Try again and complete browser authorization."));
      }, timeoutMs);
      this.resolveCode = (code) => {
        clearTimeout(timer);
        resolve(code);
      };
      this.rejectCode = (error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  cancel(reason = "Sign-in cancelled."): void {
    if (this.closed) return;
    this.rejectCode?.(new SignInCancelledError(reason));
    this.resolveCode = null;
    this.rejectCode = null;
    this.close();
  }

  redirectSuccess(): void {
    if (!this.pendingResponse) return;
    this.pendingResponse.writeHead(302, { Location: MYTABULON_SUCCESS_URL });
    this.pendingResponse.end();
    this.pendingResponse = null;
  }

  redirectError(): void {
    if (!this.pendingResponse) return;
    this.pendingResponse.writeHead(302, { Location: MYTABULON_SUCCESS_URL });
    this.pendingResponse.end();
    this.pendingResponse = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.redirectError();
    this.server?.removeAllListeners();
    this.server?.close();
    this.server = null;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code") ?? undefined;
      const state = url.searchParams.get("state") ?? undefined;
      if (!code) {
        res.writeHead(400);
        res.end("Authorization code not found");
        this.rejectCode?.(new Error("No authorization code received."));
        return;
      }
      if (state !== this.expectedState) {
        res.writeHead(400);
        res.end("Invalid state parameter");
        this.rejectCode?.(new Error("Invalid state parameter."));
        return;
      }
      this.pendingResponse = res;
      this.resolveCode?.(code);
    } catch (error) {
      res.writeHead(500);
      res.end("Callback error");
      this.rejectCode?.(error instanceof Error ? error : new Error("Callback error"));
    }
  }
}

let activeBrowserLoginCancel: (() => void) | null = null;

/** Cancel an in-flight MyTabulon browser OAuth wait, if any. */
export function cancelBrowserLogin(): boolean {
  if (!activeBrowserLoginCancel) return false;
  activeBrowserLoginCancel();
  activeBrowserLoginCancel = null;
  return true;
}

async function loginMyTabulonBrowser(timeoutMs = 10 * 60_000): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const listener = new LocalCallbackServer();
  const port = await listener.start();
  const redirectUri = `http://localhost:${port}/callback`;
  let cancelled = false;

  activeBrowserLoginCancel = () => {
    cancelled = true;
    listener.cancel();
  };

  try {
    const startResponse = await fetch(`${MYTABULON_OAUTH_BASE}/authorize`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
        client_id: "maximo-syntax-cli",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (cancelled) throw new SignInCancelledError();
    const authorization = (await startResponse.json().catch(() => ({}))) as JsonObject;
    if (!startResponse.ok || typeof authorization.authorization_url !== "string") {
      throw new Error(
        text(authorization.error_description) ||
          text(authorization.error) ||
          `MyTabulon sign-in failed (${startResponse.status}).`,
      );
    }

    const codePromise = listener.waitForCode(state, timeoutMs);
    const { shell } = await import("electron");
    await shell.openExternal(authorization.authorization_url);
    if (cancelled) throw new SignInCancelledError();
    const code = await codePromise;

    const tokenResponse = await fetch(`${MYTABULON_OAUTH_BASE}/token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: "maximo-syntax-cli",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (cancelled) throw new SignInCancelledError();
    const token = (await tokenResponse.json().catch(() => ({}))) as JsonObject;
    if (!tokenResponse.ok || typeof token.access_token !== "string") {
      listener.redirectError();
      throw new Error(
        text(token.error_description) || text(token.error) || `MyTabulon did not return an API key (${tokenResponse.status}).`,
      );
    }

    listener.redirectSuccess();
    await configureMyTabulonApiKey(token.access_token);
  } catch (error) {
    listener.redirectError();
    if (cancelled || isSignInCancelled(error)) throw new SignInCancelledError();
    throw error;
  } finally {
    activeBrowserLoginCancel = null;
    listener.close();
  }
}

export async function loginWithApiKey(method: LoginMethod, apiKey: string, openCodePlan: OpenCodePlan = "zen"): Promise<void> {
  if (method === "maximoai_api") {
    await configureMaximoApiKey(apiKey);
    return;
  }
  if (method === "mytabulon_api") {
    await configureMyTabulonApiKey(apiKey);
    return;
  }
  if (method === "cencori") {
    await configureCencoriApiKey(apiKey);
    return;
  }
  if (method === "openrouter") {
    await configureOpenRouterApiKey(apiKey);
    return;
  }
  if (method === "opencode") {
    await configureOpenCodeApiKey(apiKey, openCodePlan);
    return;
  }
  throw new Error("This sign-in method does not accept an API key.");
}

export async function loginMyTabulonWithBrowser(): Promise<void> {
  await loginMyTabulonBrowser();
}

function identityFromStoredAccount(account?: JsonObject): Pick<AccountStatus, "email" | "displayName" | "username" | "photoUrl"> {
  if (!account) return {};
  return {
    email: text(account.emailAddress) ?? text(account.email),
    displayName: text(account.displayName) ?? text(account.display_name),
    username: text(account.username),
    photoUrl: text(account.profilePhotoUrl) ?? text(account.profile_photo_url),
  };
}

export async function readLocalAccountStatus(): Promise<AccountStatus | null> {
  try {
    const config = await readGlobalConfig();
    const oauthAccount = config.oauthAccount && typeof config.oauthAccount === "object" ? (config.oauthAccount as JsonObject) : undefined;
    const mytabulonAccount =
      config.mytabulonAccount && typeof config.mytabulonAccount === "object" ? (config.mytabulonAccount as JsonObject) : undefined;
    const maximoAccount =
      config.maximoAccount && typeof config.maximoAccount === "object" ? (config.maximoAccount as JsonObject) : undefined;
    const baseUrl = text(config.openAIBaseUrl) ?? "";
    const maximoApiKey = text(config.maximoApiKey);
    const cencoriApiKey = text(config.cencoriApiKey);
    const provider = text(config.openAIProvider);
    const openCodePlan = config.openCodePlan === "go" ? "go" : config.openCodePlan === "zen" ? "zen" : undefined;

    // The persisted provider field is written atomically with the credentials,
    // so it stays authoritative even if a stale base URL survives a switch.
    if (provider === "mytabulon" && maximoApiKey) {
      const tier = text(mytabulonAccount?.codingPlanTier) ?? "coding plan";
      return {
        loggedIn: true,
        authMethod: "mytabulon",
        apiProvider: "MyTabulon",
        ...identityFromStoredAccount(mytabulonAccount),
        orgName: text(mytabulonAccount?.workspaceName),
        subscriptionType: `Coding ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
        profileEditable: true,
      };
    }
    if (provider === "cencori" && (cencoriApiKey || maximoApiKey)) {
      return {
        loggedIn: true,
        authMethod: "cencori",
        apiProvider: "Cencori",
        subscriptionType: "API key",
      };
    }
    if (provider === "openrouter" && maximoApiKey) {
      return {
        loggedIn: true,
        authMethod: "openrouter",
        apiProvider: "OpenRouter",
        subscriptionType: "API key",
      };
    }
    if (provider === "opencode" && maximoApiKey) {
      return {
        loggedIn: true,
        authMethod: openCodePlan === "go" ? "opencode_go" : "opencode_zen",
        apiProvider: "OpenCode",
        subscriptionType: openCodePlan === "go" ? "OpenCode Go" : "OpenCode Zen",
      };
    }
    if (provider === "maximoai") {
      if (oauthAccount && (maximoApiKey || /maximoai?\.co/i.test(baseUrl))) {
        const billingType = text(oauthAccount.billingType) ?? "subscription";
        return {
          loggedIn: true,
          authMethod: "maximo.ai",
          apiProvider: "Maximo AI",
          ...identityFromStoredAccount(oauthAccount),
          orgName: text(oauthAccount.organizationName),
          subscriptionType: billingType === "subscription" ? "Subscription" : `${billingType.charAt(0).toUpperCase()}${billingType.slice(1)}`,
          profileEditable: true,
        };
      }
      if (maximoApiKey) {
        return {
          loggedIn: true,
          authMethod: "maximoai_api",
          apiProvider: "Maximo AI",
          ...identityFromStoredAccount(maximoAccount),
          subscriptionType: "API key",
          profileEditable: true,
        };
      }
    }

    // Legacy configs written before the provider field existed.
    if (/openrouter\.ai\/api\/v1/i.test(baseUrl) && maximoApiKey) {
      return {
        loggedIn: true,
        authMethod: "openrouter",
        apiProvider: "OpenRouter",
        subscriptionType: "API key",
      };
    }

    if (/opencode\.ai\/zen\/go\/v1/i.test(baseUrl) && maximoApiKey) {
      return {
        loggedIn: true,
        authMethod: "opencode_go",
        apiProvider: "OpenCode",
        subscriptionType: "OpenCode Go",
      };
    }

    if (/opencode\.ai\/zen\/v1/i.test(baseUrl) && maximoApiKey) {
      return {
        loggedIn: true,
        authMethod: "opencode_zen",
        apiProvider: "OpenCode",
        subscriptionType: "OpenCode Zen",
      };
    }

    if (/api\.mytabulon\.com/i.test(baseUrl) && maximoApiKey) {
      const tier = text(mytabulonAccount?.codingPlanTier) ?? "coding plan";
      return {
        loggedIn: true,
        authMethod: "mytabulon",
        apiProvider: "MyTabulon",
        ...identityFromStoredAccount(mytabulonAccount),
        orgName: text(mytabulonAccount?.workspaceName),
        subscriptionType: `Coding ${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
        profileEditable: true,
      };
    }

    if (/api\.cencori\.com/i.test(baseUrl) && (cencoriApiKey || maximoApiKey)) {
      return {
        loggedIn: true,
        authMethod: "cencori",
        apiProvider: "Cencori",
        subscriptionType: "API key",
      };
    }

    if (oauthAccount && (maximoApiKey || /maximoai?\.co/i.test(baseUrl))) {
      const billingType = text(oauthAccount.billingType) ?? "subscription";
      return {
        loggedIn: true,
        authMethod: "maximo.ai",
        apiProvider: "Maximo AI",
        ...identityFromStoredAccount(oauthAccount),
        orgName: text(oauthAccount.organizationName),
        subscriptionType: billingType === "subscription" ? "Subscription" : `${billingType.charAt(0).toUpperCase()}${billingType.slice(1)}`,
        profileEditable: true,
      };
    }

    if (maximoApiKey && (/maximoai?\.co/i.test(baseUrl) || !baseUrl)) {
      return {
        loggedIn: true,
        authMethod: "maximoai_api",
        apiProvider: "Maximo AI",
        ...identityFromStoredAccount(maximoAccount),
        subscriptionType: "API key",
        profileEditable: true,
      };
    }

    return null;
  } catch {
    return null;
  }
}
