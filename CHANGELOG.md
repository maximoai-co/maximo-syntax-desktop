# Changelog

All notable changes to Maximo Syntax Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-08-05

- Fixed the macOS "Maximo Syntax is damaged and can't be opened" error on Apple Silicon. The build now disables code signing (`identity: null`, no hardened runtime) and an `afterPack` hook strips the linker's ad-hoc signature from the main binary, so Gatekeeper shows the standard "Apple cannot check it for malicious software" warning with **Open Anyway** (right-click → Open, or System Settings → Privacy & Security → Open Anyway) instead of hard-blocking the app.
- Note: until the app is signed with an Apple Developer ID and notarized, macOS will still warn on first launch — use the Open Anyway flow to proceed.

## [0.1.4] - 2026-08-05

- Bundled the Maximo Syntax CLI engine **v0.1.26** (from v0.1.23) — new desktop downloads now ship the latest CLI, including the `/goal` autonomous-mode fixes for desktop/SDK hosts and the improvements in v0.1.24–v0.1.26. Existing installs can get it via Settings → System tools → engine update, or by reinstalling.

## [0.1.3] - 2026-08-05

- Added **edit-and-resend** on user messages: rewrite the turn in place, fork the CLI transcript at the message before it, and replay the edited prompt with a fresh turn uuid (the CLI dedups by uuid, so the resent turn replaces the original instead of appending).
- Added **revert-to-message** on user messages: discard every later turn (and its pins/markers) and resume the CLI transcript anchored at the target message; optionally restore files changed by the discarded turns by reverse-applying the recorded file changes (or the CLI `rewind_files` checkpoint when a warm session has one).
- Added Synara-style frosted tooltips app-wide via `[data-tooltip]` (rounded translucent popover with backdrop blur, all four sides, pure CSS).
- Modal overlays (Account, What's new, attachment preview) two-phase freeze the native browser: capture a live page screenshot first, then detach WebContentsView and show that frame under the blur (no white/black fill, no page reload during capture).
- Added **/goal** autonomous mode: set or manage an autonomous goal (`<objective> [--budget <tokens>] | status | pause | resume | clear`) with a live status banner over the conversation (active/paused/complete phases from CLI activity).
- Clamped long user messages to a visual max-height with a fade mask and **Show more/less**, so oversized prompts no longer balloon the chat column.
- Added Synara-style **pasted-text cards**: large pasted text is collapsed into a card above the composer (and in the transcript), sent as a trailing `<pasted_text>` block, and expandable in place.

## [0.1.2] - 2026-08-04

- Added a desktop update checker that polls GitHub Releases and surfaces a Synara-style **Update** button in the sidebar footer when a newer app version is available; click opens the matching installer download (or release page).
- Added **Check for Updates…** to the app/Help menu and a Desktop updates section under Settings → System tools.
- Added a Synara-style **What's new** post-update popout and dialog that surfaces release notes from GitHub Releases (with local CHANGELOG fallback), including a full changelog view and Settings entry.
- Expanded Appearance theme presets with the Synara/Codex catalog (Catppuccin, Dracula, Everforest, GitHub, Gruvbox, Linear, Nord, Rose Pine, Tokyo Night, Vercel, and more), filtering dark-only / light-only seeds per theme pack.
- Contained chat markdown so long AI replies (fenced code, inline paths/selectors, wide tables, media) no longer expand the conversation column off-screen.
- Fixed theme preset “Aa” badge alignment in Appearance settings (badge was stretched by select-trigger flex rules).
- Made “Worked for …” expand snappy: open state paints immediately, timeline rows stream in, and heavy tool/agent details only mount when each row is opened.
- Added fully functional Synara-style appearance customization system (independent Light and Dark theme packs with accent/background/foreground colors, presets, sharing strings, typography/font-family overrides, translucent sidebar toggles, and contrast sliders).
- Repositioned branding from "agentic coding desktop" to "your AI workspace for work" — framing the app for code, documents, data, research, and organization, not just software development.
- Added SEO metadata (description, keywords, Open Graph, Twitter cards) to the renderer shell.
- Added an **Open Folder…** menu item (⌘⇧O / Ctrl+Shift+O) alongside Open Project.
- Moved macOS/Linux installer category from developer-tools to productivity.
- Added open-source housekeeping: `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`.

## [0.1.1] - 2026-08-04

- Matched Synara’s theme-aware sidebar surface so the left navigation rail now shifts with the active Light, Dark, or System appearance while preserving the existing translucent depth.
- Expanded settings with Synara-inspired profile statistics, activity heatmap, model usage, notifications, integrations, archive management, and shortcut reference.
- Added functional desktop notifications with click-through, notification sound controls, and in-app attention alerts.
- Added full workspace keyboard shortcut handling and custom settings selectors.
- Improved settings layering so native workspace panels are suspended while Settings is open.

## [0.1.0] - 2026-08-04

- Initial release.
- Agentic chat workspace over the bundled Maximo Syntax CLI engine.
- Projects, spaces, pinned chats, and work surfaces: chat, activity timeline, kanban, pull requests.
- Multi-provider sign-in: Maximo AI subscription, API keys, MyTabulon, Cencori, OpenRouter, OpenCode Go/Zen.
- Built-in PTY terminal, run log, and workspace browser.
- Inline diff and pull-request review.
- Granular permission modes including explicit full access.
- Local-first state with a typed, sandboxed preload bridge.
