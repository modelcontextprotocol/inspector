# Inspector V2 Tech Stack - CLI, TUI, and Launcher

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | V2 Tech Stack | [V2 UX](v2_ux.md)

#### [Web Client](v2_web_client.md) | CLI, TUI, Launcher | [Server](v2_server.md) | [Storage](v2_storage.md)

## Summary

v2 ships three non-web Inspector incarnations alongside the web client: a **one-shot CLI**, an **interactive TUI**, and a **launcher** that routes to web, CLI, or TUI from a single `mcp-inspector` binary. All three consume the same `core/` source as the web client via the `@inspector/core` path alias and run on the shared `InspectorClient` stack ported from v1.5/main.

This document describes how those clients are built, wired, and tested today, and records known gaps. For catalog vs launch-time config semantics (`--config`, `--catalog`, import), see [Catalog and Launch Configuration](v2_catalog_launch_config.md).

## Goals

- One published entry binary (`mcp-inspector`) that forwards argv to the selected client.
- CLI and TUI use the same `InspectorClient`, managed-state classes, and `resolveLaunchServerConfigs()` path as v1.5 — adapted to v2's `InspectorServerSettings` model (post-#1358).
- Bundle `core/` into CLI/TUI Node artifacts with **tsup** (analogous to Vite bundling core for the browser).
- Port v1.5 CLI integration tests (86 cases) and TUI smoke tests without duplicating `core/` unit tests (web suite remains canonical for core).
- CI runs CLI and TUI tests plus a launcher `--help` smoke step on every PR.

## Non-goals

- **CLI v2 sessions** (connect once, many subcommands) — tracked separately in [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432).
- **npm workspaces** — v2 uses a fat root package plus per-client `package.json` for dev dependencies; launcher resolves sibling `build/` outputs via relative paths, not workspace hoisting.
- **Per-client coverage gates** — `core/` coverage stays on the web suite; CLI/TUI source gates are follow-up work (see [Known gaps](#known-gaps)).
- **Catalog CRUD in TUI** — TUI loads and connects; persistent catalog editing remains web-first today.

---

## Packaging and entrypoints

| Artifact | Path | Build | Published bin |
|----------|------|-------|---------------|
| Launcher | `clients/launcher/` | `tsc` → `build/index.js` | Root `mcp-inspector` → `clients/launcher/build/index.js` |
| CLI | `clients/cli/` | `tsup` → `build/index.js` | `mcp-inspector-cli` (client package only) |
| TUI | `clients/tui/` | `tsup` → `build/index.js` | `mcp-inspector-tui` (client package only) |
| Web runner | `clients/web/server/run-web.ts` | `tsup` (`build:runner`) → `clients/web/build/index.js` | `mcp-inspector-web` (client package only) |

Root `package.json` (`@modelcontextprotocol/inspector` v2) publishes a **fat package**: merged runtime `dependencies`, `files` manifest listing each client's `build/` (and web `dist/`), and `prepack` → full `npm run build`. The launcher does not declare `file:` sibling dependencies; it dynamically imports `../web/build/index.js`, `../cli/build/index.js`, or `../tui/build/index.js` relative to its own `build/` directory.

**Published runtime deps — Vite:** `vite` and `@vitejs/plugin-react` are production `dependencies` (not devDependencies) because `mcp-inspector --web --dev` starts an in-process Vite dev server at runtime (`start-vite-dev-server.ts`). A `npx @modelcontextprotocol/inspector` install therefore pulls the Vite toolchain even for CLI/TUI-only users; that install footprint is intentional so `--web --dev` works without a separate dev setup.

**Typical invocations:**

```bash
mcp-inspector                          # web (prod Hono server)
mcp-inspector --web --dev              # web (Vite dev server)
mcp-inspector --cli --config mcp.json --server my-api --method tools/list
mcp-inspector --tui --config mcp.json
```

Root scripts `inspector`, `web`, and `web:dev` are thin wrappers around the launcher binary.

---

## Launcher

`clients/launcher/src/index.ts` reads mode only from a **launcher prefix**: a contiguous run of `--web`, `--cli`, or `--tui` immediately after the script name (default **web** when omitted). Prefix mode flags are stripped; everything from the first non-mode token onward is forwarded unchanged. Later tokens equal to `--web`/`--cli`/`--tui` are treated as app args (e.g. stdio server config), not launcher mode. More than one mode flag in the prefix is an error.

- **No core imports** — plain TypeScript compile is sufficient.
- **Argv forwarding** — app flags and positionals pass through unchanged so each client's Commander parser owns server and method options.
- **Help** — `mcp-inspector --help` shows launcher help; `mcp-inspector --cli --help` forwards to CLI help.

**Production web caveat:** launcher `prebuild` chains `build:runner` for web, not a full `vite build`. Running `mcp-inspector --web` (without `--dev`) requires `clients/web/dist/` from a prior `cd clients/web && npm run build`. CI builds CLI, TUI, and launcher before the launcher smoke step but does not currently validate prod web startup end-to-end.

**Build targets:** client `tsup` bundles target `node22`, aligned with root `engines.node` (`>=22.7.5`).

---

## Shared core consumption

All three clients import from `@inspector/core/...` (mapped to `../../core/` source).

| Concern | Web | CLI / TUI | Launcher |
|---------|-----|-----------|----------|
| Dev typecheck | `tsconfig.app.json` paths | per-client `tsconfig.json` paths | `tsconfig.json` (no core) |
| Runtime bundle | Vite alias | tsup `noExternal: [/^@inspector\/core/]` + esbuild alias | n/a |
| Tests | Vitest projects in `clients/web/` | Vitest + `vitest.shared.mts` aliases | none |

`vitest.shared.mts` at repo root centralizes `@inspector/core` and test-server aliases plus bare-module pins (`react`, `pino`, SDK, etc.) so CLI/TUI Vitest configs stay aligned with web.

**Resolved design choices:**

| Topic | Decision |
|-------|----------|
| Core package | No separate `inspector-core` npm package; source-only `core/` |
| CLI/TUI build | tsup bundles `@inspector/core` into `build/index.js` |
| Core tests | Not duplicated under cli/tui; web unit + integration suites cover `core/` |
| Default config path | `resolveLaunchServerConfigs()` applies `withDefaultConfigPath()` → `~/.mcp-inspector/mcp.json` when no `--config` and no ad-hoc target |

---

## CLI

**Model:** one-shot — each invocation connects, runs a single `--method`, prints JSON to stdout, disconnects, exits. Same surface as v1.5; session-oriented CLI v2 is future work ([#1432](https://github.com/modelcontextprotocol/inspector/issues/1432)).

**Entry:** `clients/cli/src/index.ts` exports `runCli(argv)`; `src/cli.ts` owns Commander parsing and `InspectorClient` orchestration.

**Server resolution:**

1. Positional `[target...]` (command/URL) and/or `--config` + `--server`, plus `-e`, `--cwd`, `--transport`, `--server-url`.
2. `resolveLaunchServerConfigs(serverOptions, "single")` in `core/mcp/node/config.ts` — applies default catalog path when appropriate.
3. Ad-hoc `--header` pairs map to `InspectorServerSettings` and pass into `InspectorClient` via `serverSettings` (not `MCPServerConfig.headers`).

**Gap — config-file settings:** when loading from a config file, CLI uses `loadServerFromConfig()` / bare `MCPServerConfig` only. Persisted `headers`, timeouts, and OAuth fields on disk (post-#1358 flat entry shape) are **not** lifted into `serverSettings`. TUI uses `mcpConfigToServerEntries()` and does lift them. Ad-hoc `--header` on CLI works; file-backed settings do not.

**Tests:** 86 cases in `clients/cli/__tests__/` spawn `node build/index.js` via `cli-runner.ts` (`pretest` builds test-servers + CLI). Core behavior is exercised; Vitest coverage on `src/cli.ts` is invisible to the coverage instrumenter because tests run out-of-process (see [Known gaps](#known-gaps)).

---

## TUI

**Model:** interactive terminal UI (Ink + React 19) mirroring web information architecture: Servers, Tools, Prompts, Resources, Logs, OAuth, etc.

**Entry:** `clients/tui/index.ts` exports `runTui(argv)`; `tui.tsx` parses argv and renders `App`.

**Server resolution:** `loadTuiServers()` in `clients/tui/src/tui-servers.ts`:

- **Config file path:** reads JSON, runs `mcpConfigToServerEntries()` — returns `{ config, settings }` per server (correct post-#1358 path; matches web `useServers`).
- **Catalog file:** applies `withDefaultConfigPath()` before reading the file (default catalog when no `--config` or ad-hoc target).
- **Ad-hoc:** `resolveLaunchServerConfigs(..., "multi")` for a single inline server; merges launch-time `--header` into `settings`.

**Core hooks:** TUI uses the same managed-state and `useInspectorClient` patterns as web (`ManagedToolsState`, etc.) inside Ink components.

**Behavior note:** v2 core only auto-refreshes tool/resource lists when `autoRefreshOnListChanged` is true in server settings; v1.5 TUI always auto-refreshed. Port accepts v2 core behavior; UI indicator parity with web is open ([#1402](https://github.com/modelcontextprotocol/inspector/issues/1402)).

**Tests:** 2 cases in `clients/tui/__tests__/tui.test.ts` assert `tabsConfig` shape only. Config parsing, OAuth, and Ink component flows are untested.

**Dev:** `npm run dev` in `clients/tui` uses `vite-node` + `dev.ts` for fast iteration without a full tsup rebuild.

---

## Web runner (`runWeb`)

The launcher `--web` path does not start Vite via the `npm run dev` script. It calls `runWeb(argv)` from `clients/web/server/run-web.ts`, which:

1. Parses the same server-selection flags as CLI/TUI (`--config`, `--server`, positional target, `-e`, `--cwd`, `--transport`, `--server-url`, `--header`, `--dev`).
2. Resolves one `MCPServerConfig` via `resolveServerConfigs()` (explicit options only — no default catalog injection) when server input is present.
3. Passes `initialMcpConfig` into `buildWebServerConfig()` → `GET /api/config` legacy channel.
4. Starts `startViteDevServer()` (`--dev`) or `startHonoServer()` (prod).

**Gap — launch-time headers:** `--header` is accepted but logs a warning; headers are not applied to the web session. The v2 web UI configures HTTP headers via per-server settings in the catalog (`ServerSettingsForm`), not via `initialMcpConfig`. Extending `InitialConfigPayload` (or equivalent) is required for launcher-passed headers to reach the UI.

Day-to-day web development still uses `cd clients/web && npm run dev` (Vite CLI + env-based `buildWebServerConfigFromEnv`).

---

## Server configuration flags (shared)

CLI, TUI, and `runWeb` share launch-time server options documented in v1.5's `docs/mcp-server-configuration.md` (port to v2 pending). Common flags:

| Flag | Purpose |
|------|---------|
| `--config <path>` | MCP servers JSON file |
| `--server <name>` | Named entry within config (required when file has multiple servers) |
| `[target...]` | Ad-hoc stdio command/args or HTTP URL |
| `-e KEY=VALUE` | Stdio environment overrides |
| `--cwd <path>` | Stdio working directory |
| `--transport` | `stdio`, `sse`, or `http` |
| `--server-url <url>` | HTTP/SSE endpoint |
| `--header "Name: Value"` | Launch-time HTTP headers (CLI/TUI ad-hoc → `serverSettings`; web → warning only) |

CLI additionally requires `--method` and method-specific args (`--tool-name`, `--uri`, etc.). Semantics for catalog vs session config, `--catalog`, and `servers/import` are in [v2_catalog_launch_config.md](v2_catalog_launch_config.md).

---

## Testing and CI

| Suite | Location | Count | How |
|-------|----------|-------|-----|
| CLI | `clients/cli/__tests__/` | 86 | Subprocess `node build/index.js` |
| TUI | `clients/tui/__tests__/` | 2 | In-process imports |
| Launcher | CI smoke only | 3 | `--help`, `--cli --help`, `--tui --help` |
| Core | `clients/web/src/test/` | — | Canonical; not duplicated in cli/tui |

**Root orchestration:** `npm run test` chains web unit tests, then `clients/cli` and `clients/tui` tests. `npm run test:coverage` runs web coverage only.

**CI** (`.github/workflows/main.yml`): after web validate + coverage, installs and tests CLI and TUI, builds TUI + launcher, runs launcher help smoke.

**Prerequisites:** CLI `pretest` runs `test-servers:build` (`tsc -p test-servers`) so stdio integration tests can spawn `test-servers/build/test-server-stdio.js`.

---

## Developer setup

v2 does not use npm workspaces. Each client maintains its own `package.json` and `node_modules`:

```bash
npm install                    # root (launcher runtime deps)
cd clients/web && npm install  # required for web dev/test
cd clients/cli && npm install  # required for CLI build/test
cd clients/tui && npm install  # required for TUI build/test
cd clients/launcher && npm install
```

**Build order for a full local smoke:**

```bash
npm run build:web    # includes build:runner for runWeb
npm run build:cli
npm run build:tui
npm run build:launcher
```

Root `npm run validate` currently runs web validate only; extending it to CLI/TUI build + test is follow-up work.

---

## Known gaps

| Area | Gap | Tracking |
|------|-----|----------|
| **CLI config-file settings** | Disk `headers` / timeouts / OAuth not lifted when `--config` is used | This spec; [catalog doc](v2_catalog_launch_config.md) G1 |
| **Web launch headers** | `runWeb --header` warns but does not apply settings to UI | This spec; [#1246](https://github.com/modelcontextprotocol/inspector/issues/1246) |
| **TUI list-changed UX** | No stale-list indicator when `autoRefreshOnListChanged` is false | [#1402](https://github.com/modelcontextprotocol/inspector/issues/1402) |
| **TUI test coverage** | Only `tabsConfig` shape tested | Expand `tui-servers.ts`, Ink flows |
| **CLI coverage gates** | Subprocess tests don't instrument `src/cli.ts` | In-process `runCli()` runner + thin binary E2E suite |
| **Prod web via launcher** | Requires pre-built `clients/web/dist/` | Document or wire into launcher prebuild |
| **Import / `--catalog`** | `servers/import`, `--catalog` not implemented | [catalog doc](v2_catalog_launch_config.md); [#1348](https://github.com/modelcontextprotocol/inspector/issues/1348) |
| **README refresh** | Client READMEs may lag v2 install/build commands | `clients/*/README.md`, `AGENTS.md` |
| **Root validate** | Does not build/test CLI/TUI | Root `package.json` |
| **Root postinstall** | Optional one-shot `npm install` in all clients | Declined workspaces; lighter alternative |

---

## References

- `clients/launcher/src/index.ts` — mode routing and dynamic import
- `clients/cli/src/cli.ts` — CLI parsing, `InspectorClient` one-shot flow
- `clients/tui/src/tui-servers.ts` — config + settings load path (correct for v2)
- `clients/web/server/run-web.ts` — launcher web entry
- `core/mcp/node/config.ts` — `resolveLaunchServerConfigs`, `resolveServerConfigs`, `withDefaultConfigPath`
- `core/mcp/serverList.ts` — `mcpConfigToServerEntries`
- `vitest.shared.mts` — shared Vitest aliases
- [v2_catalog_launch_config.md](v2_catalog_launch_config.md) — catalog and launch config, import, UC1–UC5
- [v2_servers_file.md](v2_servers_file.md) — catalog file format and web CRUD
- [#1246](https://github.com/modelcontextprotocol/inspector/issues/1246) — port tracking issue
- v1.5 sources: `v1.5/main/clients/{cli,tui,launcher}`
