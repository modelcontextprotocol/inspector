# MCP Inspector session CLI (`mcpi`)

Session-oriented CLI: connect once, then run many MCP commands against a named session. Uses an implicit local daemon (ssh-agent style).

> **Layout note:** Source lives in `clients/mcpi/`. At build time it bundles some modules from `clients/cli/src` (`handlers/`, `error-handler`, OAuth helpers) via the `@inspector/cli` alias. That reach-in is intentional and temporary — not a published library API — until a cleaner shared package exists.

## Install / run (from this repo)

```bash
cd clients/mcpi && npm install && npm run build
node build/mcp-bin.js --help
# or, after linking / publishing:
mcpi --help
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
