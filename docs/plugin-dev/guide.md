# Marketplace Plugin Developer Guide

This guide is for developers who create DevToolBox marketplace plugins.

Marketplace plugins run inside an isolated iframe runtime. Plugins must not call Electron/Node APIs directly. All privileged operations must go through the host-provided SDK.

## Quick Start

### Prerequisites

- Node.js 20 (see `.nvmrc`)
- pnpm 10

### Create a Plugin Template

```bash
./cli.sh plugin create
```

This creates a new workspace package under:

- `marketplace/modules/market-<your-id>/`
- package name convention: `@devtoolbox/plugin-market-<your-id>`

### Develop and Build

```bash
pnpm --filter @devtoolbox/plugin-market-<your-id> build
```

The plugin build output is written to the `package/` directory inside the plugin folder (the path is controlled by `manifest.entry` and Vite `outDir`).

### Install Locally (file:// registry)

```bash
node marketplace/scripts/pack-local.mjs market-<your-id>
```

This generates:

- `marketplace/registry.local.json`
- `marketplace/.local-dist/market-<your-id>-<version>.zip`

Then in DevToolBox (development builds):

- Settings → Marketplace (Dev) → Registry URL → paste the `file:///.../marketplace/registry.local.json` URL
- Modules → Refresh → Install

## Plugin Package Layout

A marketplace plugin is distributed as a zip file with:

- `manifest.json` at the package root
- an entry folder that contains the built web assets

Example:

```text
market-foo-1.0.0.zip
├── manifest.json
└── package/
    ├── index.html
    └── assets/...
```

## manifest.json (Complete Field Rules)

DevToolBox validates the plugin manifest on install. The validation rules are implemented in:

- `core/main/ipc/marketplace.ts` → `validateManifest()`

Required fields:

- `id`
  - kebab-case
  - must start with `market-`
- `name`, `description`
- `version`
- `sdkVersion`
- `entry` (path to entry html inside the package, e.g. `package/index.html`)
- `categoryId`
- `author`, `license`, `homepage`, `repository`
- `permissions` (must not be empty)

Conditional fields:

- If `permissions` includes `http:external`, `httpDomains` must be non-empty and valid
- If `permissions` includes `system:env:read`, `envAllowlist` must be non-empty

Tip: the registry entry manifest and the zip package manifest must match (id/version/sdkVersion/entry/categoryId/author/license/homepage/repository/permissions/httpDomains/envAllowlist/i18n).

## Permissions and Capabilities

Plugins must declare permissions in the manifest and the host enforces them on every SDK call. See:

- [Plugin SDK Contract](sdk.md)

Common permissions:

- `storage:kv`: namespaced key-value storage
- `http:proxy`: host HTTP proxy (recommended to avoid CORS issues)
- `net:socket`: host socket API for TCP/UDP-style tools
- `net:ssh`: host SSH shell and SFTP capability

## SDK Request/Response Model

Plugins communicate with the host via `postMessage` request/response:

- request: `{ type: 'devtoolbox:sdk:request', requestId, method, params }`
- response: `{ type: 'devtoolbox:sdk:response', requestId, ok, data? | error }`

Most plugins implement a small `sdk.ts` wrapper that:

- manages a pending map by `requestId`
- provides typed helpers like `sdk.storage.get` / `sdk.http.request`
- subscribes to host events (if needed)

## Realtime Events (socket domain)

For TCP/UDP tooling, plugins should use the socket capability:

- SDK methods: `sdk.socket.*`
- Event stream: `{ type: 'devtoolbox:sdk:event', domain: 'socket', payload: ... }`

Details (API + event shape):

- [Plugin SDK Contract](sdk.md)

## Local Development vs Packaged Builds

DevToolBox enforces different policies based on environment:

- Development builds allow `file://` registries and downloads for local plugin development
- Packaged builds only allow `https://` registries and downloads

## Publishing (Registry + Zips)

This repository publishes marketplace artifacts as a GitHub Release asset bundle:

- `marketplace/scripts/pack-release.mjs` produces:
  - `marketplace/release-dist/registry.json`
  - `marketplace/release-dist/*.zip`
- GitHub workflow `Marketplace Release` uploads those files to a release tag (default tag: `marketplace`)

For the exact workflow steps, see:

- `.github/workflows/marketplace-release.yml`

## Review and Compliance Checklist

Before submitting/publishing a plugin, verify:

- Manifest passes validation rules (required fields, kebab-case `id`, non-empty `permissions`)
- Registry manifest and package manifest are identical on install-critical fields (id/version/sdkVersion/entry/categoryId/author/license/homepage/repository/permissions/httpDomains/envAllowlist/i18n)
- If you request `http:external`, you must provide `httpDomains` and they must not target localhost/private networks
- If you request `system:env:read`, you must provide `envAllowlist`
- Your UI works inside an iframe sandbox (no direct Electron/Node access)

CI in this repo validates marketplace changes on PR/push:

- `.github/workflows/marketplace.yml` (typecheck + lint + build)

## Plugin Versioning and Upgrades

- Plugins are versioned by `manifest.version`
- DevToolBox compares the installed version with the registry version
- When the registry version is newer, the Modules page shows Upgrade / Update All
