import { rmSync } from "node:fs";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "dist-electron");
rmSync(outputDirectory, { recursive: true, force: true });
