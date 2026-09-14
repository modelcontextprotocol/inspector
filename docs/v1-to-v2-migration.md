# Migrating from Inspector v1 to v2

v2 is a rewrite. The package name and the `npx @modelcontextprotocol/inspector` entry point are unchanged, but the architecture, the CLI surface, and the way you point the Inspector at a server all changed.

This guide is the map. It covers what breaks, what it becomes, and the handful of places where a v1 command still runs in v2 but means something different — the ones worth reading before you conclude v2 is broken.

> **v1 is deprecated** and receives security fixes only, published to the `v1-latest` npm dist-tag. To stay on it, pin it explicitly:
>
> ```bash
> npx @modelcontextprotocol/inspector@v1-latest
> ```

## At a glance

|                   | v1                                               | v2                                                              |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Node              | `>=22.7.5`                                       | **`>=22.19.0`**                                                 |
| npm packages      | 4 (`inspector` + `-client` / `-server` / `-cli`) | **1** (`@modelcontextprotocol/inspector`)                       |
| Processes / ports | web UI on `6274` **+ MCP proxy on `6277`**       | one web server on `6274` (plus a dynamic MCP Apps sandbox port) |
| Modes             | web, `--cli`                                     | web, `--cli`, **`--tui`**                                       |
| Server list       | per-browser, in `localStorage`                   | a **catalog file** on disk (`~/.mcp-inspector/mcp.json`)        |
| Auth token env    | `MCP_PROXY_AUTH_TOKEN`                           | **`MCP_INSPECTOR_API_TOKEN`**                                   |
| CLI exit codes    | `0` / `1`                                        | `0`–`5`, plus a JSON error envelope on stderr                   |

The three changes most likely to bite an existing setup:

1. **`--config` no longer means what it did** — see [`--config` vs `--catalog`](#--config-vs---catalog).
2. **A failing tool call now exits non-zero** (`5`), where v1 exited `0`. CI scripts that ran `&&` chains past a failed call will start failing — correctly.
3. **`SERVER_PORT` was the proxy port and now isn't** — it survives as a fallback for the MCP Apps sandbox port. Setting it no longer moves anything you can browse.

## Requirements

v2 requires **Node `>=22.19.0`** (v1 required `>=22.7.5`). The floor comes from `undici@^8`, used for HTTP proxy support. npm only _warns_ about an `engines` mismatch (`EBADENGINE`) unless you have `engine-strict=true` set, so an older Node won't stop you at install time — it fails later, obscurely. Check `node -v` first.

## What no longer ships

v1 published four packages:

- `@modelcontextprotocol/inspector`
- `@modelcontextprotocol/inspector-client`
- `@modelcontextprotocol/inspector-server`
- `@modelcontextprotocol/inspector-cli`

**v2 publishes only the first.** It is a single tarball with a single version number, containing the web client, the CLI, the TUI, and the launcher that dispatches between them. The three sub-packages are frozen at `1.0.1`, deprecated on npm, and will never see a 2.x.

If you depend on one of them directly, drop it and use the root package's `mcp-inspector` bin. There is no v2 equivalent of importing `inspector-server` as a library; the shared runtime lives in this repo's `core/` and is not published separately yet ([#1636](https://github.com/modelcontextprotocol/inspector/issues/1636)).

```diff
 {
   "devDependencies": {
-    "@modelcontextprotocol/inspector-cli": "^1.0.1"
+    "@modelcontextprotocol/inspector": "^2.0.0"
   }
 }
```

## Architecture: the proxy is gone

v1 ran **two** processes: a React client on `6274` and an "MCP Proxy" on `6277` that held the actual MCP connections. The browser talked to the proxy over HTTP, authenticating with `MCP_PROXY_AUTH_TOKEN`.

v2 runs **one** web server on `6274`. It serves the SPA and exposes `/api/*`, which the browser calls with `x-mcp-remote-auth: Bearer <MCP_INSPECTOR_API_TOKEN>`. The proxy port is gone: nothing needs `6277` exposed, forwarded, or allowed through a firewall.

Consequences:

- `SERVER_PORT` no longer selects a port you browse. (It is read as a fallback for the MCP Apps sandbox server's port — see `MCP_SANDBOX_PORT` below.)
- `MCP_PROXY_FULL_ADDRESS` has no v2 equivalent and is ignored. It existed to tell the browser where a non-default proxy lived; there is no proxy.
- Docker needs `-p 6274:6274` for the UI, where the v1 recipe published `6277` as well.

⚠️ **`6274` is not the only listener.** The web backend also starts a **separate MCP Apps sandbox server**, on a fixed **`6275`** by default (it was OS-assigned before #2008). It is only used by the Apps tab, and on plain loopback it needs no attention — but the browser reaches it directly, so anywhere the Inspector is _not_ served from the browser's own machine (Docker, a dev container, a remote host, an SSH tunnel) you must expose/forward that port too, or the Apps tab won't load. This is a different port from v1's proxy — it carries no MCP traffic — but it is still a second port. See [MCP Apps caveats](../clients/web/README.md#hosting-on-a-network).

## Launching

```bash
npx @modelcontextprotocol/inspector            # web UI (unchanged default)
npx @modelcontextprotocol/inspector --cli      # CLI
npx @modelcontextprotocol/inspector --tui      # TUI (new in v2)
```

The mode flag must come **first**, immediately after the binary name; everything after it is forwarded to that client unchanged.

Passing a server ad-hoc works the same way it did:

```bash
npx @modelcontextprotocol/inspector node build/index.js
npx @modelcontextprotocol/inspector -e KEY=value -- node build/index.js --server-flag
```

## `--config` vs `--catalog`

**This is the change most likely to surprise you.** Both versions have a `--config` flag, both take an `mcpServers` file, and they do not mean the same thing.

In v1, `--config path.json --server name` resolved one entry out of the file and launched against it. The file was read once and never written — but there was no other file, because v1's web UI kept its server list in browser `localStorage`.

v2 has a first-class **server catalog** on disk, and splits the two roles:

|                           | `--catalog <path>`                                 | `--config <path>`                                        |
| ------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| Writable by the Inspector | **Yes** — this is the Inspector's own list         | **No.** Served as-is; never written, seeded, or migrated |
| When the file is missing  | created and seeded                                 | **errors**                                               |
| Default path              | `~/.mcp-inspector/mcp.json`, or `MCP_CATALOG_PATH` | none — must be passed                                    |
| Editable in the web UI    | yes                                                | no (catalog CRUD is hidden)                              |

So:

- **`--config` in v2 is the read-only role.** Point it at a file you didn't write — a coworker's, a client application's, one checked into a repo — and the Inspector guarantees it won't touch the bytes, including any plaintext secrets in them. This is close to v1's behavior, minus the write-back that never existed anyway.
- **`--catalog` is new** and is what you want if you'd like the web UI to add, edit, and remove servers.
- **Neither is required.** With no source flag, v2 uses the default catalog `~/.mcp-inspector/mcp.json`, creating it if absent. v1 had no default file: the CLI started with nothing unless you passed `--config`, and the web UI's list lived in the browser's `localStorage` — per-browser, and invisible to the CLI.

### Before / after

**Your v1 file works unchanged.** The format is the same `mcpServers` shape, `type: "streamable-http"` is still accepted (as is the `"http"` alias), and unknown fields such as v1's exported `note` are carried through rather than rejected.

```bash
# v1 — one entry out of a file
npx @modelcontextprotocol/inspector --config ./mcp.json --server everything

# v2 — same file, same read-only guarantee; --server selects under --cli
npx @modelcontextprotocol/inspector --cli --config ./mcp.json --server everything --method tools/list
```

⚠️ **`--server` only selects under `--cli`**, which is why the v2 line above gains the mode flag (and, being a CLI invocation, a `--method`). On the web client `--server` is a no-op that logs a warning and the UI loads **every** entry in the file; the TUI rejects it as an unknown option. There is no web equivalent of "open just this one entry" — you pick the server from the list after it loads.

```bash
# v2 — let the Inspector manage the file (web UI can edit it)
npx @modelcontextprotocol/inspector --catalog ./mcp.json

# v2 — the default catalog, no flags at all
npx @modelcontextprotocol/inspector
```

**Rules:** `--catalog` and `--config` are mutually exclusive, and neither combines with an ad-hoc target (a positional command, `--server-url`, or `--transport`). v1 silently preferred the config file; v2 tells you. One exception: the **web** client exempts `--transport stdio` from that check, so it survives alongside `--catalog`/`--config` (ignored rather than rejected) — the CLI and TUI reject every `--transport`.

If you export `MCP_CATALOG_PATH` in your shell, note that **web and TUI read it unconditionally** — so an ad-hoc invocation such as `mcp-inspector --tui node build/index.js` is rejected as a catalog/ad-hoc conflict. Unset it for that invocation. The CLI ignores the variable whenever an ad-hoc target is present.

The full model, including the Inspector-specific per-server fields v2 adds (`protocolEra`, `roots`, `requestTimeout`, `oauth`, …), is documented in [MCP server configuration](./mcp-server-configuration.md).

## CLI flag mapping

Every v1 CLI flag still exists in v2 and means the same thing. Nothing was renamed or removed:

| v1 flag                          | v2                              | Notes                                                                                             |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `--method <method>`              | same                            | v2 adds `initialize`, `servers/list`, `servers/show`; stream-only methods are rejected explicitly |
| `--tool-name <name>`             | same                            |                                                                                                   |
| `--tool-arg <k=v>`               | same                            |                                                                                                   |
| `--uri <uri>`                    | same                            |                                                                                                   |
| `--prompt-name <name>`           | same                            |                                                                                                   |
| `--prompt-args <k=v>`            | same                            |                                                                                                   |
| `--log-level <level>`            | same                            |                                                                                                   |
| `--transport <sse\|http\|stdio>` | same                            |                                                                                                   |
| `--server-url <url>`             | same                            |                                                                                                   |
| `--header "Name: Value"`         | same                            |                                                                                                   |
| `--metadata <k=v>`               | same                            |                                                                                                   |
| `--tool-metadata <k=v>`          | same                            |                                                                                                   |
| `-e KEY=VALUE`                   | same                            |                                                                                                   |
| `--config <path>`                | same flag, **narrower meaning** | see [above](#--config-vs---catalog)                                                               |
| `--server <name>`                | same                            | now `--cli`-only                                                                                  |
| `[target...]`                    | same                            | but see the target-ordering **and** URL-transport rules below                                     |

New in v2, with no v1 equivalent:

| Flag                                                                                                                    | What it does                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--catalog <path>`                                                                                                      | writable catalog file (see above)                                                                       |
| `--cwd <path>`                                                                                                          | working directory for a stdio server process                                                            |
| `--tool-args-json '<json>'`                                                                                             | tool arguments as one JSON object, passed verbatim (no `key=value` coercion, so `"012"` stays a string) |
| `--format text\|json`                                                                                                   | `json` emits a single `{"result":…}` object on stdout with no banners                                   |
| `--app-info`                                                                                                            | probe a tool's MCP App UI metadata without invoking the tool                                            |
| `--connect-timeout <ms>`                                                                                                | connect timeout; defaults to `15000` for ad-hoc targets so a black-holed host fails fast                |
| `--client-id` / `--client-secret` / `--client-metadata-url` / `--client-config`                                         | OAuth client configuration                                                                              |
| `--callback-url <url>`                                                                                                  | OAuth loopback redirect URI (default `http://127.0.0.1:6276/oauth/callback`)                            |
| `--relogin` / `--stored-auth-only` / `--use-stored-auth` / `--wait-for-auth` / `--list-stored-auth` / `--print-handoff` | OAuth token reuse and web→CLI handoff                                                                   |

v1 had no OAuth support in the CLI at all; a protected server simply failed. If you script against protected servers, `--stored-auth-only` is the flag to reach for in CI — it never opens a browser and fails fast with `auth_required` instead of hanging on a loopback callback.

See the [CLI README](../clients/cli/README.md) for the full surface.

## CLI behavior changes

The flags survived; four behaviors did not.

### 1. Exit codes and the error envelope

v1 exited `0` on success and `1` on any failure — including a `tools/call` that came back `isError: true`, which exited `0` because the _call_ succeeded.

v2 maps failures onto a stable set:

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| `0`  | Success                                                 |
| `1`  | Usage / unexpected error                                |
| `2`  | No MCP App on the tool (`--app-info` probe)             |
| `3`  | Server requires authentication                          |
| `4`  | Server unreachable (DNS, refused, timeout)              |
| `5`  | Tool error — `isError: true`, or the tool was not found |

and writes one JSON line to **stderr** on any non-zero exit:

```json
{
  "error": {
    "code": "auth_required",
    "message": "Unauthorized",
    "status": 401,
    "url": "https://api.example/mcp"
  }
}
```

**Migration note:** a CI step that chained `inspector --cli … --method tools/call … && next-step` silently continued past failing tool calls in v1. In v2 it stops. That is the intended behavior, but it will surface as "v2 broke my pipeline" the first time a tool was failing all along. Parse the class with `2>&1 | tail -1 | jq .error` rather than matching on prose.

### 2. The target must come first

v2's CLI reads the leading run of non-dash tokens as the server target. Anything after the first flag is no longer part of it:

```bash
mcp-inspector --cli node build/index.js --method tools/list   # ✅
mcp-inspector --cli --method tools/list node build/index.js   # ❌ target silently dropped
```

The second form does **not** error — the target is discarded and the Inspector falls back to your catalog, so it appears to work against the wrong server. v1 tolerated either order.

### 3. `--` splits the other way under `--cli`

On **web and TUI**, everything _after_ `--` goes to the target command — same as v1:

```bash
mcp-inspector node build/index.js -- --config /etc/myserver.conf --verbose
```

Under **`--cli`** it is reversed: everything _before_ `--` is the target, everything _after_ is the Inspector's own options.

```bash
mcp-inspector --cli node build/index.js -- --method tools/list
```

So the web example above, run verbatim under `--cli`, would have `--config /etc/myserver.conf` consumed as the Inspector's read-only-session flag (and then rejected as a catalog/ad-hoc conflict). To pass a leading-dash argument through to a stdio server, put it **before** the `--` instead — everything on that side is forwarded to the target untouched, flags included:

```bash
# v1
mcp-inspector node build/index.js -- --config /etc/myserver.conf --verbose

# v2, same thing under --cli — target and its flags first, Inspector options after
mcp-inspector --cli node build/index.js --config /etc/myserver.conf --verbose -- --method tools/list
```

(Without a `--` on the line, the target is only the leading run of non-dash tokens — so `--` is required whenever the server itself takes flags.)

### 4. An ambiguous URL path no longer guesses a transport

With no `--transport`, v2 infers it from the URL's path suffix — and **only** from that:

| URL path       | v2                                 |
| -------------- | ---------------------------------- |
| ends in `/mcp` | `streamable-http`                  |
| ends in `/sse` | `sse`                              |
| anything else  | **error — `--transport` required** |

```
Transport type not specified and could not be determined from URL: <url>.
```

v1 fell back to SSE for an unrecognized path, so a server at e.g. `https://example.com/api` connected without a flag. In v2 the same command stops with the error above; pass `--transport http` (or `sse`) explicitly. The suffix match is exact, so a trailing slash (`…/mcp/`) is ambiguous too.

This applies to every client's command line — CLI, TUI, and `--web` (which prints the message and exits `1`). The **browser deep link** is the one exception: `?serverUrl=…` with no `transport` param defaults to `http`.

Stdout is otherwise compatible: the default `text` format still pretty-prints the result as `JSON.stringify(result, null, 2)`. One byte differs — v2 appends a trailing newline where v1 wrote none — so a script diffing raw stdout against a stored v1 fixture needs the fixture re-captured (or the comparison trimmed).

## Environment variables

| v1                       | v2                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MCP_PROXY_AUTH_TOKEN`   | **`MCP_INSPECTOR_API_TOKEN`**                                                 | Renamed, but the **old name still works** as a deprecated fallback when the new one is unset — an existing deployment keeps running while you migrate. Guards `/api/*` via `x-mcp-remote-auth: Bearer <token>`; the browser also receives it injected into `index.html`, so a bare reload keeps working. (The `?MCP_PROXY_AUTH_TOKEN=` **query param** has no such fallback — see [Web UI](#web-ui).) |
| `MCP_PROXY_FULL_ADDRESS` | —                                                                             | Removed; there is no proxy                                                                                                                                                                                                                                                                                                                                                                            |
| `SERVER_PORT`            | _repurposed_                                                                  | Was the proxy port. Now only a fallback for the MCP Apps sandbox port                                                                                                                                                                                                                                                                                                                                 |
| `CLIENT_PORT`            | same                                                                          | Web UI port, default `6274`. Must be a fixed port — `0`/dynamic is rejected, since the origin allow-list and sandbox CSP derive from it                                                                                                                                                                                                                                                               |
| `HOST`                   | same, **guarded**                                                             | An all-interfaces host (`0.0.0.0`, `::`, and equivalent spellings) is now **refused** unless `DANGEROUSLY_BIND_ALL_INTERFACES=true`. Binding a specific IP or hostname needs no opt-in                                                                                                                                                                                                                |
| `ALLOWED_ORIGINS`        | same                                                                          | Still comma-separated, still **replaces** the default list rather than merging. Entries must include the scheme                                                                                                                                                                                                                                                                                       |
| `DANGEROUSLY_OMIT_AUTH`  | same                                                                          |                                                                                                                                                                                                                                                                                                                                                                                                       |
| `MCP_AUTO_OPEN_ENABLED`  | same                                                                          | Also gates non-TTY interactive OAuth in the CLI/TUI                                                                                                                                                                                                                                                                                                                                                   |
| —                        | `DANGEROUSLY_BIND_ALL_INTERFACES`                                             | New opt-in for a wildcard bind (the Docker image sets it)                                                                                                                                                                                                                                                                                                                                             |
| —                        | `MCP_CATALOG_PATH`                                                            | Default catalog path                                                                                                                                                                                                                                                                                                                                                                                  |
| —                        | `MCP_SANDBOX_PORT`                                                            | MCP Apps sandbox server port (fixed `6275` by default)                                                                                                                                                                                                                                                                                                                                                     |
| —                        | `MCP_APP_ORIGIN_PORT`                                                         | Dedicated app-origin server port (fixed `6278` by default), used only by an MCP App whose UI resource declares `_meta.ui.domain`                                                                                                                                                                                                                                                                                                                                                     |
| —                        | `MCP_STORAGE_DIR`, `MCP_INSPECTOR_OAUTH_STATE_PATH`, `MCP_CLIENT_CONFIG_PATH` | Storage and OAuth state locations                                                                                                                                                                                                                                                                                                                                                                     |
| —                        | `MCP_OAUTH_CALLBACK_URL`                                                      | CLI/TUI OAuth loopback callback                                                                                                                                                                                                                                                                                                                                                                       |

### The v1 UI configuration settings

v1 exposed a **Configuration** panel writing `localStorage` keys, also settable by query param. Those were global; in v2 the equivalents are **per-server settings**, stored in the catalog entry and editable in Server Settings:

| v1 setting                              | v2                                  |
| --------------------------------------- | ----------------------------------- |
| `MCP_SERVER_REQUEST_TIMEOUT`            | per-server `requestTimeout` (ms)    |
| _(no v1 equivalent)_                    | per-server `connectionTimeout` (ms) |
| `MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS` | always on; no longer configurable   |
| `MCP_REQUEST_MAX_TOTAL_TIMEOUT`         | no equivalent                       |
| `MCP_PROXY_FULL_ADDRESS`                | no equivalent (no proxy)            |

## Web UI

**Server list.** v1 kept it in browser `localStorage`, so it was per-browser and invisible to the CLI. v2 keeps it in the catalog file, shared by all three clients — add a server in the web UI and the CLI and TUI see it.

**Query params.** v1 accepted `?transport=…&serverUrl=…&serverCommand=…&serverArgs=…` plus `?MCP_PROXY_AUTH_TOKEN=…`. v2's deep link is narrower and gated:

```
http://127.0.0.1:6274/?serverUrl=<url>&transport=http|sse&autoConnect=<token>
```

- `serverCommand` / `serverArgs` are gone — a URL can no longer ask the Inspector to spawn a process.
- `serverUrl` is restricted to `http:` / `https:`.
- `autoConnect` must equal the per-launch `MCP_INSPECTOR_API_TOKEN`, so a third-party-minted link can't drive a connect.
- `?MCP_INSPECTOR_API_TOKEN=…` replaces `?MCP_PROXY_AUTH_TOKEN=…`.

Three further params (`openApp`, `appArgs`, `autoOpen`) land you on a rendered MCP App; see the [web README](../clients/web/README.md#deep-link-auto-connect).

**Auth.** v1's bearer-token field in the sidebar is replaced by per-server `headers` and real OAuth (including CIMD and enterprise-managed auth) configured in Server Settings and persisted in the catalog.

## Docker

```bash
# v1
docker run --rm -p 127.0.0.1:6274:6274 -p 127.0.0.1:6277:6277 \
  -e HOST=0.0.0.0 -e MCP_AUTO_OPEN_ENABLED=false \
  ghcr.io/modelcontextprotocol/inspector:1.0.1

# v2 — no proxy port; the image already sets the wildcard-bind opt-in
docker run --rm -p 127.0.0.1:6274:6274 ghcr.io/modelcontextprotocol/inspector:latest
```

Notes:

- **Keep the `127.0.0.1:` prefix on the published port**, as the v1 recipe did. `-p 6274:6274` publishes on every host interface, and the container's `HOST=0.0.0.0` is about the _container's_ interfaces, not the host's — the two are independent. That matters here because the backend spawns processes, `/` embeds the API token, and requests arriving with **no** `Origin` header (i.e. anything that isn't a browser) skip the origin allow-list, leaving the token as the only guard. Bind to loopback and opt into wider exposure deliberately.
- **The Apps tab needs one more published port.** The sandbox server listens on `6275` by default, so the recipe above covers everything _except_ MCP Apps. To use them, publish that port as well:

  ```bash
  docker run --rm -p 127.0.0.1:6274:6274 -p 127.0.0.1:6275:6275 \
    ghcr.io/modelcontextprotocol/inspector:latest
  ```

  Publish it on the **same port number** inside and out: the sandbox URL is handed to the browser via `/api/config` as `http://localhost:<container port>/sandbox`, so remapping it advertises a port the browser can't reach. To use a different number, move both ends — `-e MCP_SANDBOX_PORT=6280 -p 127.0.0.1:6280:6280`.

- **And a third port for an App that declares `_meta.ui.domain`.** That spec field asks the host for a stable, dedicated origin, which v2 answers with a further listener on `MCP_APP_ORIGIN_PORT` (fixed `6278` by default) that the browser also reaches directly. Apps declaring no `domain` never touch it, so publish it only if you need one:

  ```bash
  docker run --rm -p 127.0.0.1:6274:6274 -p 127.0.0.1:6275:6275 -p 127.0.0.1:6278:6278 \
    ghcr.io/modelcontextprotocol/inspector:latest
  ```

  Same-number rule and same remap escape hatch (`-e MCP_APP_ORIGIN_PORT=6281 -p 127.0.0.1:6281:6281`). Unlike the other degradations, leaving this **unpublished does not fall back**: the backend's listener binds fine inside the container, so publication succeeds and the browser is handed a URL on a port it cannot reach — that app's frame stays blank, with no console warning, because a cross-origin navigation failure is not observable from the page. Publish it whenever a server you inspect declares `domain`. Nothing in v1 corresponds to it.

- The v2 image sets `DANGEROUSLY_BIND_ALL_INTERFACES=true` internally (a container must bind `0.0.0.0` to be reachable through `-p`). Setting a bare `HOST=0.0.0.0` **outside** a container now exits with an error.
- **If you remap the published port** (`-p 8080:6274`), the browser's origin no longer matches the in-container port, so set `ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080` (or run `-e CLIENT_PORT=8080 -p 8080:8080`) or connects will 403.
- The image runs as non-root and has a `HEALTHCHECK` that assumes `--web`; add `--no-healthcheck` when running `--cli` / `--tui`.
- `:latest` now points at v2. To stay on the v1 image, pin its exact version tag (`:1.0.1`).

## Troubleshooting

**"`--config` errors that my file doesn't exist, but v1 created it."** v1 never created config files either — but v2's _default_ path is a catalog it will create. If you want a file created on demand, pass it as `--catalog`, not `--config`.

**"`--server` is ignored."** It selects only under `--cli`. Web warns and ignores it; the TUI errors on it as unknown.

**"My CI step started failing after upgrading."** Most likely exit code `5`: a `tools/call` returning `isError: true` now exits non-zero. Check `2>&1 | tail -1 | jq .error`.

**"The Inspector connects to a different server than I named."** Check flag order — under `--cli` the target must precede all flags, or it is silently dropped in favor of the catalog.

**"`Transport type not specified and could not be determined from URL`."** The path ends in neither `/mcp` nor `/sse`, so v2 refuses to guess where v1 fell back to SSE. Pass `--transport http` or `--transport sse`.

**"The Apps tab is blank in Docker / over SSH."** The MCP Apps sandbox is a second port (`6275` by default). Publish/forward it too — see [MCP Apps caveats](../clients/web/README.md#hosting-on-a-network).

**"One particular App's frame is blank, while other Apps render fine."** That App declares `_meta.ui.domain`, so it is served from the **third** port (`MCP_APP_ORIGIN_PORT`, `6278` by default) rather than from the sandbox — publish or forward that port too. Expect no console warning: the backend published the document successfully, so from its side nothing failed, and the browser's inability to load a cross-origin URL is not observable from the page. The neighbouring symptom is different — an App that *renders* and has its requests rejected by its own backend is running on the opaque-origin fallback, which means publication itself failed (no listener, or a port that never bound) and the console **does** carry a warning naming `_meta.ui.domain`. See [MCP App dedicated origins](../clients/web/README.md#mcp-app-dedicated-origins-metauidomain).

**"The page never loads inside a VS Code dev container."** Fixed in the release carrying #1951 — upgrade; on an older version, work around it with `HOST=127.0.0.1`. Before that fix the default `HOST=localhost` bound IPv6 loopback **only** on Linux, so anything connecting over IPv4 `127.0.0.1` was refused — which is what a dev container's port forwarder does. The terminal printed a normal banner while the browser spun forever; the failure is a **hang** rather than a connection error because the forwarder accepts on the host side before failing to connect inward. The same fix covers an `ssh -L 6274:127.0.0.1:6274` tunnel and a container healthcheck. It does **not** describe the official Docker image (it binds `0.0.0.0`, so it was never affected) or a plain `docker run -p` against a loopback bind, which is unreachable across the network namespace for an unrelated reason.

**"`HOST=0.0.0.0` exits with an error."** That's the wildcard-bind guard. Bind a specific address instead, or set `DANGEROUSLY_BIND_ALL_INTERFACES=true` if you genuinely need all interfaces. See [Host binding & the origin allow-list](../clients/web/README.md#host-binding--the-origin-allow-list).

**"I need v1 back."** `npx @modelcontextprotocol/inspector@v1-latest`.

## Related

- [MCP server configuration](./mcp-server-configuration.md) — the full `--catalog` / `--config` / ad-hoc model.
- [CLI README](../clients/cli/README.md) · [TUI README](../clients/tui/README.md) · [web README](../clients/web/README.md)
- [Reviewing an MCP App](./mcp-app-review.md) — the CLI-first App review recipe.
