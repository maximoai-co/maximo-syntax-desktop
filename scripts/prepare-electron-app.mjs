import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { defaultAppSnapHelperAppPath, installAppSnapHelperIntoHostApp } from "./build-appsnap-helper.mjs";

const PRODUCT_NAME = "Maximo Syntax";
const DEV_BUNDLE_ID = "com.maximoai.syntax.desktop.dev";
const DEV_ROOT = resolve(process.cwd(), ".electron-dev");
const SOURCE_APP = resolve(process.cwd(), "node_modules", "electron", "dist", "Electron.app");
const TARGET_APP = join(DEV_ROOT, `${PRODUCT_NAME}.app`);
const MARKER_PATH = join(DEV_ROOT, ".electron-version");
const CACHE_FORMAT = "4";

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setPlistString(plist, key, value) {
  const escaped = escapeXml(value);
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[\\s\\S]*?(</string>)`);
  if (pattern.test(plist)) return plist.replace(pattern, `$1${escaped}$2`);
  return plist.replace("<dict>", `<dict>\n\t<key>${key}</key>\n\t<string>${escaped}</string>`);
}

function electronFingerprint() {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "node_modules", "electron", "package.json"), "utf8"));
  const info = statSync(join(SOURCE_APP, "Contents", "Info.plist"));
  return `${CACHE_FORMAT}:${packageJson.version}:${info.size}:${info.mtimeMs}`;
}

function relativizeBundleLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      const link = readlinkSync(path);
      if (isAbsolute(link) && link.startsWith(`${SOURCE_APP}/`)) {
        const target = join(TARGET_APP, link.slice(SOURCE_APP.length + 1));
        unlinkSync(path);
        symlinkSync(relative(dirname(path), target), path);
      }
      continue;
    }
    if (info.isDirectory()) relativizeBundleLinks(path);
  }
}

function rewritePlist(path, values) {
  let plist = readFileSync(path, "utf8");
  for (const [key, value] of Object.entries(values)) plist = setPlistString(plist, key, value);
  writeFileSync(path, plist);
}

function applyMaximoAppIcon(resourcesDirectory) {
  const sourceIcon = resolve(process.cwd(), "assets", "app-icon.icns");
  if (!existsSync(sourceIcon) || !existsSync(resourcesDirectory)) return;
  mkdirSync(resourcesDirectory, { recursive: true });
  copyFileSync(sourceIcon, join(resourcesDirectory, "AppIcon.icns"));
  copyFileSync(sourceIcon, join(resourcesDirectory, "maximo-syntax.icns"));
  // Electron's plist and Icon Services both look up electron.icns by name.
  copyFileSync(sourceIcon, join(resourcesDirectory, "electron.icns"));
}

function registerBundleWithLaunchServices(appPath) {
  if (!existsSync(appPath)) return;
  const candidates = [
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister",
  ];
  const lsregister = candidates.find((path) => existsSync(path));
  if (!lsregister) return;
  spawnSync(lsregister, ["-f", appPath], { stdio: "ignore" });
}

function rebrandDevelopmentBundle() {
  const contents = join(TARGET_APP, "Contents");
  const mainBinary = join(contents, "MacOS", "Electron");
  const brandedMainBinary = join(contents, "MacOS", PRODUCT_NAME);
  if (existsSync(mainBinary)) renameSync(mainBinary, brandedMainBinary);

  rewritePlist(join(contents, "Info.plist"), {
    CFBundleDisplayName: PRODUCT_NAME,
    CFBundleExecutable: PRODUCT_NAME,
    CFBundleIconFile: "electron.icns",
    CFBundleIdentifier: DEV_BUNDLE_ID,
    CFBundleName: PRODUCT_NAME,
  });

  const helperDefinitions = [
    { suffix: "", id: "helper" },
    { suffix: " (Renderer)", id: "renderer" },
    { suffix: " (GPU)", id: "gpu" },
    { suffix: " (Plugin)", id: "plugin" },
  ];
  const frameworks = join(contents, "Frameworks");
  for (const helper of helperDefinitions) {
    const sourceName = `Electron Helper${helper.suffix}`;
    const targetName = `Maximo Syntax Helper${helper.suffix}`;
    const sourcePath = join(frameworks, `${sourceName}.app`);
    const targetPath = join(frameworks, `${targetName}.app`);
    if (existsSync(sourcePath)) renameSync(sourcePath, targetPath);

    const helperContents = join(targetPath, "Contents");
    const helperBinary = join(helperContents, "MacOS", sourceName);
    const brandedHelperBinary = join(helperContents, "MacOS", targetName);
    if (existsSync(helperBinary)) renameSync(helperBinary, brandedHelperBinary);
    rewritePlist(join(helperContents, "Info.plist"), {
      CFBundleDisplayName: targetName,
      CFBundleExecutable: targetName,
      CFBundleIconFile: "electron.icns",
      CFBundleIdentifier: `${DEV_BUNDLE_ID}.${helper.id}`,
      CFBundleName: targetName,
    });
    applyMaximoAppIcon(join(helperContents, "Resources"));
  }

  applyMaximoAppIcon(join(contents, "Resources"));
  installAppSnapHelperIntoHostApp(TARGET_APP, defaultAppSnapHelperAppPath);
  spawnSync(
    "codesign",
    ["--force", "--sign", "-", "--timestamp=none", "--identifier", DEV_BUNDLE_ID, TARGET_APP],
    { stdio: "ignore" },
  );
  registerBundleWithLaunchServices(TARGET_APP);
}

export function getElectronExecutable() {
  if (process.platform === "win32") return resolve(process.cwd(), "node_modules", ".bin", "electron.cmd");
  if (process.platform !== "darwin") return resolve(process.cwd(), "node_modules", ".bin", "electron");

  if (!existsSync(SOURCE_APP)) throw new Error(`Electron runtime was not found: ${SOURCE_APP}`);
  const fingerprint = electronFingerprint();
  const targetExecutable = join(TARGET_APP, "Contents", "MacOS", PRODUCT_NAME);
  mkdirSync(DEV_ROOT, { recursive: true });
  let cachedFingerprint = "";
  if (existsSync(MARKER_PATH)) cachedFingerprint = readFileSync(MARKER_PATH, "utf8");
  if (!existsSync(TARGET_APP) || !existsSync(targetExecutable) || cachedFingerprint !== fingerprint) {
    rmSync(TARGET_APP, { recursive: true, force: true });
    cpSync(SOURCE_APP, TARGET_APP, { recursive: true });
    relativizeBundleLinks(TARGET_APP);
    rebrandDevelopmentBundle();
    writeFileSync(MARKER_PATH, fingerprint);
  } else {
    applyMaximoAppIcon(join(TARGET_APP, "Contents", "Resources"));
    installAppSnapHelperIntoHostApp(TARGET_APP, defaultAppSnapHelperAppPath);
    spawnSync(
      "codesign",
      ["--force", "--sign", "-", "--timestamp=none", "--identifier", DEV_BUNDLE_ID, TARGET_APP],
      { stdio: "ignore" },
    );
    registerBundleWithLaunchServices(TARGET_APP);
  }
  return targetExecutable;
}
