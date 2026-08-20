# Changelog

All notable changes to Maximo Syntax Desktop are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- **Sub-agent timeline**: chat timeline rows now use a dedicated sub-agent icon and show `subagent: <task title>` instead of the generic `general-purpose` type name. The activity status list and the live "Thinking with…" labels use the same friendly titles, and a dedicated bot badge appears on sub-agent rows.
- **Honest stop messages**: stopping a run no longer fabricates a "Run stopped." assistant answer — the turn is recorded with an interrupted flag and a **"You stopped after"** disclosure instead, so closing work mid-turn is visibly a stop, not an answer.
- **Bigger attachments**: the attachment limit rises to **100 MB** (from 25 MB), expanding video type support (mp4, mov, mkv, avi, wmv, mpeg, webm and more) with inline video playback in the preview, and oversized files now surface a **dedicated rejection modal** instead of silently dropping.
- **Bundled CLI engine**: the desktop build now bundles CLI `v0.1.37`, which uses the same logged-in account catalog as `/model` for sub-agent model/effort (Maximo AI, MyTabulon, Cencori, OpenRouter, OpenCode) and no longer advertises Claude leftovers like `sonnet` / `opus` / `haiku`.
- **Open-folder icon**: expanded projects in the sidebar now show an open folder icon.
- **Diff controls**: the workspace diff pane's Collapse/Expand button now collapses or expands every file at once, and the Diff options menu gains matching Expand all / Collapse all entries.
- **AppSnap**: opt-in macOS capture that attaches the frontmost app window to the current chat when you press both Option keys (or a custom two-key shortcut). Includes a native helper that runs as part of Maximo Syntax (so System Settings shows the Maximo logo for Screen Recording and Input Monitoring), permission setup, a first-run welcome sheet, capture sound, and pending-capture recovery if the composer is unavailable.

## [0.1.11] - 2026-08-14

- **Bundled CLI engine**: the desktop build now bundles CLI `v0.1.33`, whose MyTabulon default is Atlas 1.2; existing Atlas Preview selections are migrated before a run.
- **Reliable completed-turn diffs**: large files now keep accurate focused patches instead of appearing as full-file replacements, legacy saved patches are repaired when displayed, and timeline reviews remain available in a dedicated **Selected turn** source after the working tree has been committed or pushed. Working-tree, staged, and unstaged views now show their own file totals and patches consistently.
- **Diff review per Git scope**: the Source control pane and diff review now fetch staged and unstaged diffs separately (accurate totals per file), and a history note explains when a diff came from a saved turn.
- **Transcript stability fixes**: timeline rows, agent work items, and open disclosures no longer remount when live entries stream in; interactive transcript controls (disclosures, links, buttons) now suspend auto-follow until you scroll back to the edge, and the scroll-back threshold is stricter after you take ownership.
- **Automation cursor polish**: the browser automation cursor is smaller with a click pulse ring, edge-aware label flipping, and concise tool labels ("Clicking", "Typing", "Reading") instead of "Maximo is…" phrasing.

## [0.1.10] - 2026-08-10

- **Project editor**: projects now support a name, icon, and accent color, chosen in a unified Project Editor dialog used for both creating (replacing the old create form) and editing (replacing the prompt-based rename) — project icons appear in the sidebar and hover card.
- **Persistent browser profile**: the in-app browser now keeps a shared profile backed by an atomic JSON file — encrypted password manager (via `safeStorage`), searchable history, site permissions, and never-save origins, wired into autofill, credential/permission prompts, downloads (ask-where + auto-save with unique names), find-in-page, zoom, and history address suggestions, plus keyboard shortcuts (Cmd+L/F/T/W/R). A new Settings → Browser panel manages passwords, downloads, and browsing data.
- **Stale-session run recovery**: when dispatching chat runs, the desktop now recovers when the renderer missed a warm session's started event or still remembers a process that has already exited — retrying the complementary action instead of failing — while genuine run errors are never redelivered.

## [0.1.9] - 2026-08-09

- **Profile sharing**: a Share button on the profile stats panel renders a shareable stat card (lifetime tokens, peak day, streaks, top provider, activity heatmap) to a PNG via canvas, with Copy to clipboard (native Electron clipboard for real image paste), Save to downloads, and one-click share intents for X, LinkedIn, and Reddit.
- Added a profile **Edit dialog** (display name, username, avatar color) replacing the inline edit card.
- **Generated image card — 2026 Liquid Glass restyle**: markdown images now render as a rounded 20px squircle card with soft layered shadows, shimmer skeleton, hover-revealed liquid-glass action bar (caption + Preview/Copy/Share/Download/Open), and a full-screen glass lightbox (blurred backdrop, radial glow, 22px rounded image, floating control pill) — Liquid Glass / Glassmorphism 2.0, squircle corners.
- Removed `AI generated` top badge and fixed Preview pill centering: single `transform: translate(-50%,-50%)` at `left:50% top:50%` and transparent image background for perfect centering.
- Fixed long prompts pushing image action buttons inward: caption truncated to 72 chars and CSS `flex:1 1 0` + `min-width:0` + `text-overflow:ellipsis` with `flex-shrink:0` on buttons.
- Upgraded the bundled CLI engine to **v0.1.32** (from v0.1.28): adds **ImageGeneration** (`Maximo AI → /v1/api/image-generation`, `MyTabulon → /v1/image-generation`) with verbatim URL handling (`Image 1 URL:`) and a fully generic prompt (no hard-coded domains, blocks `https://example.com` and other placeholders, forbids any `![...](https://...)` on empty results); fixes Extra High effort crash (`--effort xhigh`); adds Image icon and "Generated image" activity label.
- Fixed generated images not rendering in chat: `Content-Security-Policy` now allows `img-src 'self' data: https: http: blob:` and `connect-src` includes both backends, so remote `https://.../uploads/ai-images/...` URLs load inline.
- Added a **Kilo model logo** (and provider detection) alongside the existing brand logos, with tests.
- Isolated live streaming from the app shell with an external live-run store to cut renderer churn, dispatch runs by real CLI turn state, keep live markdown formatted while streaming, and defer visual reduction during interaction.
- Ship **summary/full thread detail** with a selection checkpoint, new-chat starter flows, and compact history.
- Moved **task-completion notifications** to the main process (survive renderer churn) and made slash-command search match any part of the name.
- Added a **topbar chat options menu**, thread rename dialog, and sidebar reopen button with an activity badge (unread prioritized over running).
- Start a chat straight from **project rows**, style added-context as collapsible bubbles, and drop the space picker from project creation.
- Flush the persistent browser session on quit and keep panel resize callbacks stable.


## [0.1.8] - 2026-08-06

- Fixed mid-turn model/effort changes: when the user switches model or effort while a warm session is still running, the desktop now restarts the session with `--resume` at the transcript anchor so the new flags take effect instead of reusing the stale live process; follow-up injections ride the same turn and intentionally do not restart.
- Fixed effort being silently dropped when the user picks a custom model slug or changes effort while the engine catalog is still loading — the CLI shim now forwards it and the provider validates, instead of requiring the catalog to declare `supportsEffort`.
- Fixed the thread message-model/effort fields being left stale when the user clears them to "Default" — the store now deletes the field instead of keeping the previous non-default.


## [0.1.7] - 2026-08-06

- Faster, smoother thread switching: selection now applies optimistically from already-loaded state, the outgoing transcript stays visible while a large incoming thread hydrates at idle priority (progressive 40 → 80 message reveal), and expanded user-message state is preserved per thread.
- Added a per-thread sequence guard so rapidly scrubbing the sidebar can never let a slow IPC reply for an earlier thread overwrite the newer selection.
- Isolated render failures: a thread-level error boundary shows a retryable fallback instead of blanking the chat, and a top-level app error boundary keeps a crashed render from leaving an empty window.
- Added transient retry with jittered backoff for flaky IPC calls (git branches/diffs, engine models, context usage, attachment previews, run/follow-up submission, settings, update checks), surfacing a compact non-blocking "Retrying 1/3" notice instead of blocking AI work.
- Retried the latest-CLI-version fetch up to 4 times with backoff on 5xx/network errors, and made the live run-event pipeline yield to user input and isolate per-event errors so one bad event can't kill streaming.
- Upgraded the bundled CLI engine to **v0.1.28**, fixing the Extra High effort crash.
- Diff workspace improvements: lazy per-file inline diffs with per-file collapse, a jump-to-file search, and file context menus (refer in chat / ask why it changed / copy path); the selected file always expands and caches its patch when opened from the timeline.
- Normalized git status codes (`??` → `?`, rename collapse) and line counts for untracked files so the diff tree no longer shows `+0 -0` for brand-new files.
- Documented the macOS Gatekeeper first-launch workaround in the README.


## [0.1.6] - 2026-08-05

- Fixed the macOS launch failure introduced in v0.1.5 ("The application cannot be opened for an unexpected reason, error=Code=163"). The v0.1.5 build stripped the code signature entirely, and Apple Silicon's arm64 kernel refuses to execute a fully unsigned Mach-O binary. v0.1.6 restores the working ad-hoc signed build (same as v0.1.4): the app launches normally, and if Gatekeeper blocks a downloaded copy, clear the quarantine flag with `xattr -dr com.apple.quarantine "/Applications/Maximo Syntax.app"` (or right-click → Open).
- Note: until the app is signed with an Apple Developer ID and notarized, macOS may warn on first launch for downloaded copies — the `xattr` command (or right-click → Open) is the current fix.

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
