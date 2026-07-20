# MCP Inspector CLI Client

The CLI package provides two entrypoints:

- **One-shot** — `mcp-inspector --cli` (frozen contract): connect → one `--method` → disconnect.
- **Session** — `mcpi` (MCP Inspector session CLI): connect once, then run many commands against a named session.

## Session CLI (`mcpi`)

```bash
# From a built tree / published package:
mcpi servers/list --config path/to/mcp.json   # marks entries with a live session (@name / MRU)
mcpi servers/show test-stdio --config path/to/mcp.json
mcpi connect test-stdio --config path/to/mcp.json
mcpi connect my-http --config path/to/mcp.json --relogin   # ignore stored OAuth; login only if auth required
mcpi auth/list
mcpi auth/clear https://example.com/mcp
mcpi auth/clear --all --yes
mcpi tools/list
mcpi tools/call echo message:=hi
mcpi tools/call echo '{"message":"hi"}'   # or --tool-arg / --tool-args-json
mcpi @test-stdio resources/list          # explicit session via @name
mcpi initialize --session test-stdio
mcpi logging/setLevel info
mcpi logging/tail                        # long-lived; Ctrl-C to stop
mcpi sessions/list
mcpi disconnect --session test-stdio
mcpi daemon status
mcpi daemon stop

# Optional: private daemon for this shell only (ssh-agent style)
eval "$(mcpi private)"
mcpi connect test-stdio --config path/to/mcp.json
mcpi tools/list
```

Slash methods match one-shot `--method` names (`tools/*`, `resources/*`, `prompts/*`, `logging/*`, `tasks/*`, `roots/*`, `initialize`). Streams (`logging/tail`, `resources/subscribe`) stay attached until Ctrl-C and honour `--format` (human lines or pretty JSON per event). Auth uses the shared `oauth.json` store. On connect, the daemon reuses stored tokens when it can; if auth is still required (or stored credentials cannot complete a silent refresh), `mcpi` runs interactive OAuth then retries (pass `--stored-auth-only` to refuse interactive login — also available on one-shot). Use `connect --relogin` (or one-shot `--relogin`) to ignore stored OAuth for that connect: it clears any `oauth.json` entry for the server URL, then connects; interactive login runs only if the server still requires auth (new tokens are saved). For stdio (or any target with no URL-keyed store entry) the flag is a no-op — there is nothing to clear and OAuth does not apply. Manage the store with `auth/list` and `auth/clear <url>` / `auth/clear --all` (`--yes` required for `--all` when non-interactive). On a TTY, the CLI prints a clickable authorization URL (OSC 8) and opens the default browser; non-TTY / CI only prints the plain URL. On the session CLI, authentication is handled at **connect** time only; mid-session re-login / step-up during a later command is available on one-shot `--cli`, not on `mcpi`.

Sessions are kept by a background process under `~/.mcp-inspector/` by default (shared across terminals). Set `MCP_STORAGE_DIR` to isolate parallel runs (daemon + OAuth store). For a daemon that only this shell can use, run `eval "$(mcpi private)"` once — later `mcpi` commands in that shell inherit the private binding.

**Output (session only — different from one-shot):**

| Flag | Behaviour |
| ---- | --------- |
| `--format text` (default) | Human-readable views (tool lists, call results, sessions, …). On a TTY, uses ANSI styling (color, bold/dim, OSC 8 links). |
| `--format json` | Pretty-printed JSON of the payload (no `{ "result" }` envelope; never ANSI) |
| `--plain` | Disable ANSI styling in human text (also honours `NO_COLOR`) |

Put global flags before the subcommand: `mcpi --format json tools/list`, `mcpi --plain tools/list`. Isolate parallel runs with `MCP_STORAGE_DIR` (scopes the daemon socket + OAuth store). One-shot `--cli` keeps its own format contract (`text` = pretty JSON, `json` = `{ result }` envelope).

## One-shot CLI (`mcp-inspector --cli`)

You can run the one-shot CLI via `npx`:

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js
```

Supports tools, resources, and prompts (plus `--method servers/list` / `servers/show` for catalog entries without connecting).

### Examples

**Basic usage**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js
```

**With a configuration file**

```bash
npx @modelcontextprotocol/inspector --cli --config path/to/config.json --server myserver
```

**List available tools**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/list
```

**Call a specific tool**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name mytool --tool-arg key=value --tool-arg another=value2
```

**Call a tool with JSON arguments**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method tools/call --tool-name mytool --tool-arg 'options={"format": "json", "max_tokens": 100}'
```

**List available resources**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method resources/list
```

**List available prompts**

```bash
npx @modelcontextprotocol/inspector --cli node build/index.js --method prompts/list
```

### Remote Servers

You can also connect to remote MCP servers using HTTP or SSE transports.

**Connect to a remote MCP server (default is SSE)**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com
```

**Connect with Streamable HTTP transport**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com --transport http --method tools/list
```

**Pass custom headers**

```bash
npx @modelcontextprotocol/inspector --cli https://my-mcp-server.example.com --transport http --method tools/list --header "X-API-Key: your-api-key"
```

When a server is loaded from a `--catalog`/`--config` file, its per-server settings (headers, connection/request timeouts, and OAuth) are applied to the connection — the same resolution the TUI uses. A `--header` flag overrides the file's headers for that run while leaving the file's timeouts and OAuth in place.

**Environment-variable semantics.** `MCP_CATALOG_PATH` is honored only when no ad-hoc target is given (positional command, `--server-url`, or `--transport`) — so a shell that exports it can still run one-off ad-hoc invocations without hitting the catalog/ad-hoc conflict. `MCP_STORAGE_DIR` sets the storage directory used by the OAuth persist backend (`<MCP_STORAGE_DIR>/oauth.json`); the per-file `MCP_INSPECTOR_OAUTH_STATE_PATH` override still takes precedence over it.

### HTTP proxy support

Connections to remote HTTP/SSE servers honor the conventional proxy environment variables: `HTTPS_PROXY` / `HTTP_PROXY` (and their lowercase forms) select the proxy, and `NO_PROXY` exempts hosts. This applies to the Node transport shared by the CLI and the web backend — no inspector-specific flag is needed. When a proxy variable is set, outbound requests are routed through undici's `EnvHttpProxyAgent`.

Proxy routing is powered by the [`undici`](https://www.npmjs.com/package/undici) package (`^8.5.0`, which requires Node `>= 22.19.0` — the inspector's supported floor). It is imported lazily only when a proxy variable is set, so runs without a proxy configured pay no cost.

## Options

### MCP server (which server to connect to)

Options that specify the MCP server (catalog/config file, ad-hoc command/URL, env vars, headers) are shared by the Web, CLI, and TUI and are documented in [MCP server configuration](../../docs/mcp-server-configuration.md): `--catalog` (writable catalog, seeded if missing; default `~/.mcp-inspector/mcp.json` or `MCP_CATALOG_PATH`), `--config` (read-only session, errors if absent), `--server`, `-e`, `--cwd`, `--header`, `--transport`, `--server-url`, and the positional `[target...]`. `--catalog` and `--config` are mutually exclusive, and neither combines with an ad-hoc target.

### CLI-specific (what to invoke)

| Option                        | Description                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `--method <method>`           | MCP method to invoke. Supports `initialize` (connect-only probe → `{serverInfo, protocolVersion, capabilities, instructions}`), `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, `prompts/get`, `logging/setLevel`. |
| `--tool-name <name>`          | Tool name (for `tools/call`).                                                             |
| `--tool-arg <key=value>`      | Tool argument; repeat for multiple. Use `key='{"json":true}'` for JSON. Values are coerced (JSON-parsed, so `count=1` becomes a number). |
| `--tool-args-json <json>`     | Tool arguments as a single JSON object (e.g. `'{"zip":"10001"}'`). Passed verbatim — no `key=value` coercion, so `"012"` stays a string. Mutually exclusive with `--tool-arg`. |
| `--uri <uri>`                 | Resource URI (for `resources/read`).                                                      |
| `--prompt-name <name>`        | Prompt name (for `prompts/get`).                                                          |
| `--prompt-args <key=value>`   | Prompt arguments; repeat for multiple.                                                    |
| `--log-level <level>`         | Logging level for `logging/setLevel` (e.g. `debug`, `info`).                              |
| `--metadata <key=value>`      | General metadata (key=value); applied to all methods.                                     |
| `--tool-metadata <key=value>` | Tool-specific metadata for `tools/call`.                                                  |
| `--connect-timeout <ms>`      | Connection timeout in ms. Defaults to `15000` for ad-hoc `--server-url`/target runs (so a black-holed host fails fast) and to the file-level timeout for `--catalog`/`--config` runs. `0` disables the timeout. |
| `--app-info`                  | Probe a tool's MCP App UI metadata without invoking it. With `--method tools/call --tool-name <name>`: prints one JSON line (`hasApp`, `resourceUri`, `csp`, `permissions`, `domain`, …) and exits `0` if the tool has an app or `2` (`no_app`) if not. With `--method tools/list`: emits NDJSON — one app-info line per tool over a single connection. |
| `--format <text\|json>`       | Output format. `text` (default) pretty-prints the result. `json` emits a single JSON object on stdout (`{ "result": … }`, plus `{ "appInfo": … }` as a sibling key for App tools) with no banners, so the whole output pipes cleanly into `jq`. |

#### App probing (`--app-info`) and machine-readable output (`--format json`)

`--app-info` inspects a tool's [MCP App](https://modelcontextprotocol.io) UI posture **without calling the tool**, so a pipeline can decide whether to open a browser before touching one:

```bash
# Probe one tool. Exits 0 (has app) or 2 (no_app). One JSON line on stdout.
mcp-inspector --cli <server> --method tools/call --tool-name my_tool --app-info
# → {"hasApp":true,"toolName":"my_tool","resourceUri":"ui://…","csp":{…},"permissions":{…},"prefersBorder":true,"resourceMimeType":"text/html"}

# Probe every tool at once — NDJSON, one line per tool, single connection.
mcp-inspector --cli <server> --method tools/list --app-info | jq -c 'select(.hasApp)'
```

Exit semantics: a tool that **has** an app exits `0`; one with **no** app exits `2` (`no_app`); a **missing** tool exits `5` (`tool_not_found`) — distinct so a typo isn't mistaken for "no app". A probe failure (an unreadable UI resource, or a malformed `_meta.ui.resourceUri`) is tolerated and reported in a `resourceError` field rather than aborting — so in `tools/list --app-info` one bad tool never kills the rest of the listing.

`--format json` wraps any method's output in a single stdout envelope with no banners, so App tools and plain tools both pipe cleanly into `jq`:

```bash
mcp-inspector --cli <server> --method tools/call --tool-name my_app_tool --format json
# → {"result":{…tool result…},"appInfo":{"hasApp":true,"resourceUri":"ui://…",…}}
```

> `tools/list --app-info` always emits NDJSON (one raw app-info object per line) **regardless of `--format`** — the per-tool list shape is fixed. `--format json` only reshapes the single-result paths (`tools/call`, `tools/list` without `--app-info`, etc.) into the `{result[, appInfo]}` envelope.

A `tools/call` that returns `isError:true` still prints its payload but exits `5` (`tool_is_error`) so `&&` chains don't proceed on a failed call.

### CLI-specific (OAuth for HTTP servers)

The CLI runs the same loopback callback server as the TUI (`http://127.0.0.1:6276/oauth/callback` by default).

**One-shot (`mcp-inspector --cli`):** on connect **401** or mid-session interactive auth (re-login / step-up), it:

1. Starts the callback listener on `--callback-url` (or `MCP_OAUTH_CALLBACK_URL`)
2. Prints the authorization URL to the console (`ConsoleNavigation`)
3. Waits for the browser redirect, exchanges the code, and retries connect or the failed RPC

**Step-up (standard OAuth, one-shot only):** when an RPC needs extra scopes, the CLI prompts on stderr: `Proceed with step-up authorization? [y/N]`. **y** continues; **N** exits with an error. EMA step-up re-mints silently (no prompt).

**Session (`mcpi`):** if connect requires auth, interactive OAuth runs and connect is retried. Mid-session step-up during a later command (for example `tools/call`) is not available on the session CLI — use one-shot `--cli` when you need that, or disconnect and connect again after refreshing tokens.

**Shared OAuth storage:** the CLI **reuses** tokens from `~/.mcp-inspector/storage/oauth.json` when they already exist (same file as other Inspector clients). That is passive file sharing, not launching another app.

**Shared with TUI** (config only, not interactive login):

- Per-server OAuth fields from `mcp.json` (static client, EMA resource credentials, scopes)
- Install-level settings from **`~/.mcp-inspector/storage/client.json`** (or `--client-config` / `MCP_CLIENT_CONFIG_PATH`) — EMA IdP, CIMD
- CLI flags `--client-id`, `--client-secret`, `--client-metadata-url` override `client.json` when set
- Keychain-backed secrets in `mcp.json` are rehydrated on catalog load (same as TUI)

#### OAuth callback URL

| Surface | Default callback |
| ------- | ---------------- |
| **Web** | `http://localhost:6274/oauth/callback` |
| **TUI** | `http://127.0.0.1:6276/oauth/callback` (interactive — callback server) |
| **CLI** | `http://127.0.0.1:6276/oauth/callback` (interactive — same callback server as TUI) |

Register `http://127.0.0.1:6276/oauth/callback` on static or enterprise IdPs that require pre-registered redirect URIs before using the **TUI** or **CLI**. Override with `--callback-url` or `MCP_OAUTH_CALLBACK_URL`. Only one process should bind the default port at a time.

#### Flags

| Option                        | Env                      | Description                                                                                      |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| `--client-config <path>`      | `MCP_CLIENT_CONFIG_PATH` | Install-level client config (default: `~/.mcp-inspector/storage/client.json`).                   |
| `--client-id <id>`            | —                        | OAuth client ID (static client); overrides `client.json`.                                        |
| `--client-secret <secret>`    | —                        | OAuth client secret; overrides `client.json`.                                                    |
| `--client-metadata-url <url>` | —                        | CIMD metadata URL; overrides `client.json`.                                                      |
| `--callback-url <url>`        | `MCP_OAUTH_CALLBACK_URL` | Redirect URI sent to the authorization server (default: `http://127.0.0.1:6276/oauth/callback`). |

**Example** — list tools on an OAuth-protected server using stored tokens and CIMD from the command line:

```bash
npx @modelcontextprotocol/inspector --cli --catalog mcp.json --server my-http-server \
  --client-metadata-url https://example.com/.well-known/oauth/client-metadata.json \
  --method tools/list
```

See [EMA / enterprise-managed auth](../../specification/v2_auth_ema.md) and [OAuth smoke testing](../../specification/v2_auth_smoke_testing.md) (§3 Stytch/CIMD; [§5 mid-session manual validation](../../specification/v2_auth_smoke_testing.md#5-mid-session-auth--step-up--manual-validation) — CLI **C1–C2**).

#### Stored-auth (web → CLI handoff)

For the common case where OAuth was already completed in the **web inspector on the same machine**, the CLI can reuse the resulting token instead of running its own interactive flow. It reads the shared OAuth state file (the `oauth.json` the web backend writes) directly from disk and injects `Authorization: Bearer <token>` for `--server-url`.

| Option                  | Description                                                                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--use-stored-auth`     | Read the stored auth for `--server-url` and inject `Authorization: Bearer`. When a `refresh_token` is stored, the CLI runs the OAuth refresh grant first and injects the **fresh** access token (persisting the rotation); otherwise it injects the stored access token. Exits `3` (`no_stored_token`) — listing the stored keys — when nothing matches. Requires `--server-url`. |
| `--wait-for-auth <sec>` | Poll the OAuth state file (500 ms interval) until an access token for `--server-url` appears, then inject it. Times out at `<sec>` with exit `3` (`auth_wait_timeout`). Use after handing off to a human to complete OAuth in a browser. Unlike `--use-stored-auth`, this injects the freshly-landed access token directly (a token that just completed the browser flow is not expired), so it does **not** run the refresh grant. |
| `--list-stored-auth`    | Print `{ oauthStatePath, storedServerUrls }` (the server keys that currently have a token) and exit. No server connection is made.                                                              |
| `--print-handoff`       | Print a JSON handoff block (`deepLink`, `portForwardCmd`, `oauthStatePath`, `apiToken`) for `--server-url` and exit — everything a script/remote VM needs to drive the browser-side OAuth dance. Requires `--server-url`. |

**State-file resolution** follows `MCP_INSPECTOR_OAUTH_STATE_PATH` → `<MCP_STORAGE_DIR>/oauth.json` → `~/.mcp-inspector/storage/oauth.json` — the same precedence the rest of the Inspector uses, so the CLI and web backend agree on the file. Server keys are canonicalised with `new URL().href` (the scheme the web store writes), so a trailing-slash or case mismatch between the URL a human opened and the one the agent passed still resolves.

**Token refresh (#1665).** When the stored server state carries a `refresh_token` (plus the `clientInformation` the web inspector persists after a completed flow), `--use-stored-auth` runs the SDK's OAuth `refresh_token` grant to mint a fresh access token before connecting, then writes the rotated tokens back to the state file (owner-only `0o600`, via the shared store writer) so web and CLI stay consistent. The auth-server metadata is reused from the stored state, or discovered from `--server-url` when absent. This covers both an absent and an expired stored access token — the persisted blob carries no expiry, so the refresh token is treated as the durable credential. If the refresh fails (revoked token, transient auth-server error) **and** a stored access token is also present, the CLI falls back to injecting that token rather than hard-failing; only when there is nothing to fall back on does it exit `3` (`auth_required`, envelope `refresh_failed`). Without a stored `refresh_token` the access token is injected as-is, and a stale one surfaces as an HTTP `401` → exit `3`.

Because there is no stored expiry, a `refresh_token` is refreshed on every `--use-stored-auth` run. Two consequences with rotating refresh tokens: two concurrent invocations against the same state file race the single-use token (one wins), and a crash between a successful grant and the write-back leaves the rotated token unsaved. Both are narrow; re-authorize in the web inspector to recover.

**Short-circuit modes.** `--list-stored-auth` and `--print-handoff` each print their output and exit without connecting to a server; they ignore the method/target flags. They are mutually exclusive — if both are passed, `--list-stored-auth` takes precedence.

The `deepLink` is the canonical web deep-link ([#1576](https://github.com/modelcontextprotocol/inspector/issues/1576)) — `http://<host>:<port>/?serverUrl=<url>&transport=<http|sse>&autoConnect=<token>` — so navigating it in a browser reaches a connected inspector in one shot. `transport` is derived from the resolved server (`--transport`, else auto-detected from the URL path: `/sse` → `sse`, else `http`), not hardcoded. `autoConnect` is set to `MCP_INSPECTOR_API_TOKEN`; when that env var is unset the link is still emitted but a `note` field flags that the web app's `autoConnect` gate will reject it until the inspector is launched with a known token.

```bash
# On a remote VM: print what a human needs to complete OAuth in their browser.
mcp-inspector --cli --server-url https://api.example/mcp --print-handoff

# Then block until the token lands and run the call with it.
mcp-inspector --cli --transport http --server-url https://api.example/mcp \
  --wait-for-auth 120 --method tools/list
```

## Exit codes & error envelopes

Every non-zero exit maps to a stable failure class, so a programmatic caller
(CI, a script, an agent) can branch on _why_ the CLI failed without scraping
prose from stderr:

| Code | Meaning |
| ---- | ------- |
| `0` | Success. |
| `1` | Usage / unexpected error (the catch-all). |
| `2` | No MCP App found on the tool (`--app-info` probe). |
| `3` | Server requires authentication (401/403, `WWW-Authenticate`, OAuth). |
| `4` | Server unreachable (DNS, connection refused, timeout, `fetch failed`). |
| `5` | Tool error (`tools/call` returned `isError:true`, or the tool was not found). |

On any non-zero exit the CLI also writes a single JSON line to **stderr** — the
`ErrorEnvelope`:

```json
{ "error": { "code": "auth_required", "message": "Unauthorized", "status": 401, "url": "https://api.example/mcp" } }
```

The `code` is a stable identifier for the failure class; `message` is the
human-readable error; `cause`, `status`, and `url` are included when known.
Because it is one line, a caller can parse it with `2>&1 | tail -1 | jq .error`.

## Why use the CLI?

While the Web Client provides a rich visual interface, the CLI is designed for:

- **Automation**: Ideal for CI/CD pipelines and batch processing.
- **AI Coding Assistants**: Provides a direct, machine-readable interface (JSON) for tools like Cursor or Claude to verify changes immediately.
- **Log Analysis**: Easier integration with command-line utilities (like `jq`) to process and analyze MCP server output.

## Development

Like the other clients, the CLI self-validates from its own folder:

```bash
npm run validate       # format:check && lint && test  (fast; no coverage gate)
npm test               # build test-servers + binary, then run all tests
npm run test:coverage  # build + tests under the per-file ≥90 coverage gate
```

The CLI's `test` / `test:coverage` **build the binary first** (out-of-process
`e2e.test.ts` spawns it). `validate` is `format:check && lint && test` with no
separate `build` step (`pretest` builds). Repo-root `validate:cli` delegates
here; the coverage gate is `npm run coverage` / `coverage:cli` (also in
`npm run ci`), matching AGENTS.md.

Tests run the CLI **in-process** (importing `runCli()` / `runMcp()`) so `src/`
is measured under coverage, with a thin out-of-process spawn layer for the real
binary. See [`__tests__/README.md`](./__tests__/README.md) for details.
