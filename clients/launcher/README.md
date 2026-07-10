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

CI and `npm run validate` (via the top-level `smoke` step) exercise this prod
path end-to-end with `npm run smoke:web` (`scripts/smoke-web.mjs`): it starts
`mcp-inspector --web` against the built `dist/` and asserts `GET /` returns the
SPA (HTTP 200) with the injected `__INSPECTOR_API_TOKEN__`.

### CLI and TUI smokes

The top-level `smoke` step also runs end-to-end smokes for the other two modes
through the built launcher artifact (beyond the `--help` checks in
`smoke:launcher`):

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

## Development

Like the web client, the launcher self-validates from its own folder:

```bash
npm run validate  # format:check && lint && build && test:coverage
```

This has **no** dependency on the other clients being built — it only checks the
launcher's own source. `eslint.config.js` is a Node-only flat config (the web
client's React/Storybook plugins stripped out), and the per-file coverage gate
covers `parse-launcher-argv.ts` (the pure arg-parsing logic); `src/index.ts` is
excluded as binary bootstrap and is instead exercised by the smokes above. The
repo-root `validate:launcher` simply delegates here (`cd clients/launcher && npm run validate`).

## Publishing

The root `@modelcontextprotocol/inspector` package ships as one fat tarball with a **single version number** (no separate `-web` / `-cli` / `-tui` / `-core` packages): `npm run build` at the repo root builds all clients, then `prepack` runs before `npm publish`. Runtime dependencies are declared on the root `package.json`; client builds bundle `@inspector/core` and externalize npm packages resolved from the root install.

### What ships, and the packaging invariants

The root `package.json` `"files"` allowlist is the source of truth for the tarball. A few non-obvious entries exist because they are read **at runtime** or were silently dropped by the packlist — do not remove them without re-running `npm run pack:verify`:

- **No source maps.** The client bundlers set `sourcemap: false` (`clients/cli/tsup.config.ts`, `clients/tui/tsup.config.ts`, `clients/web/tsup.runner.config.ts`); Vite and the launcher's `tsc` already emit none. Maps are ~half the unpacked size and aren't needed at runtime — debug via `npm run dev` on the source.
- **`clients/web/build` is packed via `clients/web/.npmignore`.** `clients/web/.gitignore` lists `build/`, and npm's packlist honors that nested `.gitignore` over the root `"files"` allowlist — so the prod web-server runner was silently missing from the tarball while `clients/web/dist` slipped through (its `.gitignore` only lists `dist-ssr`). `clients/web/.npmignore` overrides the `.gitignore` for publishing so both `build/` (runner) and `dist/` (SPA) ship. The other clients don't need this — none ship a nested `.gitignore`.
- **`clients/cli/package.json` and `clients/tui/package.json` ship** because those bundles read their own `package.json` at runtime for the client identity / TUI header (`name`, `description`, `version`) relative to the bundle location. Without them the installed CLI crashes on connect and the installed TUI crashes on launch — even though both work in-repo, where the files are present.

### `npm run pack:verify` — publish smoke against the real tarball

The `smoke:*` scripts run against the in-repo build tree, which is **not** the published package. `npm run pack:verify` (`scripts/pack-and-verify.mjs`) closes that gap: it builds, `npm pack`s the publishable tarball (asserting no source maps ship and that `clients/web/{build,dist}` + the two client `package.json`s are present), installs the tarball into a clean throwaway consumer (real `npm install <tgz>`, runs `postinstall`), and drives the installed `mcp-inspector` bin end to end — `--help` dispatch, a real `--cli` `tools/list` over stdio, and a prod `--web` boot that must serve `/` from the shipped `dist`. It catches "works in `--dev`, breaks under `npx @modelcontextprotocol/inspector`" path/packaging failures (exactly how the two `package.json` reads and the `web/build` omission above were found). It requires network access (the install pulls runtime deps), so it is a local / release check, not part of the fast `validate` loop.

## Architecture

For how the launcher fits with the shared config processor and app runners, see the [Launcher and config consolidation](../../docs/launcher-config-consolidation-plan.md) document in the repo root `docs/` folder.
