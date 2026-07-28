# MCP server configuration

How to tell the Inspector **which MCP server(s) to connect to**. This model is shared by the Web, CLI, and TUI clients — the flags below are defined separately by each client but resolved by the same code in `core/mcp/node/config.ts`, so they behave identically everywhere except where noted.

Client-specific options (the web server port, the CLI method to invoke, TUI navigation) live in each client's README: [web](../clients/web/README.md) · [cli](../clients/cli/README.md) · [tui](../clients/tui/README.md).

## Two ways to specify a server

1. **From a file** — a catalog or session file listing one or more servers.
2. **Ad-hoc** — a command (stdio) or a URL (SSE / Streamable HTTP) on the command line.

The two do not mix. `--catalog` and `--config` are mutually exclusive with each other, and neither combines with an ad-hoc target. All three clients apply the same **source-selection** rules — the CLI and TUI through the shared `serverSourceConflict` helper (`core/mcp/node/config.ts`), web through an equivalent inline matrix in `clients/web/server/run-web.ts`. The two implementations diverge on two narrow axes, in opposite directions:

- **Web is stricter on `--header`:** it also rejects `--header` alongside `--catalog`/`--config`, because the CLI and TUI merge `--header` into per-server settings and web does not.
- **Web is looser on `--transport stdio`:** the CLI and TUI treat _any_ `--transport` as an ad-hoc marker, so `--catalog c.json --transport stdio` is rejected as a catalog/ad-hoc conflict there; web excludes `stdio` from that test and accepts the same combination, silently ignoring the flag.

## From a file: `--catalog` vs. `--config`

These look interchangeable and are not. The difference is **who owns the file**.

|                           | `--catalog <path>`                                 | `--config <path>`                                    |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Writable by the Inspector | Yes — this is the Inspector's own server list      | No. Served as-is; never written, seeded, or migrated |
| When the file is missing  | Created and seeded (see below)                     | **Errors**                                           |
| Default path              | `~/.mcp-inspector/mcp.json`, or `MCP_CATALOG_PATH` | none — must be passed                                |
| Editable in the web UI    | Yes                                                | No (catalog CRUD is hidden)                          |
| Use it for                | your own working set of servers                    | a read-only session against a file you didn't write  |

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

Seeding happens **once per file**, only when that file is absent — not once per client. All three surfaces default to the _same_ path (`~/.mcp-inspector/mcp.json`, `getDefaultMcpConfigPath()` in `core/storage/store-io.ts`), so whichever client runs first decides the contents: run `--cli` first and a later `--web` opens the empty catalog it wrote, with no sample servers. An existing catalog is never re-seeded, and a read-only `--config` is never seeded on any surface.

## Ad-hoc servers

Instead of a file, name one server directly:

```bash
# stdio — everything positional is the command to spawn
mcp-inspector node build/index.js

# HTTP / SSE
mcp-inspector --server-url https://api.example.com/mcp --transport http
```

Those run as written in the default (web) mode. Under `--cli` two extra rules apply:

- A `--method` is required — a CLI invocation with no method exits with `Method is required.`
- **The target must come first.** The CLI reads the leading run of non-dash tokens as the target, so anything after the first flag is no longer part of it:

  ```bash
  mcp-inspector --cli node build/index.js --method tools/list   # ✅ target, then flags
  mcp-inspector --cli --method tools/list node build/index.js   # ❌ target is dropped
  ```

  The second form does not error — `node build/index.js` is silently discarded and the Inspector falls back to your catalog, so it "works" against the wrong server. `--tui` has no such rule; Commander parses its arguments in any order.

### The `--` separator

A bare `--` is meaningful on every surface, but **web/tui and cli split it in opposite directions**. Read the one you're using.

**Web and TUI — everything _after_ `--` goes to the target command.** This is how you pass a flag the Inspector would otherwise consume:

```bash
mcp-inspector node build/index.js -- --config /etc/myserver.conf --verbose
```

Without the separator, `--config` would be read as the Inspector's own read-only-session flag. Web splits explicitly (`clients/web/server/run-web.ts`); the TUI has no split of its own but Commander's default end-of-options handling appends the remainder to the target, so post-`--` tokens land in the same place.

They differ on **when you need it**, though. Web sets `allowUnknownOption()` + `allowExcessArguments()`, so a dash flag the Inspector does not define (`--verbose`) already falls through to the target without a separator — on web `--` is only needed for a flag the Inspector _does_ define. The TUI sets neither, so any unrecognized dash flag is a parse error: on the TUI you need `--` for **every** dash argument meant for the server.

**CLI — reversed: everything _before_ `--` is the server target, everything _after_ is the Inspector's own options.**

```bash
mcp-inspector --cli node build/index.js -- --method tools/list
```

So under `--cli` the separator does **not** protect an argument from the Inspector — it does the opposite, and the web example above would have `--config /etc/myserver.conf` consumed as a read-only-session flag (then rejected as a catalog/ad-hoc conflict). There is currently no way to pass a leading-dash argument through to a stdio server on the `--cli` command line; put it in the server entry's `args` in a catalog or config file instead.

## The shared flags

| Flag                     | Meaning                                             | Notes                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--catalog <path>`       | Writable catalog file                               | Env fallback `MCP_CATALOG_PATH`                                                                                                                                                      |
| `--config <path>`        | Read-only session file                              | Errors if absent                                                                                                                                                                     |
| `--server <name>`        | Select one named server from the file               | **Selects only under `--cli`.** Web ignores it — warning with `--catalog`/`--config`, silently with an ad-hoc target; the TUI does not define it and rejects it as an unknown option |
| `--transport <type>`     | `stdio`, `sse`, or `http`                           | Ad-hoc targets only — enforced on cli/tui; web exempts `--transport stdio` (see above)                                                                                               |
| `--server-url <url>`     | Server URL for SSE / Streamable HTTP                | Ad-hoc targets only                                                                                                                                                                  |
| `--cwd <path>`           | Working directory for a stdio server process        |                                                                                                                                                                                      |
| `-e <KEY=VALUE>`         | Environment variable for a stdio server; repeatable |                                                                                                                                                                                      |
| `--header "Name: Value"` | HTTP header for an HTTP/SSE server; repeatable      | On web, requires an ad-hoc HTTP/SSE server                                                                                                                                           |
| `[target...]`            | Positional command or URL for one ad-hoc server     |                                                                                                                                                                                      |

**`MCP_CATALOG_PATH` and ad-hoc targets differ by client.** The **CLI** ignores the env var when an ad-hoc target is given (a positional command, `--server-url`, or `--transport`), so a shell that exports it can still run one-off ad-hoc invocations without tripping the catalog/ad-hoc conflict. **Web and TUI read it unconditionally** — with it exported, an ad-hoc invocation such as `mcp-inspector --tui node build/index.js` is rejected as `--catalog cannot be combined with an ad-hoc server URL/command`. Unset the variable for that invocation on those two surfaces.

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

| Field                                  | Default    | Meaning                                                                                             |
| -------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `protocolEra`                          | `"legacy"` | `"legacy"` \| `"auto"` \| `"modern"` — which protocol era to negotiate, orthogonal to the transport |
| `modernLogLevel`                       | `"debug"`  | Per-request log level stamped on modern connections, or `"off"`. Legacy connections ignore it       |
| `roots`                                | —          | Roots advertised via the `roots` client capability; each is `{ uri, name? }`                        |
| `metadata`                             | —          | Default `_meta` keys merged into every outgoing request                                             |
| `connectionTimeout` / `requestTimeout` | —          | Timeouts in ms                                                                                      |
| `taskTtl`                              | `60000`    | TTL in ms for tasks created via "Run as task" (`DEFAULT_TASK_TTL_MS`)                               |
| `autoRefreshOnListChanged`             | `false`    | Refresh lists automatically on `*/list_changed` instead of only flagging the indicator              |
| `paginatedLists`                       | `false`    | Fetch tools/resources/prompts one page at a time instead of auto-aggregating                        |
| `advertisedExtensions`                 | —          | Per-extension overrides for what the Inspector declares in `capabilities.extensions`                |
| `maxFetchRequests`                     | `1000`     | Network-log retention for this server (`DEFAULT_MAX_FETCH_REQUESTS`); `0` means unlimited           |
| `oauth`                                | —          | `{ clientId, clientSecret, scopes, enterpriseManaged, onInsufficientScope }`                        |

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

|                              | Web                                                           | CLI                                     | TUI                                              |
| ---------------------------- | ------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| Seeds a missing catalog with | two sample servers                                            | `{}`                                    | `{}`                                             |
| `--server`                   | a no-op — warns with a file source, silent with an ad-hoc one | yes — the only surface where it selects | not defined — `error: unknown option '--server'` |
| `--` separator               | yes — after `--` → target                                     | **reversed** — before `--` → target     | yes — after `--` → target (Commander default)    |
| OAuth client flags           | no (uses the Client Settings dialog)                          | yes                                     | yes                                              |
| Catalog CRUD                 | yes                                                           | read-only consumer                      | read-only consumer                               |

The CLI and TUI do not perform catalog CRUD yet — they are read consumers — so the writable/read-only split currently surfaces there only as **seed-if-missing** (`--catalog` / default) vs. **error-if-missing** (`--config`). Full writable persistence is tracked in [#1482](https://github.com/modelcontextprotocol/inspector/issues/1482) / [#1432](https://github.com/modelcontextprotocol/inspector/issues/1432).

## Related

- [Launcher and config consolidation](./launcher-config-consolidation-plan.md) — how the launcher and the shared config processor fit together.
- [Reviewing an MCP App](./mcp-app-review.md) — the CLI-first App review recipe.
