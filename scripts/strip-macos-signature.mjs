// electron-builder afterPack hook (macOS only).
//
// The Electron main binary is ad-hoc signed by the linker toolchain, even when
// electron-builder is configured with `identity: null`. An ad-hoc signature
// makes Gatekeeper show the hard "Maximo Syntax is damaged and can't be
// opened" block with no bypass. Removing the signature entirely leaves the app
// unsigned, so Gatekeeper falls back to the "Apple cannot check it for
// malicious software" warning with an "Open Anyway" path (right-click -> Open,
// or System Settings -> Privacy & Security -> Open Anyway).
//
// Once a Developer ID certificate + notarization are available, this hook
// should be removed (or gated behind an env var) and the app should be signed
// and notarized properly instead.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const binary = join(context.appOutDir, "Maximo Syntax.app", "Contents", "MacOS", "Maximo Syntax");
  if (!existsSync(binary)) {
    console.warn("[strip-macos-signature] main binary not found, skipping:", binary);
    return;
  }

  console.log("[strip-macos-signature] removing ad-hoc signature from", binary);
  execFileSync("codesign", ["--remove-signature", binary], { stdio: "inherit" });
}
