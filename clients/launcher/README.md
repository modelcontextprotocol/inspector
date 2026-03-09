# MCP Inspector Launcher

The launcher is the package that provides the global `mcp-inspector` binary (e.g. when users run `npx @modelcontextprotocol/inspector`). It is not a separate user-facing app—it is the single entrypoint that selects and runs one of the clients (web, CLI, or TUI).

## Responsibility

- Parse the mode flag: `--web` (default), `--cli`, or `--tui`.
- Forward the rest of `process.argv` to the chosen app.
- Dynamically import that app’s runner and call it **in-process** (no `spawn()`).

All configuration parsing, config-file loading, and server setup are handled by the app runners and by **core**; the launcher does not interpret config or env vars.

## Architecture

For how the launcher fits with the shared config processor and app runners, see the [Launcher and config consolidation](../../docs/launcher-config-consolidation-plan.md) document in the repo root `docs/` folder.
