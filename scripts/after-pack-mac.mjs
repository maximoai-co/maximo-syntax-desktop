import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

function dumpCodesign(appPath) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", appPath], { encoding: "utf8" });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function stripFinderDetritus(appPath) {
  spawnSync("xattr", ["-cr", appPath], { stdio: "ignore" });
  rmSync(join(appPath, "Icon\r"), { force: true });
}

function registerBundle(appPath) {
  const candidates = [
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
  ];
  const lsregister = candidates.find((path) => existsSync(path));
  if (!lsregister) return;
  spawnSync(lsregister, ["-f", appPath], { stdio: "ignore" });
}

function signWithIdentifier(path, bundleId) {
  spawnSync(
    "codesign",
    ["--force", "--sign", "-", "--timestamp=none", "--identifier", bundleId, path],
    { stdio: "ignore" },
  );
}

function hasDeveloperTeam(dump) {
  return /TeamIdentifier=/.test(dump) && !dump.includes("TeamIdentifier=not set");
}

export function finalizeMacAppIcon(appPath, bundleId = "com.maximoai.syntax.desktop") {
  if (!existsSync(appPath)) return;
  const dump = dumpCodesign(appPath);
  const signedByTeam = hasDeveloperTeam(dump);
  if (!signedByTeam) {
    // Finder Icon\r resource forks make codesign fail and Keychain re-prompt
    // on every launch. The bundle icns is enough for System Settings.
    stripFinderDetritus(appPath);
    signWithIdentifier(appPath, bundleId);
  }
  registerBundle(appPath);
}

export default async function afterPackMac(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager?.appInfo?.productFilename ?? "Maximo Syntax";
  const appPath = join(context.appOutDir, `${appName}.app`);
  const bundleId =
    context.packager?.appInfo?.macBundleIdentifier ??
    context.packager?.appInfo?.id ??
    context.packager?.config?.appId ??
    "com.maximoai.syntax.desktop";
  finalizeMacAppIcon(appPath, bundleId);
}
