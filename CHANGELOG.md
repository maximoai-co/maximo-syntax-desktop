# Changelog

All notable changes to Maximo Syntax Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
