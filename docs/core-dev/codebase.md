# Codebase Overview

This document is a high-level map of the codebase for contributors.

## Key Concepts

- The app is an Electron desktop application (`app`).
- The UI is a React app running in the renderer process.
- Tool modules are auto-discovered via `import.meta.glob` and rendered inside a shared layout.
- IPC is centralized: renderer → preload → main process.
- Repo workflows (dev/build/package/check/marketplace) are exposed via `cli.sh`: see [cli.md](../shared/cli.md).

## Repository Structure

```text
core/
  main/                     Electron main process
  main/preload/             Preload bridge (contextBridge APIs)
  renderer/                 React renderer app
  packages/core/            Stable types / conventions shared across apps
  packages/ui/              Shared UI components & hooks
docs/                       Developer documentation
scripts/                    Repo tooling (scaffolding, validators)
```

## Adding a Tool Module

Create a module under:

`core/renderer/components/ModuleTools/<YourTool>/`

Required files:

- `config.tsx` (module metadata)
- `index.tsx` (tool UI)
- `<Tool>.module.css` (CSS Modules)

Also update i18n strings when needed:

- `core/renderer/i18n/locales/en/common.ts`

## IPC Guidelines

- Define IPC handlers in main under `core/main/ipc/`.
- Expose safe APIs via `core/main/preload/index.ts`.
- Type the API in `core/renderer/types/electron.d.ts`.

## Quality Gates

```bash
pnpm format:check
pnpm lint
pnpm lint:modules
pnpm typecheck
pnpm test
```

See also:

- [dev-guide.md](./guide.md)
- [module-api.md](./module-api.md)
- [ipc-api.md](./ipc-api.md)
- [ui-guidelines.md](./ui-guidelines.md)
