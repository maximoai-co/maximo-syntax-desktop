import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserProfileStore, normalizeBrowserOrigin, type BrowserCredentialEncryption } from "./browser-profile-store.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "maximo-browser-profile-"));
  temporaryDirectories.push(path);
  return path;
}

const encryption: BrowserCredentialEncryption = {
  available: async () => true,
  encrypt: async (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decrypt: async (value) => ({ result: value.toString("utf8").replace(/^encrypted:/, "") }),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("browser profile store", () => {
  it("normalizes secure and local development origins", () => {
    expect(normalizeBrowserOrigin("https://example.com/login")).toBe("https://example.com");
    expect(normalizeBrowserOrigin("http://localhost:3000/login")).toBe("http://localhost:3000");
    expect(normalizeBrowserOrigin("http://example.com/login")).toBeNull();
    expect(normalizeBrowserOrigin("javascript:alert(1)")).toBeNull();
  });

  it("persists searchable history without URL fragments", async () => {
    const directory = await temporaryDirectory();
    const store = new BrowserProfileStore(directory, encryption);
    await store.initialize();
    await store.recordVisit("https://docs.example.com/guide#install", "Install guide");
    await store.recordVisit("https://docs.example.com/guide#usage", "Usage guide");

    expect(store.historyCount()).toBe(1);
    expect(store.searchHistory("docs", 5)[0]).toMatchObject({
      url: "https://docs.example.com/guide",
      title: "Usage guide",
      visitCount: 2,
    });

    const restored = new BrowserProfileStore(directory, encryption);
    await restored.initialize();
    expect(restored.searchHistory("usage", 5)).toHaveLength(1);
  });

  it("stores only encrypted passwords and restores them by exact origin", async () => {
    const directory = await temporaryDirectory();
    const store = new BrowserProfileStore(directory, encryption);
    await store.initialize();
    await store.saveCredential("https://accounts.example.com/login", "daniel@example.com", "not-on-disk");

    const raw = await readFile(join(directory, "browser", "profile.json"), "utf8");
    expect(raw).not.toContain("not-on-disk");
    await expect(store.lookupCredential("https://accounts.example.com/path")).resolves.toMatchObject({
      username: "daniel@example.com",
      password: "not-on-disk",
    });
    await expect(store.lookupCredential("https://example.com/path")).resolves.toBeNull();
  });

  it("remembers never-save and site-permission choices", async () => {
    const directory = await temporaryDirectory();
    const store = new BrowserProfileStore(directory, encryption);
    await store.initialize();
    expect(store.shouldOfferPasswordSave("https://example.com")).toBe(true);
    await store.neverSavePasswordsFor("https://example.com/login");
    expect(store.shouldOfferPasswordSave("https://example.com/account")).toBe(false);

    await store.setPermission("https://example.com", "notifications", "block");
    expect(store.permission("https://example.com/path", "notifications")).toBe("block");
    expect(store.permissionCount()).toBe(1);
  });

  it("disables password saving when OS encryption is unavailable", async () => {
    const directory = await temporaryDirectory();
    const store = new BrowserProfileStore(directory, {
      ...encryption,
      available: async () => false,
    });
    await store.initialize();
    expect(store.isPasswordStorageAvailable()).toBe(false);
    expect(store.settings().savePasswords).toBe(false);
    await store.updateSettings({ savePasswords: true });
    expect(store.settings().savePasswords).toBe(false);
  });
});
