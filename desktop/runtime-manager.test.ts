import { describe, expect, it } from "vitest";
import { compareVersions } from "./runtime-manager.js";

describe("compareVersions", () => {
  it("orders stable versions by semver", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.2.99")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.23", "0.1.24")).toBeLessThan(0);
  });

  it("treats a release as newer than its own prerelease", () => {
    expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3")).toBeLessThan(0);
    expect(compareVersions("0.1.24-beta.1", "0.1.23")).toBeGreaterThan(0);
  });

  it("orders prerelease parts", () => {
    expect(compareVersions("1.2.3-beta.2", "1.2.3-beta.10")).toBeLessThan(0);
    expect(compareVersions("1.2.3-beta", "1.2.3-alpha")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3-beta.1", "1.2.3-beta.1")).toBe(0);
    expect(compareVersions("1.2.3-rc.1", "1.2.3-beta.9")).toBeGreaterThan(0);
  });

  it("returns 0 for unparseable or mismatched inputs", () => {
    expect(compareVersions("installed", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "not-a-version")).toBe(0);
    expect(compareVersions("", "")).toBe(0);
  });

  it("handles v-prefixed versions", () => {
    expect(compareVersions("v1.2.4", "1.2.3")).toBeGreaterThan(0);
  });
});
