import { spawn } from "node:child_process";
import { getElectronExecutable } from "./prepare-electron-app.mjs";

const electronBin = getElectronExecutable();

let shuttingDown = false;
const electron = spawn(electronBin, ["."], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

const stop = () => {
  shuttingDown = true;
  if (electron.exitCode === null && !electron.killed) electron.kill("SIGTERM");
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
electron.once("error", (error) => {
  if (!shuttingDown) console.error(error.message);
  process.exitCode = shuttingDown ? 0 : 1;
});
electron.once("close", (code) => {
  process.exitCode = shuttingDown ? 0 : (code ?? 1);
});
