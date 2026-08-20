#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repoRoot, "desktop", "native", "mac-tcc.c");
const outputDirectory = join(repoRoot, "dist-electron", "native");
const outputPath = join(outputDirectory, "mac-tcc.node");

export function buildMacHostTcc({ required = false } = {}) {
  if (process.platform !== "darwin") {
    if (required) throw new Error("The Input Monitoring host helper can only be built on macOS.");
    return null;
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing ${sourcePath}`);
  }

  const includeDirectory = spawnSync("node", ["-p", "require('node:path').join(process.config.variables.node_prefix, 'include', 'node')"], {
    encoding: "utf8",
  });
  const nodeInclude = includeDirectory.stdout?.trim();
  if (!nodeInclude || !existsSync(join(nodeInclude, "node_api.h"))) {
    throw new Error("node_api.h was not found; cannot compile the Input Monitoring host helper.");
  }

  mkdirSync(outputDirectory, { recursive: true });
  const result = spawnSync(
    "xcrun",
    [
      "clang",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-fPIC",
      "-DNAPI_VERSION=8",
      `-I${nodeInclude}`,
      "-framework",
      "CoreFoundation",
      "-framework",
      "CoreGraphics",
      "-o",
      outputPath,
      sourcePath,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Failed to compile mac-tcc.node${details ? `\n${details}` : ""}`);
  }
  return outputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const built = buildMacHostTcc({ required: true });
    console.error(`[appsnap] Built Input Monitoring host helper at ${built}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
