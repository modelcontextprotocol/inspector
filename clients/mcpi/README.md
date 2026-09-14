# MCP Inspector session CLI (`mcpi`)

**Experimental** separate client — not part of the published `@modelcontextprotocol/inspector` package. Connect once, then run many MCP commands against a named session via an implicit local daemon (ssh-agent style).

> **Layout note:** Source lives in `clients/mcpi/`. At build time it bundles some modules from `clients/cli/src` (`handlers/`, `error-handler`, OAuth helpers) via the `@inspector/cli` alias. That reach-in is intentional and temporary — not a published library API — until a cleaner shared package exists.

## Install / run (from this repo)

Build, then put `mcpi` on your PATH with `npm link` (points at this package’s `build/mcp-bin.js`):

```bash
# from the repo root — install deps once if needed
npm install

cd clients/mcpi
npm run build
npm link

mcpi --help
```

Rebuild after pulling source changes (`npm run build` in `clients/mcpi`). You usually do **not** need to re-link unless the package `bin` entry changes.

### Development loop

`mcpi` itself is a short-lived process re-executed on every invocation, so a
plain rebuild is enough for its changes to take effect on the next command.
The **session daemon** (`build/daemon.js`) is different: `ensureDaemon` (see
`src/daemon/ensure.ts`) reuses an already-running daemon without checking its
code version, so a daemon started before your rebuild keeps running stale
code indefinitely.

Use `npm run build:dev` instead of `npm run build` while iterating: it runs
`mcpi daemon stop` first (harmless/no-op if no daemon is running — it treats
"daemon not running" as success) and then `tsup`, so the next daemon-backed
command (`connect`, `tools/list`, …) spawns a fresh daemon from the code you
just built. Commands that never touch the daemon (`servers/list`,
`servers/show`, `--help`) don't need this — a plain `npm run build` is enough
for those.

Without linking, run the built file directly:

```bash
node clients/mcpi/build/mcp-bin.js --help
```

Remove the link when you’re done:

```bash
npm unlink -g @modelcontextprotocol/mcpi
```

## Usage

```bash
mcpi servers/list --config path/to/mcp.json
mcpi servers/show test-stdio --config path/to/mcp.json
mcpi connect test-stdio --config path/to/mcp.json
mcpi connect my-http --config path/to/mcp.json --relogin   # ignore stored OAuth; login only if auth required
mcpi auth/list
mcpi auth/clear https://example.com/mcp
mcpi auth/clear --all --yes
mcpi tools/list
mcpi tools/call echo message:=hi
mcpi tools/call echo '{"message":"hi"}'
mcpi @test-stdio resources/list
mcpi logging/tail                        # long-lived; Ctrl-C to stop
mcpi sessions/list
mcpi disconnect --session test-stdio
mcpi daemon status
mcpi daemon stop

# Optional: private daemon for this shell only
eval "$(mcpi private)"
mcpi connect test-stdio --config path/to/mcp.json
mcpi tools/list
```

**Globals (before subcommand):** `--format text|json`, `--plain`, `--session <name>`, `--catalog` / `--config`, `--stored-auth-only`.

**Output:** `--format text` (default) is human-readable (TTY ANSI unless `--plain` / `NO_COLOR`). `--format json` is pretty-printed payload with **no** `{ result }` envelope.

**Auth:** shared `oauth.json` with other Inspector clients. Connect-time OAuth only on this CLI; mid-session step-up remains on one-shot `mcp-inspector --cli`. `--relogin` clears any URL-keyed store entry before connect (no-op for stdio).

See [`specification/v2_cli_v2.md`](../../specification/v2_cli_v2.md) for the as-built design and to-do list.

## Relation to one-shot CLI

| | One-shot | Session (`mcpi`) |
| --- | --- | --- |
| Entrypoint | `mcp-inspector --cli` | `mcpi` |
| Package (dev) | `clients/cli` | `clients/mcpi` |
| Lifecycle | Connect → one `--method` → disconnect | Connect once → many subcommands |

One-shot docs: [`clients/cli/README.md`](../cli/README.md).
