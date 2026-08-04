<div align="center">

# Maximo Syntax Desktop

**Your AI workspace for work.**

Maximo Syntax is a native desktop app that turns any goal into finished work — write and edit code, build software, draft documents, analyze data, organize projects, and run agent workflows. One agent that works across your files, terminals, projects, and tasks.

Built with [Electron](https://www.electronjs.org/) · [React](https://react.dev/) · [Vite](https://vite.dev/) · [TypeScript](https://www.typescriptlang.org/)

</div>

---

## Features

- **Agentic chat workspace** — start a chat in any local folder and let the agent inspect, edit, run, and verify your work through the bundled Maximo Syntax CLI engine.
- **Projects & spaces** — pin, group, and organize folders, chats, and work surfaces (chat, activity, kanban, pull requests).
- **Multi-provider sign-in** — Maximo AI subscription, API keys, MyTabulon, Cencori, OpenRouter, and OpenCode Go/Zen. Credentials stay in the CLI's secure auth storage.
- **Built-in terminal** — a PTY terminal, run log, and workspace browser for local servers.
- **Diff review** — review file changes and pull requests inline.
- **Permission controls** — ask-for-approval, plan mode, accept edits, auto-approve, or explicit full access (visually distinguished).
- **Local-first** — your data, sessions, and credentials live on your machine, never on a Maximo server.
- **Secure by default** — context isolation, sandboxing, navigation blocking, and a narrow typed preload bridge (see [Security model](#security-model)).

---

## Requirements

- [Node.js](https://nodejs.org/) **22.12 or newer** (development only — installed builds bundle their own runtime and do not need Node.js).

---

## Getting started

```bash
git clone <your-fork-url>
cd maximo-syntax-desktop
npm install
npm start
```

`npm start` builds both the renderer and the Electron main process, then opens the desktop app.

For live renderer reloads while developing:

```bash
npm run dev
```

### Available scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Build and launch the desktop app |
| `npm run dev` | Development mode with live renderer reloads |
| `npm run build` | Build icon, renderer, and Electron main process |
| `npm run build:renderer` | Build the renderer only (Vite → `dist-renderer/`) |
| `npm run build:electron` | Build the Electron main process only (tsc → `dist-electron/`) |
| `npm run build:icon` | Regenerate app icons from the SVG |
| `npm run typecheck` | Typecheck renderer and Electron code |
| `npm test` | Run the Vitest test suite |
| `npm run check` | Typecheck + tests + build (full verification) |
| `npm run package` | Build + unpacked app for local testing (`electron-builder --dir`) |
| `npm run dist` | Build signed/installable installers |
| `npm run dist:mac` | Build macOS DMG + ZIP |
| `npm run dist:win` | Build Windows NSIS installer |

---

## Engine setup

The distributed desktop app includes `@maximoai/maximo-syntax-cli`, so end users do not need Node, npm, or a separate global CLI install. On launch, the runtime manager validates the engine in this order:

1. A custom CLI path selected in Settings.
2. A sibling CLI checkout in development builds.
3. A managed engine installed in the app data directory.
4. The CLI bundled in the desktop installer.
5. A compatible CLI found on the system path.

If no valid engine is available, the first-run setup can install or repair a managed copy. Chats run in the selected project folder using the CLI's supported streaming headless mode; follow-up turns resume the saved CLI session ID.

---

## Account controls

The sidebar Account panel uses the bundled CLI's supported authentication commands. It shows the current connection, links to usage and billing, supports Maximo subscription, API-usage, MyTabulon, Cencori, OpenRouter, and OpenCode Go/Zen sign-in, and can switch accounts or sign out. Credentials remain in the CLI's secure auth storage and are never exposed to the renderer.

---

## Security model

The renderer has no Node access. Electron runs with context isolation, sandboxing, navigation blocking, and a narrow typed preload bridge. Filesystem, process, Git, dialog, and shell actions are validated and executed only in the main process. Full-access mode is explicit and visually distinguished from safer permission modes.

For details on reporting vulnerabilities, see [SECURITY.md](SECURITY.md).

---

## Project structure

```
desktop/                 Electron main process (Node)
  main.ts                Window, menus, IPC handlers
  preload.cts            Typed preload bridge (contextIsolated)
  auth-service.ts        Provider sign-in / account status
  cli-runner.ts          Spawns and streams the CLI engine
  runtime-manager.ts     Engine discovery, install, and repair
  terminal-manager.ts    PTY terminal sessions
  state-store.ts         Local project/thread/space state
  usage-service.ts       Usage & billing snapshots
  workspace-files.ts     Read/write workspace files
src/                     React renderer (Vite)
  App.tsx                Shell: sidebar, chat, dock, gates
  components/            Chat, diff review, kanban, PRs, modals, terminal
  styles.css             Design system
  main.tsx               React entry
scripts/                 Build, icon, and dev tooling
assets/                  Icons, fonts, logo
```

---

## Testing

```bash
npm run typecheck   # TypeScript (renderer + Electron)
npm test            # Vitest unit tests
npm run check       # typecheck + tests + full build
```

---

## Building installers

```bash
npm run dist:mac    # macOS DMG + ZIP
npm run dist:win    # Windows NSIS installer
npm run dist        # Current platform
```

Installers are written to `release/`.

---

## License

MIT — see [LICENSE](LICENSE). Contributions welcome — see [CONTRIBUTING](CONTRIBUTING.md).

Copyright © 2026 Maximo AI Ltd
