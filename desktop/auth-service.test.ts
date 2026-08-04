import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cancelBrowserLogin,
  clearExtraProviderCredentials,
  isLoginMethod,
  isSignInCancelled,
  loginMethodNeedsApiKey,
  readLocalAccountStatus,
  SignInCancelledError,
} from "./auth-service.js";

describe("auth-service login methods", () => {
  it("recognizes every CLI-parity sign-in method", () => {
    expect(isLoginMethod("maximoai")).toBe(true);
    expect(isLoginMethod("maximoai_api")).toBe(true);
    expect(isLoginMethod("mytabulon")).toBe(true);
    expect(isLoginMethod("mytabulon_api")).toBe(true);
    expect(isLoginMethod("cencori")).toBe(true);
    expect(isLoginMethod("openrouter")).toBe(true);
    expect(isLoginMethod("opencode")).toBe(true);
    expect(isLoginMethod("console")).toBe(false);
    expect(isLoginMethod("")).toBe(false);
  });

  it("marks only API-key methods as needing a key", () => {
    expect(loginMethodNeedsApiKey("maximoai")).toBe(false);
    expect(loginMethodNeedsApiKey("mytabulon")).toBe(false);
    expect(loginMethodNeedsApiKey("maximoai_api")).toBe(true);
    expect(loginMethodNeedsApiKey("mytabulon_api")).toBe(true);
    expect(loginMethodNeedsApiKey("cencori")).toBe(true);
    expect(loginMethodNeedsApiKey("openrouter")).toBe(true);
    expect(loginMethodNeedsApiKey("opencode")).toBe(true);
  });

  it("detects cancelled sign-in errors and no-ops cancel when idle", () => {
    expect(isSignInCancelled(new SignInCancelledError())).toBe(true);
    expect(isSignInCancelled(new Error("Sign-in cancelled."))).toBe(true);
    expect(isSignInCancelled(new Error("network failed"))).toBe(false);
    expect(cancelBrowserLogin()).toBe(false);
  });
});

const originalHome = process.env.HOME;
let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "maximo-auth-"));
  process.env.HOME = homeDir;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(homeDir, { recursive: true, force: true });
});

function writeConfig(value: Record<string, unknown>): void {
  writeFileSync(join(homeDir, ".maximo.json"), JSON.stringify(value), "utf8");
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(homeDir, ".maximo.json"), "utf8")) as Record<string, unknown>;
}

describe("provider switching", () => {
  it("wipes every provider credential, including the OpenCode plan, on logout", async () => {
    writeConfig({
      maximoApiKey: "go-key",
      openAIBaseUrl: "https://opencode.ai/zen/go/v1",
      openAIProvider: "opencode",
      openCodePlan: "go",
      openAIModel: "deepseek-v4-flash",
      cencoriApiKey: "csk_x",
      mytabulonDefaultModel: "maximo-atlas-preview",
      mytabulonAccount: { codingPlanTier: "plus" },
      oauthAccount: { emailAddress: "x@y.z" },
    });
    await clearExtraProviderCredentials();
    const after = readConfig();
    expect(after.maximoApiKey).toBeUndefined();
    expect(after.openAIBaseUrl).toBeUndefined();
    expect(after.openAIProvider).toBeUndefined();
    expect(after.openCodePlan).toBeUndefined();
    expect(after.openAIModel).toBeUndefined();
    expect(after.cencoriApiKey).toBeUndefined();
    expect(await readLocalAccountStatus()).toBeNull();
  });

  it("reports the newly signed-in provider instead of the previous OpenCode plan", async () => {
    writeConfig({
      maximoApiKey: "mtb_live_key",
      openAIBaseUrl: "https://api.mytabulon.com/v1",
      openAIProvider: "mytabulon",
      mytabulonDefaultModel: "maximo-atlas-preview",
      mytabulonAccount: { codingPlanTier: "plus" },
    });
    expect((await readLocalAccountStatus())?.authMethod).toBe("mytabulon");
  });

  it("trusts the persisted provider field over a stale base URL", async () => {
    writeConfig({
      maximoApiKey: "mtb_live_key",
      openAIBaseUrl: "https://opencode.ai/zen/go/v1",
      openAIProvider: "mytabulon",
      mytabulonDefaultModel: "maximo-atlas-preview",
    });
    expect((await readLocalAccountStatus())?.authMethod).toBe("mytabulon");
  });

  it("distinguishes OpenCode Go from OpenCode Zen", async () => {
    writeConfig({
      maximoApiKey: "key",
      openAIBaseUrl: "https://opencode.ai/zen/go/v1",
      openAIProvider: "opencode",
      openCodePlan: "go",
    });
    expect((await readLocalAccountStatus())?.authMethod).toBe("opencode_go");
    writeConfig({
      maximoApiKey: "key",
      openAIBaseUrl: "https://opencode.ai/zen/v1",
      openAIProvider: "opencode",
      openCodePlan: "zen",
    });
    expect((await readLocalAccountStatus())?.authMethod).toBe("opencode_zen");
  });
});
