import { describe, expect, it } from "vitest";
import { matchesSlashCommandQuery } from "./slashCommandMatching.js";

describe("matchesSlashCommandQuery", () => {
  it("matches a command by a later part of its name", () => {
    expect(matchesSlashCommandQuery("update-config", "config")).toBe(true);
    expect(matchesSlashCommandQuery("security-review", "review")).toBe(true);
  });

  it("keeps matching case-insensitive and prefix queries", () => {
    expect(matchesSlashCommandQuery("Debug", "deb")).toBe(true);
    expect(matchesSlashCommandQuery("/debug", "/DEB")).toBe(true);
  });

  it("does not match unrelated command names", () => {
    expect(matchesSlashCommandQuery("update-config", "deploy")).toBe(false);
  });
});
