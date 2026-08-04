import { chmodSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "win32") {
  const prebuildRoot = join(process.cwd(), "node_modules", "node-pty", "prebuilds");
  if (existsSync(prebuildRoot)) {
    for (const platformFolder of readdirSync(prebuildRoot)) {
      const helper = join(prebuildRoot, platformFolder, "spawn-helper");
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
}
