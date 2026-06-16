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

| Invocation | Server list | Editable in UI? |
|------------|-------------|-----------------|
| `mcp-inspector --web` | Default catalog `~/.mcp-inspector/mcp.json` | Yes |
| `mcp-inspector --web --catalog <path>` (or `MCP_CATALOG_PATH=<path>`) | That file as the active catalog (created/seeded if missing) | Yes |
| `mcp-inspector --web --config <path>` | That file as a **read-only session** — shown but never written, seeded, or migrated (safe for a foreign config) | No |
| `mcp-inspector --web --server-url <url> --transport http --header "Name: Value"` (or a positional command) | One ad-hoc server held in memory, connectable with the given `--header`s | No |

Rules: `--catalog` and `--config` are mutually exclusive; neither combines with
an ad-hoc target or `--header`; `--header` requires an ad-hoc HTTP/SSE server
and is applied to that connection (it is no longer a warn-only no-op).

## Publishing

The root `@modelcontextprotocol/inspector` package ships as one fat tarball: `npm run build` at the repo root builds all clients, then `prepack` runs before `npm publish`. Runtime dependencies are declared on the root `package.json`; client builds bundle `@inspector/core` and externalize npm packages resolved from the root install.

## Architecture

For how the launcher fits with the shared config processor and app runners, see the [Launcher and config consolidation](../../docs/launcher-config-consolidation-plan.md) document in the repo root `docs/` folder.
