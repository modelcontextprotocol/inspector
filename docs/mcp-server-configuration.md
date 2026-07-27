# MCP server configuration

How to tell the Inspector **which MCP server(s) to connect to**. This model is shared by the Web, CLI, and TUI clients — the flags below are defined separately by each client but resolved by the same code in `core/mcp/node/config.ts`, so they behave identically everywhere except where noted.

Client-specific options (the web server port, the CLI method to invoke, TUI navigation) live in each client's README: [web](../clients/web/README.md) · [cli](../clients/cli/README.md) · [tui](../clients/tui/README.md).

## Two ways to specify a server

1. **From a file** — a catalog or session file listing one or more servers.
2. **Ad-hoc** — a command (stdio) or a URL (SSE / Streamable HTTP) on the command line.

The two do not mix. `--catalog` and `--config` are mutually exclusive with each other, and neither combines with an ad-hoc target. All three clients reject the combination identically (`serverSourceConflict`).

## From a file: `--catalog` vs. `--config`

These look interchangeable and are not. The difference is **who owns the file**.

| | `--catalog <path>` | `--config <path>` |
| --- | --- | --- |
| Writable by the Inspector | Yes — this is the Inspector's own server list | No. Served as-is; never written, seeded, or migrated |
| When the file is missing | Created and seeded (see below) | **Errors** |
| Default path | `~/.mcp-inspector/mcp.json`, or `MCP_CATALOG_PATH` | none — must be passed |
| Editable in the web UI | Yes | No (catalog CRUD is hidden) |
| Use it for | your own working set of servers | a read-only session against a file you didn't write |

Use `--config` when pointing the Inspector at a config file belonging to something else — a coworker's, a client application's, one checked into a repo. It guarantees the Inspector will not touch the bytes on disk, including any plaintext secrets in them.

### What a seeded catalog contains

A missing **writable** catalog is created on first use, but **what gets written differs by client**:

- **Web** seeds two sample servers (`DEFAULT_SEED_CONFIG` in `core/mcp/serverList.ts`) so a first launch has something to connect to immediately:

  ```json
  {
    "mcpServers": {
      "filesystem-server-default": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      },
      "everything-server-default": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-everything"]
      }
    }
  }
  ```

- **CLI and TUI** seed an empty `{ "mcpServers": {} }` (`seedEmptyCatalog` in `core/mcp/node/config.ts`). They are non-interactive or list-driven, so sample entries would be noise rather than a starting point.

Seeding happens **once**, only when the file is absent. An existing catalog is never re-seeded, and a read-only `--config` is never seeded on any surface.

## Ad-hoc servers

Instead of a file, name one server directly:

```bash
# stdio — everything positional is the command to spawn
mcp-inspector --cli node build/index.js

# HTTP / SSE
mcp-inspector --cli --server-url https://api.example.com/mcp --transport http
```

### The `--` separator

The **web and cli** clients split their arguments at a bare `--` and forward everything after it to the target command as its own arguments. This is how you pass a flag the Inspector would otherwise consume:

```bash
mcp-inspector node build/index.js -- --config /etc/myserver.conf --verbose
```

Without the separator, `--config` would be read as the Inspector's own read-only-session flag.

## The shared flags

| Flag | Meaning | Notes |
| --- | --- | --- |
| `--catalog <path>` | Writable catalog file | Env fallback `MCP_CATALOG_PATH` |
| `--config <path>` | Read-only session file | Errors if absent |
| `--server <name>` | Select one named server from the file | **Web and CLI only.** The TUI loads every server in the file and you pick interactively |
| `--transport <type>` | `stdio`, `sse`, or `http` | Ad-hoc targets only |
| `--server-url <url>` | Server URL for SSE / Streamable HTTP | Ad-hoc targets only |
| `--cwd <path>` | Working directory for a stdio server process | |
| `-e <KEY=VALUE>` | Environment variable for a stdio server; repeatable | |
| `--header "Name: Value"` | HTTP header for an HTTP/SSE server; repeatable | On web, requires an ad-hoc HTTP/SSE server |
| `[target...]` | Positional command or URL for one ad-hoc server | |

`MCP_CATALOG_PATH` is honored **only when no ad-hoc target is given** (no positional command, `--server-url`, or `--transport`), so a shell that exports it can still run one-off ad-hoc invocations without tripping the catalog/ad-hoc conflict.

## File format

The file is the familiar MCP client-config shape — an `mcpServers` object keyed by server name — plus Inspector-specific per-server settings.

**stdio**

```json
{
  "mcpServers": {
    "my-server": {
      "type": "stdio",
      "command": "node",
      "args": ["build/index.js"],
      "env": { "API_KEY": "…" },
      "cwd": "/path/to/server"
    }
  }
}
```

**Streamable HTTP / SSE**

```json
{
  "mcpServers": {
    "my-http-server": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": { "X-Tenant": "acme" }
    }
  }
}
```

`type` may be `stdio`, `http` (Streamable HTTP), or `sse`.

### Inspector-specific per-server fields

These have no analog in the broader `mcp.json` ecosystem. Each is **omitted on write when it equals its default**, so a round-trip through the Inspector keeps the file diff minimal.

| Field | Default | Meaning |
| --- | --- | --- |
| `protocolEra` | `"legacy"` | `"legacy"` \| `"auto"` \| `"modern"` — which protocol era to negotiate, orthogonal to the transport |
| `modernLogLevel` | `"debug"` | Per-request log level stamped on modern connections, or `"off"`. Legacy connections ignore it |
| `roots` | — | Roots advertised via the `roots` client capability; each is `{ uri, name? }` |
| `metadata` | — | Default `_meta` keys merged into every outgoing request |
| `connectionTimeout` / `requestTimeout` | — | Timeouts in ms |
| `taskTtl` | — | TTL in ms for tasks created via "Run as task" |
| `autoRefreshOnListChanged` | `false` | Refresh lists automatically on `*/list_changed` instead of only flagging the indicator |
| `paginatedLists` | `false` | Fetch tools/resources/prompts one page at a time instead of auto-aggregating |
| `advertisedExtensions` | — | Per-extension overrides for what the Inspector declares in `capabilities.extensions` |
| `maxFetchRequests` | — | Network-log retention for this server; `0` means unlimited |
| `oauth` | — | `{ clientId, clientSecret, scopes, enterpriseManaged, onInsufficientScope }` |

A catalog carrying these fields:

```json
{
  "mcpServers": {
    "my-modern-server": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "protocolEra": "modern",
      "modernLogLevel": "info",
      "roots": [{ "uri": "file:///Users/me/project", "name": "project" }]
    }
  }
}
```

## Per-client behavior

| | Web | CLI | TUI |
| --- | --- | --- | --- |
| Seeds a missing catalog with | two sample servers | `{}` | `{}` |
| `--server` | yes (currently warns — the UI lists every server) | yes | no — all servers are listed |
| `--` separator | yes | yes | no |
| OAuth client flags | no (uses the Client Settings dialog) | yes | yes |
| Catalog CRUD | yes | read-only consumer | read-only consumer |

The CLI and TUI do not perform catalog CRUD yet — they are read consumers — so the writable/read-only split currently surfaces there only as **seed-if-missing** (`--catalog` / default) vs. **error-if-missing** (`--config`). Full writable persistence is tracked in [#1482](https://github.com/modelcontextprotocol/inspector/issues/1482) / [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432).

## Related

- [Launcher and config consolidation](./launcher-config-consolidation-plan.md) — how the launcher and the shared config processor fit together.
- [Reviewing an MCP App](./mcp-app-review.md) — the CLI-first App review recipe.
