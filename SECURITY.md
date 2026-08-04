# Security Policy

## Supported versions

Only the latest stable release is supported with security updates. Please upgrade to the newest release to receive fixes.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** Report them privately so they can be addressed before disclosure.

Please email `security@maximoai.co` with:

- A description of the vulnerability and the affected component (renderer, main process, CLI engine, etc.).
- Steps to reproduce, if possible.
- Any proof-of-concept or impact assessment.

You will receive a response as soon as possible. We ask that you keep the report confidential until a fix is released.

## What to include

- The version of Maximo Syntax Desktop affected.
- The platform (macOS / Windows / Linux) and architecture.
- Whether the issue affects the renderer, the main process, the preload bridge, or the bundled CLI.

## Disclosure

We aim to respond within 7 days with an assessment, and to publish a fix and advisory as appropriate. We credit reporters who follow coordinated disclosure unless they prefer to remain anonymous.

## Security model notes

This app is designed to be secure by default: the renderer has no Node access, Electron runs with context isolation and sandboxing, navigation is blocked, and all filesystem/process/Git/dialog/shell actions are validated in the main process. If you believe any part of that boundary can be crossed, please report it.
