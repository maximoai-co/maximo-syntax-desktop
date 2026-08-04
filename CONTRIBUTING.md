# Contributing to Maximo Syntax Desktop

Thanks for wanting to contribute! This project is MIT-licensed and community contributions are welcome. Please keep the following guidelines in mind.

## Getting started

1. Fork the repository.
2. Clone your fork and install dependencies:

   ```bash
   git clone <your-fork-url>
   cd maximo-syntax-desktop
   npm install
   ```

   Development requires Node.js 22.12 or newer.

3. Create a branch for your change:

   ```bash
   git checkout -b my-feature
   ```

## Development workflow

```bash
npm run dev        # live renderer reloads
npm start          # build + launch
npm run check      # typecheck + tests + full build (run before opening a PR)
```

## Code style

- TypeScript throughout, `strict` mode enabled in both `tsconfig.json` (renderer) and `tsconfig.electron.json` (main process).
- React components live in `src/components/`, Electron main-process code in `desktop/`.
- Keep the renderer free of Node APIs — everything crosses the typed preload bridge in `desktop/preload.cts`.
- Prefer small, focused files over large ones. Tests sit next to the code they cover (`*.test.ts`).

## Tests

- Unit tests run with [Vitest](https://vitest.dev/): `npm test`.
- Add a test for any new logic; run `npm run check` before submitting.

## Commit messages

Write clear, imperative commit messages, e.g. `Add kanban filtering`, `Fix crash on empty workspace`. Reference any related issue numbers.

## Pull requests

- Open PRs against the `main` branch.
- Explain what the change does and why, and note any manual testing you did.
- Keep PRs focused: one logical change per PR.

## Reporting bugs and security issues

- For security vulnerabilities, do **not** open a public issue. See [SECURITY.md](SECURITY.md).
- For everything else, open an issue with a clear title, reproduction steps, and the version you're on.

## Code of conduct

Be respectful and constructive. Harassment or abusive behavior will not be tolerated.
