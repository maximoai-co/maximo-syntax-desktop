import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = resolve(process.env.MAXIMO_SYNTAX_CLI_SOURCE || join(desktopRoot, "..", "maximo-syntax-cli"));
const cliPackagePath = join(cliRoot, "package.json");
const cliEntryPath = join(cliRoot, "dist", "cli-standalone.mjs");
const destination = join(desktopRoot, "vendor", "maximo-syntax-cli");

const exists = (path) => access(path).then(() => true, () => false);

if (!await exists(cliPackagePath)) {
  console.warn(`[local-cli] No sibling CLI checkout at ${cliRoot}; keeping the published package fallback.`);
  process.exit(0);
}

if (process.env.MAXIMO_SYNTAX_SKIP_LOCAL_CLI_BUILD !== "1") {
  const build = spawnSync("bun", ["run", "scripts/build.ts", "--standalone"], { cwd: cliRoot, stdio: "inherit", env: process.env });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error(`Local Maximo Syntax CLI build failed with exit code ${build.status ?? "unknown"}.`);
}

if (!await exists(cliEntryPath)) throw new Error(`The local CLI build did not create ${cliEntryPath}.`);
const packageJson = JSON.parse(await readFile(cliPackagePath, "utf8"));
const safePackage = {
  name: packageJson.name,
  version: packageJson.version,
  type: "module",
  main: "dist/cli.mjs",
  source: "local-workspace",
};

await rm(destination, { recursive: true, force: true });
await mkdir(join(destination, "dist"), { recursive: true });
await copyFile(cliEntryPath, join(destination, "dist", "cli.mjs"));
await writeFile(join(destination, "package.json"), `${JSON.stringify(safePackage, null, 2)}\n`, "utf8");
console.log(`[local-cli] Bundled ${safePackage.name} ${safePackage.version} from ${cliRoot}.`);
