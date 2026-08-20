#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDirectory = dirname(scriptPath);
const repoRoot = resolve(scriptsDirectory, "..");
const sourceDirectory = join(repoRoot, "desktop", "native", "appsnap");
const iconPath = join(repoRoot, "assets", "app-icon.icns");
const PRODUCT_NAME = "Maximo Syntax";
const HELPER_APP_NAME = "Maximo Syntax AppSnap.app";
const HELPER_EXECUTABLE_NAME = "maximo-syntax-appsnap-helper";
const PRODUCTION_HELPER_BUNDLE_ID = "com.maximoai.syntax.desktop.appsnap-helper";
const DEVELOPMENT_HELPER_BUNDLE_ID = "com.maximoai.syntax.desktop.dev.appsnap-helper";

export const defaultAppSnapHelperAppPath = join(
  repoRoot,
  ".electron-runtime",
  "appsnap",
  HELPER_APP_NAME,
);

export const defaultAppSnapHelperPath = join(
  defaultAppSnapHelperAppPath,
  "Contents",
  "MacOS",
  HELPER_EXECUTABLE_NAME,
);

const frameworkArguments = [
  "-framework",
  "AppKit",
  "-framework",
  "CoreGraphics",
  "-framework",
  "CoreImage",
  "-framework",
  "CoreMedia",
  "-framework",
  "CoreVideo",
  "-framework",
  "ScreenCaptureKit",
];

export function swiftTargetsForArch(arch) {
  switch (arch) {
    case "arm64":
      return [{ arch: "arm64", target: "arm64-apple-macos12.3" }];
    case "x64":
      return [{ arch: "x64", target: "x86_64-apple-macos12.3" }];
    case "universal":
      return [
        { arch: "arm64", target: "arm64-apple-macos12.3" },
        { arch: "x64", target: "x86_64-apple-macos12.3" },
      ];
    default:
      throw new Error(`Unsupported AppSnap helper architecture: ${arch}`);
  }
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repoRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();
  const suffix = details ? `\n${details}` : "";
  throw new Error(
    `AppSnap helper command failed (${command} ${arguments_.join(" ")}): ${result.status ?? "unknown"}${suffix}`,
  );
}

function helperBundleId(release) {
  return release ? PRODUCTION_HELPER_BUNDLE_ID : DEVELOPMENT_HELPER_BUNDLE_ID;
}

function helperInfoPlist(bundleId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${HELPER_EXECUTABLE_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.3</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
}

function buildFingerprint({ arch, release, sources, targets, bundleId }) {
  const hash = createHash("sha256");
  hash.update("maximo-syntax-appsnap-helper-build-v4\0");
  hash.update(arch);
  hash.update("\0");
  hash.update(release ? "release" : "debug");
  hash.update("\0");
  hash.update(bundleId);
  hash.update("\0");
  hash.update(JSON.stringify(targets));
  hash.update("\0");
  hash.update(JSON.stringify(frameworkArguments));
  hash.update("\0");
  hash.update(readFileSync(scriptPath));
  hash.update("\0");
  hash.update(helperInfoPlist(bundleId));
  if (existsSync(iconPath)) {
    hash.update("\0");
    hash.update(readFileSync(iconPath));
  }
  for (const source of sources) {
    hash.update("\0");
    hash.update(source);
    hash.update("\0");
    hash.update(readFileSync(source));
  }
  return hash.digest("hex");
}

export function installAppSnapHelperIntoHostApp(hostAppPath, helperAppPath = defaultAppSnapHelperAppPath) {
  if (!existsSync(helperAppPath) || !existsSync(hostAppPath)) return null;
  const helpersDirectory = join(hostAppPath, "Contents", "Helpers");
  mkdirSync(helpersDirectory, { recursive: true });
  rmSync(join(helpersDirectory, HELPER_EXECUTABLE_NAME), { force: true });
  const destination = join(helpersDirectory, HELPER_APP_NAME);
  rmSync(destination, { recursive: true, force: true });
  const staging = `${destination}.tmp-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  cpSync(helperAppPath, staging, { recursive: true });
  renameSync(staging, destination);
  return join(destination, "Contents", "MacOS", HELPER_EXECUTABLE_NAME);
}

function assembleHelperApp({ binaryPath, appPath, bundleId }) {
  const contents = join(appPath, "Contents");
  const macOS = join(contents, "MacOS");
  const resources = join(contents, "Resources");
  mkdirSync(macOS, { recursive: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(contents, "Info.plist"), helperInfoPlist(bundleId));
  writeFileSync(join(contents, "PkgInfo"), "APPL????");
  copyFileSync(binaryPath, join(macOS, HELPER_EXECUTABLE_NAME));
  chmodSync(join(macOS, HELPER_EXECUTABLE_NAME), 0o755);
  if (existsSync(iconPath)) {
    copyFileSync(iconPath, join(resources, "AppIcon.icns"));
  }
  run("codesign", [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    "--deep",
    appPath,
  ]);
}

function isUsableCachedBuild(outputPath, metadataPath, fingerprint) {
  if (!existsSync(outputPath) || !existsSync(metadataPath)) {
    return false;
  }
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadata.fingerprint !== fingerprint) {
      return false;
    }
    const verification = spawnSync("codesign", ["--verify", "--strict", outputPath], {
      encoding: "utf8",
    });
    return verification.status === 0;
  } catch {
    return false;
  }
}

export function buildAppSnapHelper({
  arch = process.arch,
  outputPath = defaultAppSnapHelperAppPath,
  release = false,
  quiet = false,
  required = false,
} = {}) {
  if (process.platform !== "darwin") {
    if (required) {
      throw new Error("The AppSnap helper can only be built on macOS.");
    }
    if (!quiet) {
      console.error("[appsnap] Skipping Swift helper build on non-macOS.");
    }
    return null;
  }

  const targets = swiftTargetsForArch(arch);
  const sources = readdirSync(sourceDirectory)
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => join(sourceDirectory, name));
  if (sources.length === 0) {
    throw new Error(`No Swift sources found in ${sourceDirectory}.`);
  }

  const bundleId = helperBundleId(release);
  const resolvedAppPath = resolve(outputPath.endsWith(".app") ? outputPath : defaultAppSnapHelperAppPath);
  const resolvedExecutablePath = join(resolvedAppPath, "Contents", "MacOS", HELPER_EXECUTABLE_NAME);
  const metadataPath = join(resolvedAppPath, "..", `${HELPER_EXECUTABLE_NAME}.build.json`);
  const fingerprint = buildFingerprint({ arch, release, sources, targets, bundleId });
  const hostAppPath = join(repoRoot, ".electron-dev", `${PRODUCT_NAME}.app`);
  if (isUsableCachedBuild(resolvedExecutablePath, metadataPath, fingerprint)) {
    if (!quiet) {
      console.error(`[appsnap] Reusing ${arch} Swift helper at ${resolvedExecutablePath}`);
    }
    installAppSnapHelperIntoHostApp(hostAppPath, resolvedAppPath);
    return resolvedExecutablePath;
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "maximo-syntax-appsnap-helper-"));
  const moduleCacheDirectory = join(temporaryDirectory, "module-cache");
  const buildEnvironment = {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: moduleCacheDirectory,
    SWIFT_MODULECACHE_PATH: moduleCacheDirectory,
  };

  try {
    const thinBinaries = [];
    for (const target of targets) {
      const thinBinary = join(temporaryDirectory, `maximo-syntax-appsnap-helper-${target.arch}`);
      const optimizationArguments = release
        ? ["-O", "-whole-module-optimization"]
        : ["-Onone", "-g"];
      run(
        "xcrun",
        [
          "swiftc",
          ...optimizationArguments,
          "-module-name",
          "MaximoSyntaxAppSnapHelper",
          "-target",
          target.target,
          ...frameworkArguments,
          ...sources,
          "-o",
          thinBinary,
        ],
        { env: buildEnvironment },
      );
      thinBinaries.push(thinBinary);
    }

    const unsignedBinary = join(temporaryDirectory, HELPER_EXECUTABLE_NAME);
    if (thinBinaries.length === 1) {
      copyFileSync(thinBinaries[0], unsignedBinary);
    } else {
      run("xcrun", ["lipo", "-create", ...thinBinaries, "-output", unsignedBinary]);
    }

    mkdirSync(dirname(resolvedAppPath), { recursive: true });
    const pendingAppPath = `${resolvedAppPath}.tmp-${process.pid}`;
    rmSync(pendingAppPath, { recursive: true, force: true });
    assembleHelperApp({
      binaryPath: unsignedBinary,
      appPath: pendingAppPath,
      bundleId,
    });
    rmSync(resolvedAppPath, { recursive: true, force: true });
    renameSync(pendingAppPath, resolvedAppPath);

    mkdirSync(dirname(metadataPath), { recursive: true });
    const pendingMetadataPath = `${metadataPath}.tmp-${process.pid}`;
    rmSync(pendingMetadataPath, { force: true });
    writeFileSync(pendingMetadataPath, `${JSON.stringify({ fingerprint, bundleId })}\n`, { mode: 0o600 });
    rmSync(metadataPath, { force: true });
    renameSync(pendingMetadataPath, metadataPath);

    installAppSnapHelperIntoHostApp(hostAppPath, resolvedAppPath);

    if (!quiet) {
      console.error(
        `[appsnap] Built ${arch} Swift helper app for macOS 12.3+ at ${resolvedExecutablePath}`,
      );
    }
    return resolvedExecutablePath;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseCommandLine(arguments_) {
  let arch = process.arch;
  let outputPath = defaultAppSnapHelperAppPath;
  let release = false;
  let required = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--arch":
        index += 1;
        if (index >= arguments_.length) {
          throw new Error("--arch requires arm64, x64, or universal.");
        }
        arch = arguments_[index];
        break;
      case "--output":
        index += 1;
        if (index >= arguments_.length) {
          throw new Error("--output requires a path.");
        }
        outputPath = arguments_[index];
        break;
      case "--release":
        release = true;
        break;
      case "--required":
        required = true;
        break;
      default:
        throw new Error(`Unknown AppSnap helper build argument: ${argument}`);
    }
  }

  return { arch, outputPath, release, required };
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    buildAppSnapHelper(parseCommandLine(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
