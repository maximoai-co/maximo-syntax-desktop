import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { getElectronExecutable } from "./prepare-electron-app.mjs";

const isWindows = process.platform === "win32";
const bin = (name) => resolve(process.cwd(), "node_modules", ".bin", isWindows ? `${name}.cmd` : name);
const electronBin = isWindows ? bin("electron") : getElectronExecutable();
const requestedDevServerPort = Number(process.env.VITE_DEV_SERVER_PORT) || 5173;
const children = [];
let shuttingDown = false;
let signalReceived = false;

function waitForExit(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode) {
      resolvePromise({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
    child.once("error", () => resolvePromise({ code: 1, signal: null }));
  });
}

function stopChild(entry) {
  const { child, group } = entry;
  if (!child || child.exitCode !== null || child.killed) return;
  if (isWindows) child.kill();
  else if (group) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else child.kill("SIGTERM");
  const forceKill = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2_000);
  forceKill.unref();
}

function stopChildren() {
  for (const entry of children) stopChild(entry);
}

function onSignal() {
  signalReceived = true;
  shuttingDown = true;
  stopChildren();
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    const available = await new Promise((resolvePromise) => {
      const probe = createServer();
      probe.once("error", () => resolvePromise(false));
      probe.listen(port, "127.0.0.1", () => {
        probe.close(() => resolvePromise(true));
      });
    });
    if (available) return port;
  }
  throw new Error(`No development port is available near ${startPort}.`);
}

async function waitForDevServer(viteExit, devServerUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (signalReceived) return false;
    const result = await Promise.race([
      fetch(devServerUrl, { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false),
      viteExit.then(() => null),
      new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 100)),
    ]);
    if (result === null) throw new Error("Vite stopped before its dev server was ready.");
    if (result === true) return true;
  }
  throw new Error(`Vite did not become ready at ${devServerUrl}`);
}

async function run() {
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const devServerPort = await findAvailablePort(requestedDevServerPort);
  const devServerUrl = `http://127.0.0.1:${devServerPort}/`;
  const vite = spawn(bin("vite"), ["--host", "127.0.0.1", "--port", String(devServerPort), "--strictPort"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    detached: !isWindows,
  });
  children.push({ child: vite, group: true });
  const viteExit = waitForExit(vite);

  try {
    if (!(await waitForDevServer(viteExit, devServerUrl))) return 0;
    if (signalReceived) return 0;

    const electron = spawn(electronBin, ["."], {
      cwd: process.cwd(),
      env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
      stdio: "inherit",
      detached: !isWindows,
    });
    children.push({ child: electron, group: false });
    const electronExit = waitForExit(electron);
    const winner = await Promise.race([
      viteExit.then((result) => ({ name: "Vite", result })),
      electronExit.then((result) => ({ name: "Electron", result })),
    ]);

    if (!shuttingDown) {
      shuttingDown = true;
      stopChildren();
    }
    await Promise.all([viteExit, electronExit]);
    if (signalReceived) return 0;
    if (winner.name === "Electron" && winner.result.code === 0) return 0;
    return 1;
  } finally {
    if (!shuttingDown) {
      shuttingDown = true;
      stopChildren();
    }
    await viteExit;
  }
}

run().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  if (!signalReceived) console.error(error instanceof Error ? error.message : String(error));
  stopChildren();
  process.exitCode = signalReceived ? 0 : 1;
});
