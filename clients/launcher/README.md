# MCP Inspector Launcher

The launcher is the package that provides the global `mcp-inspector` binary (e.g. when users run `npx @modelcontextprotocol/inspector`). It is not a separate user-facing app—it is the single entrypoint that selects and runs one of the clients (web, CLI, or TUI).

## Responsibility

- Parse mode from a leading prefix of `--web` (default), `--cli`, or `--tui` immediately after the script name.
- Forward all following arguments unchanged (including tokens that look like mode flags).
- Dynamically import that app’s runner from `clients/{web,cli,tui}/build/index.js` (relative to the launcher build output) and call it **in-process** (no `spawn()`).

All configuration parsing, config-file loading, and server setup are handled by the app runners and by **core**; the launcher does not interpret config or env vars.

## Web server-list flags (`--web`)

`mcp-inspector --web` chooses which server list the UI shows and whether it is
editable (see [specification/v2_catalog_launch_config.md](../../specification/v2_catalog_launch_config.md)):

| Invocation                                                                                                 | Server list                                                                                                     | Editable in UI? |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------- |
| `mcp-inspector --web`                                                                                      | Default catalog `~/.mcp-inspector/mcp.json`                                                                     | Yes             |
| `mcp-inspector --web --catalog <path>` (or `MCP_CATALOG_PATH=<path>`)                                      | That file as the active catalog (created/seeded if missing)                                                     | Yes             |
| `mcp-inspector --web --config <path>`                                                                      | That file as a **read-only session** — shown but never written, seeded, or migrated (safe for a foreign config) | No              |
| `mcp-inspector --web --server-url <url> --transport http --header "Name: Value"` (or a positional command) | One ad-hoc server held in memory, connectable with the given `--header`s                                        | No              |

Rules: `--catalog` and `--config` are mutually exclusive; neither combines with
an ad-hoc target or `--header`; `--header` requires an ad-hoc HTTP/SSE server
and is applied to that connection (it is no longer a warn-only no-op).

## CLI and TUI server-list flags (`--cli` / `--tui`)

The CLI and TUI use the same `--catalog` / `--config` vocabulary as `--web`,
resolved by the shared `core/mcp/node/config.ts` helpers:

| Invocation                                                         | Server list source                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `mcp-inspector --cli` / `--tui` (no source flag, no ad-hoc target) | Default writable catalog `~/.mcp-inspector/mcp.json` (created/seeded empty if missing)             |
| `--catalog <path>` (or `MCP_CATALOG_PATH=<path>`)                  | That file as a **writable catalog** — seeded empty if missing                                      |
| `--config <path>`                                                  | That file as a **read-only session** — served as-is, never written or seeded; **errors if absent** |
| positional command / `--server-url <url>`                          | One ad-hoc server                                                                                  |

Rules (shared `serverSourceConflict`): `--catalog` and `--config` are mutually
exclusive, and neither combines with an ad-hoc command/URL target. The CLI/TUI
do not perform catalog CRUD yet — they are read consumers — so the
writable/read-only split currently surfaces only as **seed-if-missing**
(`--catalog`/default) vs **error-if-missing** (`--config`). Full writable
persistence is tracked in #1482 / #1432.

### Production web build (`--web`, no `--dev`)

Prod `--web` serves static assets from `clients/web/dist/`, which only exists
after a build. In the published package `dist/` always ships. In a fresh dev
checkout it is absent, so the runner **builds it on demand** the first time you
launch (`vite build` via `npm run build:client`, run in `clients/web`) instead
of serving a broken page (#1486). If that build can't run — e.g. dev
dependencies are missing — the launcher exits with an actionable error telling
you to run `npm run build` (from `clients/web`) or relaunch with `--dev` to use
the Vite dev server. `--dev` never needs `dist/`; it runs Vite directly.

CI and `npm run validate` (via `validate:launcher`) exercise this prod path
end-to-end with `npm run smoke:web` (`scripts/smoke-web.mjs`): it starts
`mcp-inspector --web` against the built `dist/` and asserts `GET /` returns the
SPA (HTTP 200) with the injected `__INSPECTOR_API_TOKEN__`.

### CLI and TUI smokes

`validate:launcher` also runs end-to-end smokes for the other two modes through
the built launcher artifact (beyond the `--help` checks in `smoke:launcher`):

- `npm run smoke:cli` (`scripts/smoke-cli.mjs`) — runs `mcp-inspector --cli`
  against the bundled stdio test server via a temp `--catalog` and asserts
  `tools/list` returns the server's tools, plus the `--catalog`/`--config`
  resolution paths (default-catalog seed-on-missing, read-only `--config`
  error-without-seed, `--catalog`/`--config` conflict).
- `npm run smoke:tui` (`scripts/smoke-tui.mjs`) — launches
  `mcp-inspector --tui --catalog <temp>` and asserts the Ink app renders its
  first frame within a timeout, then shuts it down (a shallow boot/render
  check, not full interaction).

Both build `test-servers/build` on demand if it is missing.

## Publishing

The root `@modelcontextprotocol/inspector` package ships as one fat tarball: `npm run build` at the repo root builds all clients, then `prepack` runs before `npm publish`. Runtime dependencies are declared on the root `package.json`; client builds bundle `@inspector/core` and externalize npm packages resolved from the root install.

## Architecture

For how the launcher fits with the shared config processor and app runners, see the [Launcher and config consolidation](../../docs/launcher-config-consolidation-plan.md) document in the repo root `docs/` folder.
