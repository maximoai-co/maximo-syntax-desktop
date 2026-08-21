import { describe, expect, it } from "vitest";
import {
  buildAcceptLanguageHeader,
  buildChromeClientHints,
  buildMobileChromeClientHints,
  chromeMajorVersionFromUserAgent,
  deriveAndroidChromeUserAgent,
  deriveChromeUserAgent,
} from "./browser-identity.js";

const MAC_ELECTRON_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Electron/33.0.0 MaximoSyntax/1.2";

describe("browser identity", () => {
  it("strips Electron and host-app tokens from the user agent", () => {
    const userAgent = deriveChromeUserAgent(MAC_ELECTRON_UA, ["MaximoSyntax"]);
    expect(userAgent).not.toContain("Electron/");
    expect(userAgent).not.toContain("MaximoSyntax/");
    expect(userAgent).toContain("Chrome/131.0.0.0");
    expect(userAgent).toContain("Safari/537.36");
    expect(userAgent).not.toMatch(/\s{2,}/);
  });

  it("parses the Chrome major version", () => {
    expect(chromeMajorVersionFromUserAgent(MAC_ELECTRON_UA)).toBe("131");
    expect(chromeMajorVersionFromUserAgent("not a ua")).toBeNull();
  });

  it("rewrites client hints to desktop Chrome", () => {
    const hints = buildChromeClientHints(deriveChromeUserAgent(MAC_ELECTRON_UA), "darwin");
    expect(hints).toEqual({
      "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not=A?Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    });
  });

  it("returns null client hints when Chrome cannot be parsed", () => {
    expect(buildChromeClientHints("Mozilla/5.0 unknown", "linux")).toBeNull();
  });

  it("builds mobile Android client hints", () => {
    const hints = buildMobileChromeClientHints(deriveChromeUserAgent(MAC_ELECTRON_UA));
    expect(hints?.["sec-ch-ua-mobile"]).toBe("?1");
    expect(hints?.["sec-ch-ua-platform"]).toBe('"Android"');
  });

  it("derives an Android Chrome UA for device emulation", () => {
    const mobile = deriveAndroidChromeUserAgent(deriveChromeUserAgent(MAC_ELECTRON_UA));
    expect(mobile).toContain("(Linux; Android 10; K)");
    expect(mobile).toContain("Chrome/131.0.0.0 Mobile");
    expect(mobile).toContain("Safari/537.36");
    expect(mobile).not.toContain("Macintosh");
  });

  it("builds a Chrome-style Accept-Language header", () => {
    expect(buildAcceptLanguageHeader(["en-US", "en", "fr"])).toBe("en-US;q=1.0,en;q=0.9,fr;q=0.8");
    expect(buildAcceptLanguageHeader([])).toBeNull();
  });
});
